const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell, clipboard, nativeImage, ClipboardItem } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

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

// OneDrive girişi: Microsoft'un giriş sayfası ayrı bir pencerede açılır (oturum çerezleri kendi bölmesinde kalır);
// dönüş adresine yönlenince kod alınır ve pencere kapanır. Pencere kapatılırsa null döner.
ipcMain.handle('od-auth', (_e, url, redirect) => new Promise((resolve) => {
  if (typeof url !== 'string' || !url.startsWith('https://login.microsoftonline.com/') || typeof redirect !== 'string' || !redirect.startsWith('https://login.microsoftonline.com/')) { resolve(null); return; }
  const w = new BrowserWindow({
    parent: win || undefined, modal: !!win, width: 520, height: 720, title: 'Microsoft ile giriş', autoHideMenuBar: true,
    backgroundColor: '#ffffff', webPreferences: { partition: 'persist:onedrive', contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  let done = false;
  const finish = (u) => { if (done) return; done = true; resolve(u); if (!w.isDestroyed()) w.close(); };
  const check = (e, u) => { if (typeof u === 'string' && u.startsWith(redirect)) { e.preventDefault(); finish(u); } };
  w.webContents.on('will-redirect', check); w.webContents.on('will-navigate', check);
  w.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:/i.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  w.on('closed', () => finish(null));
  w.loadURL(url).catch(() => {});
}));
// OneDrive / Microsoft Graph istekleri ana süreçten yapılır (tarayıcının çapraz kaynak kısıtları olmadan).
// Yalnızca Microsoft'un giriş, Graph ve dosya indirme adreslerine izin verilir.
const OD_HOSTS = /(^|\.)(login\.microsoftonline\.com|graph\.microsoft\.com|sharepoint\.com|1drv\.com|onedrive\.com|live\.com|svc\.ms)$/i;
ipcMain.handle('od-http', async (_e, req) => {
  try {
    const u = new URL(String(req && req.url));
    if (u.protocol !== 'https:' || !OD_HOSTS.test(u.hostname)) return { error: 'izin verilmeyen adres' };
    const r = await fetch(u, { method: req.method || 'GET', headers: req.headers || {}, body: req.body || undefined, redirect: 'follow', signal: AbortSignal.timeout(req.bin ? 300000 : 30000) });
    if (req.bin && r.ok) return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) };
    return { status: r.status, text: await r.text() };
  } catch (err) { return { error: String(err && err.message || err) }; }
});
// PDF içindeki web bağlantıları varsayılan tarayıcıda açılır; yalnızca http(s) ve e-posta.
ipcMain.handle('open-external', (_e, url) => { if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) shell.openExternal(url); return true; });
// Aktar balonu: görüntüyü panoya kopyalar ve seçilen yapay zekâyı açar; göndermeyi kullanıcı orada kendisi yapar.
// Uygulaması kuruluysa (Başlat menüsünde bulunursa) uygulama, değilse sitesi tarayıcıda açılır. Antigravity yalnız uygulamadır.
const AI_TARGETS = {
  claude: { app: /^Claude$/, proto: 'claude://claude.ai/new?surface=chat', url: 'https://claude.ai/new' },
  chatgpt: { app: /^ChatGPT$/i, url: 'https://chatgpt.com/' },
  gemini: { app: /^(Google )?Gemini$/i, url: 'https://gemini.google.com/app' },
  antigravity: { app: /^Antigravity$/i, alt: /^Antigravity IDE$/i, url: '' },
  codex: { app: /^(OpenAI )?Codex$/i, url: 'https://chatgpt.com/codex' }
};
// Başlat menüsündeki uygulamalar (ad + AppID); bir kez okunur, ayarlar açılınca yenilenebilir.
let startApps = null;
function listStartApps(fresh) {
  if (startApps && !fresh) return startApps;
  startApps = new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve([]); return; }
    const cmd = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 20000, maxBuffer: 8 << 20 }, (err, out) => {
      try { const j = JSON.parse(String(out).trim() || '[]'); resolve((Array.isArray(j) ? j : [j]).filter((a) => a && a.Name && a.AppID)); } catch (e) { resolve([]); }
    });
  });
  return startApps;
}
async function findAiApp(key) {
  const t = AI_TARGETS[key]; if (!t) return null;
  const apps = await listStartApps();
  return apps.find((a) => t.app.test(a.Name)) || (t.alt && apps.find((a) => t.alt.test(a.Name))) || null;
}
async function aiApps(fresh) {
  if (fresh) await listStartApps(true);
  const out = {};
  for (const k of Object.keys(AI_TARGETS)) { const a = await findAiApp(k); out[k] = a ? a.Name : ''; }
  if (!out.claude && app.getApplicationNameForProtocol('claude://')) out.claude = 'Claude';
  return out;
}
// Otomatik yapıştırma: hedef pencereyi (uygulama ya da sitesi açık tarayıcı) bulup öne getirir, yazma kutusu
// hazırlansın diye kısa bir süre tanır ve Ctrl+V gönderir. Hedef gerçekten önde değilse hiçbir tuşa basılmaz.
// Gönder'e her zaman kullanıcı basar. Antigravity bir kod editörü olduğundan yapıştırma yanlış yere gidebilir: elle yapılır.
const PASTE = {
  claude: { app: ['claude'], title: 'Claude' }, chatgpt: { app: ['chatgpt'], title: 'ChatGPT' },
  gemini: { app: ['gemini'], title: 'Gemini' }, codex: { app: ['codex'], title: 'Codex|ChatGPT' }
};
const BROWSERS = ['msedge', 'chrome', 'firefox', 'brave', 'opera', 'vivaldi', 'arc', 'browser'];
const PASTE_PS = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Diagnostics; using System.Text.RegularExpressions;
public static class PkW {
  public delegate bool CB(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(CB cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  // Görünür üst düzey pencereler arasında, süreç adı listede ve başlığı (büyük/küçük harfe duyarlı) uyan ilk pencere.
  // Tarayıcının birden çok penceresi olsa da hepsine bakılır.
  public static IntPtr Find(string[] procs, string rx) {
    IntPtr found = IntPtr.Zero; var re = new Regex(rx);
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      string t = Title(h); if (t.Length == 0 || !re.IsMatch(t)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid); string n = "";
      try { n = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { }
      if (Array.IndexOf(procs, n) >= 0) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$procs = $env:PK_PROCS -split ','; $rx = $env:PK_TITLE
# Yalnızca bak: hedef pencere şu an var mı?
if ($env:PK_ONLYFIND) { if ([PkW]::Find($procs, $rx) -ne [IntPtr]::Zero) { 'VAR' } else { 'YOK' }; exit 0 }
$end = [DateTime]::Now.AddMilliseconds([int]$env:PK_TIMEOUT)
# Öne getir ve klavye odağını ver: Windows yalnız öndeki programa izin verdiği için hem öndeki pencerenin hem de
# hedef pencerenin girdisine geçici olarak bağlanılır. Tarayıcılar ancak böyle odağı sayfanın içine (yazma kutusuna) verir.
function Front($h) {
  if ([PkW]::IsIconic($h)) { [void][PkW]::ShowWindow($h, 9) }
  $x = 0; $fg = [PkW]::GetForegroundWindow(); $ft = [PkW]::GetWindowThreadProcessId($fg, [ref]$x); $tt = [PkW]::GetWindowThreadProcessId($h, [ref]$x); $me = [PkW]::GetCurrentThreadId()
  [void][PkW]::AttachThreadInput($me, $ft, $true); [void][PkW]::AttachThreadInput($me, $tt, $true)
  [void][PkW]::BringWindowToTop($h); [void][PkW]::SetForegroundWindow($h); [void][PkW]::SetActiveWindow($h); [void][PkW]::SetFocus($h)
  [void][PkW]::AttachThreadInput($me, $tt, $false); [void][PkW]::AttachThreadInput($me, $ft, $false) }
while ([DateTime]::Now -lt $end) {
  $h = [PkW]::Find($procs, $rx)
  if ($h -ne [IntPtr]::Zero) {
    if ([PkW]::GetForegroundWindow() -ne $h) { Front $h; Start-Sleep -Milliseconds 300 }
    if ([PkW]::GetForegroundWindow() -eq $h) {
      Start-Sleep -Milliseconds ([int]$env:PK_SETTLE)
      if ([PkW]::GetForegroundWindow() -eq $h -and (([PkW]::Title($h)) -cmatch $rx)) {
        [PkW]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero); [PkW]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)
        [PkW]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero); [PkW]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
        'YAPISTIRILDI'; exit 0
      }
    }
  }
  Start-Sleep -Milliseconds 250
}
'ZAMAN_ASIMI'`;
function runPastePs(extra, timeout) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PASTE_PS], { env: Object.assign({}, process.env, extra), windowsHide: true, timeout },
      (err, out) => resolve(String(out || '')));
  });
}
// Sitesi tarayıcıda zaten açık ve önde duran sekme mi? (Öyleyse yeni sekme açılmaz, o sekmeye yapıştırılır.)
async function webWindowOpen(key) {
  const p = PASTE[key]; if (!p || process.platform !== 'win32') return false;
  return /VAR/.test(await runPastePs({ PK_PROCS: BROWSERS.join(','), PK_TITLE: p.title, PK_ONLYFIND: '1' }, 15000));
}
// Bekleme süreleri: uygulama kısa sürede hazırdır; yeni açılan sitenin yazma kutusu birkaç saniyede hazırlanır;
// zaten açık olan sekmede yalnızca pencerenin öne gelmesi beklenir.
async function autoPaste(key, via, reused) {
  const p = PASTE[key]; if (!p || process.platform !== 'win32') return false;
  const out = await runPastePs({
    PK_PROCS: (via === 'app' ? p.app : BROWSERS).join(','), PK_TITLE: p.title, PK_TIMEOUT: '30000',
    PK_SETTLE: via === 'app' ? '1500' : reused ? '700' : '3500'
  }, 45000);
  return /YAPISTIRILDI/.test(out);
}
ipcMain.handle('ai-handoff', async (_e, dataUrl, key, where, paste) => {
  const usePaste = paste !== false && !!PASTE[key];
  const r = await handoff(dataUrl, key, where, usePaste);
  if (r.ok && r.opened && usePaste) r.pasted = await autoPaste(key, r.via, r.reused);
  return r;
});
async function handoff(dataUrl, key, where, usePaste) {
  const t = AI_TARGETS[key]; if (!t) return { ok: false };
  const img = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? nativeImage.createFromDataURL(dataUrl) : null;
  if (!img || img.isEmpty()) return { ok: false };
  // Electron 44'te pano, tarayıcıdaki gibi ClipboardItem ile yazılır (writeImage kaldırıldı).
  // Windows bunu PNG ve Bitmap olarak sunar; her programa yapıştırılabilir.
  if (typeof clipboard.writeImage === 'function') clipboard.writeImage(img);
  else await clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]);
  const wantApp = where !== 'web' || !t.url;
  try {
    if (wantApp && t.proto && app.getApplicationNameForProtocol(t.proto.split(':')[0] + '://')) { await shell.openExternal(t.proto); return { ok: true, opened: true, via: 'app' }; }
    const a = wantApp ? await findAiApp(key) : null;
    if (a) { spawn('explorer.exe', ['shell:AppsFolder\\' + a.AppID], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); return { ok: true, opened: true, via: 'app', name: a.Name }; }
    if (t.url) {
      if (usePaste && await webWindowOpen(key)) return { ok: true, opened: true, via: 'web', reused: true };
      await shell.openExternal(t.url); return { ok: true, opened: true, via: 'web' };
    }
    return { ok: true, opened: false, reason: 'noapp' };
  } catch (err) { return { ok: true, opened: false }; }
}
ipcMain.handle('ai-apps', (_e, fresh) => aiApps(!!fresh));
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
