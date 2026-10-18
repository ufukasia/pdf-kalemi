// Tüm kurulum dosyalarını tek seferde üretir ve proje içindeki dist/ klasörüne koyar:
//   Windows ARM64 + x64 (kurulum ve taşınabilir exe) ve Android APK.
// Kullanım:  npm run dist:all          (hepsi)
//            node scripts/dist.js win  (yalnız Windows)   node scripts/dist.js android  (yalnız Android)
// Derleme, Windows'un 260 karakterlik yol sınırına takılmamak için kısa bir klasörde yapılır (%LOCALAPPDATA%\Temp\pkb).
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const SRC = path.resolve(__dirname, '..');
const BUILD = path.join(process.env.LOCALAPPDATA || require('os').tmpdir(), 'Temp', 'pkb');
const OUT = path.join(SRC, 'dist');
const only = process.argv[2]; // 'win' | 'android' | undefined (hepsi)
// npm Windows'ta .cmd olduğundan kabukla çalışır; node ise kabuksuz (yoldaki boşluklar bölünmesin).
const sh = (cmd, args, cwd) => cmd === 'node'
  ? execFileSync(process.execPath, args, { cwd, stdio: 'inherit', env: Object.assign({}, process.env, { PK_CHILD: '1' }) })
  : execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
const step = (t) => console.log('\n=== ' + t);

// Git'te izlenen dosyaları derleme klasörüne kopyala (README, lisans ve Android projesi hariç).
function sync() {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: SRC }).toString().split('\0').filter(Boolean)
    .filter((f) => !/^(README\.md|LICENSE|\.gitignore)$/.test(f) && !f.startsWith('mobile/'));
  for (const f of files) { const d = path.join(BUILD, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(SRC, f), d); }
  console.log(files.length + ' dosya kopyalandı → ' + BUILD);
}

// Bağımlılıklar: ilk seferde kurulur. sharp'ın yerel parçası işlemciye özeldir; iki mimari için de bulunmalı.
function deps() {
  if (!fs.existsSync(path.join(BUILD, 'node_modules', 'electron-builder'))) { step('Bağımlılıklar kuruluyor'); sh('npm', ['install'], BUILD); }
  const sharpV = JSON.parse(fs.readFileSync(path.join(BUILD, 'node_modules', 'sharp', 'package.json'), 'utf8')).version;
  const need = ['arm64', 'x64'].filter((a) => !fs.existsSync(path.join(BUILD, 'node_modules', '@img', 'sharp-win32-' + a)));
  if (need.length) sh('npm', ['install', '--no-save', '--force', ...need.map((a) => '@img/sharp-win32-' + a + '@' + sharpV)], BUILD);
}

// Bir mimari için Windows kurulumu: diğer mimarinin yerel dosyaları pakete girmez.
async function win(arch) {
  step('Windows ' + arch);
  const builder = require(path.join(BUILD, 'node_modules', 'electron-builder'));
  const base = JSON.parse(fs.readFileSync(path.join(BUILD, 'package.json'), 'utf8')).build;
  const other = arch === 'arm64' ? 'x64' : 'arm64';
  // Not: electron-builder buradaki ayarı package.json'daki "build" ile birleştirir; mimariye özel
  // dışarıda bırakmalar bu yüzden yalnız burada durur, package.json'da değil.
  const files = base.files.concat(['!node_modules/onnxruntime-node/bin/napi-v*/win32/' + other + '/**', '!node_modules/@img/sharp-win32-' + other + '/**']);
  const config = Object.assign({}, base, { files, win: Object.assign({}, base.win, { target: ['nsis', 'portable'] }) });
  await builder.build({ projectDir: BUILD, targets: builder.Platform.WINDOWS.createTarget(['nsis', 'portable'], builder.Arch[arch]), config });
  for (const n of ['PDF-Kalemi-Kurulum-' + arch + '.exe', 'PDF-Kalemi-' + arch + '.exe']) fs.copyFileSync(path.join(BUILD, 'dist', n), path.join(OUT, n));
}

// Android APK: mobile/ klasöründeki Capacitor projesi.
function android() {
  step('Android');
  sh('node', [path.join(SRC, 'mobile', 'build-apk.js')], path.join(SRC, 'mobile'));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // electron-builder aynı işlemde ikinci mimariyi derlerken dosya listesini önbellekten kullanabiliyor;
  // her mimari kendi işleminde derlenir.
  if (/^win-(arm64|x64)$/.test(only || '')) { if (!process.env.PK_CHILD) { sync(); deps(); } await win(only.slice(4)); return; }
  if (only !== 'android') {
    step('Dosyalar hazırlanıyor'); sync(); deps();
    for (const a of ['arm64', 'x64']) sh('node', [__filename, 'win-' + a], SRC);
  }
  if (only !== 'win') android();
  step('Bitti. Çıktılar: ' + OUT);
  for (const f of fs.readdirSync(OUT).filter((n) => /\.(exe|apk)$/.test(n))) console.log('  ' + f + '  (' + (fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(1) + ' MB)');
})().catch((e) => { console.error('\nDERLEME HATASI:', e && e.message || e); process.exit(1); });
