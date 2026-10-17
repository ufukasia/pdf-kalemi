const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Kalem için en düşük gecikme: pencerenin gizlenince yavaşlamasını kapat.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let win = null;
let pendingFile = null;

function pdfFromArgs(argv) {
  const list = argv.slice(app.isPackaged ? 1 : 2);
  return list.find((a) => /\.pdf$/i.test(a) && fs.existsSync(a)) || null;
}
function readPdf(p) {
  try { return { path: p, name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) }; } catch (e) { return null; }
}

process.on('uncaughtException', (err) => console.error('Ana süreç hatası:', err));
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); const p = pdfFromArgs(argv); if (p) win.webContents.send('open-file', readPdf(p)); }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    pendingFile = pdfFromArgs(process.argv);
    win = new BrowserWindow({
      width: 1360, height: 900, minWidth: 640, minHeight: 480, show: false, title: 'PDF Kalemi',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#12151a' : '#e6e9ee',
      icon: path.join(__dirname, 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false }
    });
    win.once('ready-to-show', () => { win.maximize(); win.show(); });
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Sayfa süreci çökerse pencere kendini yeniden yükler; son dosya ve çizimler diskten geri gelir.
    win.webContents.on('render-process-gone', (_e, d) => {
      if (d.reason === 'clean-exit') return;
      setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.reload(); }, 400);
    });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.loadFile(path.join(__dirname, 'index.html'));
  });
  app.on('window-all-closed', () => app.quit());
}

// PDF içindeki web bağlantıları varsayılan tarayıcıda açılır; yalnızca http(s) ve e-posta.
ipcMain.handle('open-external', (_e, url) => { if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) shell.openExternal(url); return true; });
// Yerel ses: Whisper (konuşma tanıma) ve Piper (Türkçe konuşma). Ağır modüller ilk kullanımda yüklenir.
const voice = require('./voice');
voice.setProgress((p) => { if (win && !win.isDestroyed()) win.webContents.send('voice-progress', p); });
ipcMain.handle('voice-status', () => voice.status());
ipcMain.handle('voice-prepare', () => voice.prepare());
ipcMain.handle('voice-stt', (_e, pcm) => voice.stt(pcm));
ipcMain.handle('voice-tts', (_e, text, rate) => voice.tts(text, rate));
// Varsayılan PDF uygulaması: Windows 11 seçimi kullanıcıya bırakır; ilgili ayar sayfası PDF Kalemi'ye açılır.
ipcMain.handle('open-default-apps', () => {
  if (process.env.PORTABLE_EXECUTABLE_FILE || !app.isPackaged) return { portable: true };
  shell.openExternal('ms-settings:defaultapps?registeredAppUser=' + encodeURIComponent('PDF Kalemi')).catch(() => shell.openExternal('ms-settings:defaultapps'));
  return { ok: true };
});
// Klasörlerim: kullanıcının eklediği klasörler ve içlerindeki PDF'ler (alt klasörlerle, makul sınırlarla).
ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Klasör ekle', properties: ['openDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.handle('list-pdfs', async (_e, root) => {
  if (typeof root !== 'string' || !root) return { missing: true, files: [] };
  try { if (!(await fs.promises.stat(root)).isDirectory()) return { missing: true, files: [] }; } catch (e) { return { missing: true, files: [] }; }
  const files = [], MAX = 1500;
  async function walk(dir, depth) {
    if (depth > 4 || files.length >= MAX) return;
    let ents = []; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of ents) {
      if (files.length >= MAX) return;
      if (d.name.startsWith('.') || d.name.startsWith('~$') || d.name === 'node_modules') continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) await walk(p, depth + 1);
      else if (/\.pdf$/i.test(d.name)) files.push({ path: p, name: d.name, rel: path.relative(root, dir) });
    }
  }
  await walk(root, 0);
  const coll = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
  files.sort((a, b) => coll.compare(a.rel, b.rel) || coll.compare(a.name, b.name));
  return { files, truncated: files.length >= MAX };
});
ipcMain.handle('initial-file', () => { const p = pendingFile; pendingFile = null; return p ? readPdf(p) : null; });
ipcMain.handle('open-pdf', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'PDF aç', properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  return r.canceled || !r.filePaths[0] ? null : readPdf(r.filePaths[0]);
});
ipcMain.handle('save-pdf', async (_e, bytes, defaultPath) => {
  const r = await dialog.showSaveDialog(win, { title: 'Çizili PDF\'i kaydet', defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(bytes));
  return { path: r.filePath };
});
ipcMain.handle('confirm-discard', () => dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Devam et', 'Vazgeç'], defaultId: 1, cancelId: 1, title: 'PDF Kalemi', message: 'Kaydedilmemiş çizimler var. Devam edilirse kaybolacak.' }) === 0);

// ---- Kalıcı durum: son dosya, sayfa konumu, araç ayarları ve çizimler (kullanıcı veri klasöründe) ----
const dataDir = () => app.getPath('userData');
const statePath = () => path.join(dataDir(), 'durum.json');
const inkPath = (key) => path.join(dataDir(), 'cizimler', crypto.createHash('sha1').update(String(key)).digest('hex') + '.json');
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file);
}
function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; } }
ipcMain.handle('read-pdf', (_e, p) => (typeof p === 'string' && /\.pdf$/i.test(p) && fs.existsSync(p)) ? readPdf(p) : null);
ipcMain.handle('load-state', () => { try { return JSON.parse(readText(statePath()) || 'null'); } catch (e) { return null; } });
ipcMain.handle('save-state', (_e, s) => { try { writeAtomic(statePath(), JSON.stringify(s)); } catch (e) {} return true; });
ipcMain.on('save-state-sync', (e, s) => { try { writeAtomic(statePath(), JSON.stringify(s)); } catch (err) {} e.returnValue = true; });
ipcMain.handle('load-ink', (_e, key) => readText(inkPath(key)));
ipcMain.handle('save-ink', (_e, key, json) => { try { writeAtomic(inkPath(key), json); } catch (e) {} return true; });
ipcMain.on('save-ink-sync', (e, key, json) => { try { writeAtomic(inkPath(key), json); } catch (err) {} e.returnValue = true; });
