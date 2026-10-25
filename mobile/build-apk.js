// PDF Kalemi Android APK'si (Capacitor). Proje kökünden: npm run dist:android  (ya da hepsi için npm run dist:all)
//  1. Araçlar yoksa indirir: Java 21 (Microsoft OpenJDK) ve Android SDK → %LOCALAPPDATA%\pk-android
//  2. İmza anahtarı yoksa bir kez oluşturur → %USERPROFILE%\.pdfkalemi  (DEPOYA GİRMEZ; yedekleyin:
//     güncellemeler aynı anahtarla imzalanmalı, kaybolursa telefondaki uygulama silinip yeniden kurulur)
//  3. Web dosyalarını ve Android projesini kısa, Türkçe karakter içermeyen bir klasöre kopyalar (%LOCALAPPDATA%\Temp\pka);
//     Gradle uzun ve ASCII olmayan yollarda sorun çıkarır.
//  4. APK'yi derler ve proje kökündeki dist/PDF-Kalemi-android.apk olarak koyar.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { execFileSync } = require('child_process');

const MOBILE = __dirname, ROOT = path.resolve(MOBILE, '..');
const LOCAL = process.env.LOCALAPPDATA || os.tmpdir();
const TOOLS = path.join(LOCAL, 'pk-android'), JDK = path.join(TOOLS, 'jdk'), SDK = path.join(TOOLS, 'sdk');
const BUILD = path.join(LOCAL, 'Temp', 'pka');
const KEYDIR = path.join(os.homedir(), '.pdfkalemi');
const ARCH = process.arch === 'arm64' ? 'aarch64' : 'x64';
const JDK_URL = 'https://aka.ms/download-jdk/microsoft-jdk-21-windows-' + ARCH + '.zip';
const SDK_TOOLS_URL = 'https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip';
const SDK_PACKAGES = ['platform-tools', 'platforms;android-36', 'build-tools;35.0.0']; // Gradle eklentisi (AGP 8.13) build-tools 35 ister
// Uygulamaya giren web dosyaları (masaüstüne özgü main/preload/voice ve servis çalışanı hariç).
const WEB = ['index.html', 'app.js', 'web.js', 'onedrive.js', 'speech.js', 'ai.js', 'aktar.js', 'manifest.webmanifest', 'ai-logo.png', 'icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable.png', 'lib'];

const env = Object.assign({}, process.env, { JAVA_HOME: JDK, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK, Path: path.join(JDK, 'bin') + ';' + (process.env.Path || process.env.PATH || '') });
const run = (cmd, args, cwd, extra) => execFileSync(cmd, args, Object.assign({ cwd, stdio: 'inherit', env }, extra));
const step = (t) => console.log('\n--- ' + t);

async function download(url, file) {
  const r = await fetch(url, { redirect: 'follow' }); if (!r.ok) throw new Error(url + ' indirilemedi: ' + r.status);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
function unzip(zip, dir) { fs.mkdirSync(dir, { recursive: true }); run('tar', ['-xf', zip, '-C', dir]); }
function copyDir(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (skip && skip(a, e)) continue;
    if (e.isDirectory()) copyDir(a, b, skip); else fs.copyFileSync(a, b);
  }
}

async function tools() {
  if (!fs.existsSync(path.join(JDK, 'bin', 'java.exe'))) {
    step('Java 21 indiriliyor (bir kez)');
    fs.mkdirSync(TOOLS, { recursive: true });
    const zip = path.join(TOOLS, 'jdk.zip'), tmp = path.join(TOOLS, 'jdk-tmp');
    await download(JDK_URL, zip); unzip(zip, tmp);
    fs.renameSync(path.join(tmp, fs.readdirSync(tmp)[0]), JDK); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(zip);
  }
  const sdkm = path.join(SDK, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat');
  if (!fs.existsSync(sdkm)) {
    step('Android SDK araçları indiriliyor (bir kez)');
    const zip = path.join(TOOLS, 'clt.zip'), tmp = path.join(TOOLS, 'clt-tmp');
    await download(SDK_TOOLS_URL, zip); unzip(zip, tmp);
    fs.mkdirSync(path.join(SDK, 'cmdline-tools'), { recursive: true });
    fs.renameSync(path.join(tmp, 'cmdline-tools'), path.join(SDK, 'cmdline-tools', 'latest')); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(zip);
  }
  const need = SDK_PACKAGES.filter((p) => !fs.existsSync(path.join(SDK, ...p.split(';'))));
  if (need.length) {
    step('Android SDK paketleri kuruluyor: ' + need.join(', ') + ' (Android SDK lisansı kabul edilir)');
    // sdkmanager.bat paket adlarındaki ";" işaretini ayırıcı sanar; paketler dosyadan verilir.
    const list = path.join(TOOLS, 'paketler.txt'); fs.writeFileSync(list, need.join('\n'));
    run('cmd.exe', ['/c', sdkm, '--sdk_root=' + SDK, '--licenses'], TOOLS, { input: 'y\n'.repeat(40), stdio: ['pipe', 'ignore', 'inherit'] });
    run('cmd.exe', ['/c', sdkm, '--sdk_root=' + SDK, '--package_file=' + list], TOOLS);
  }
}

// İmza anahtarı ve parolası kullanıcı klasöründe durur; depoya ve derleme klasörüne kopyalanmaz.
function signing() {
  const props = path.join(KEYDIR, 'android-imza.properties'), jks = path.join(KEYDIR, 'android-imza.jks');
  if (!fs.existsSync(props) || !fs.existsSync(jks)) {
    step('İmza anahtarı oluşturuluyor (bir kez) → ' + KEYDIR);
    fs.mkdirSync(KEYDIR, { recursive: true });
    const pass = crypto.randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
    run(path.join(JDK, 'bin', 'keytool.exe'), ['-genkeypair', '-keystore', jks, '-storetype', 'PKCS12', '-alias', 'pdfkalemi', '-keyalg', 'RSA', '-keysize', '3072',
      '-validity', '20000', '-storepass', pass, '-keypass', pass, '-dname', 'CN=PDF Kalemi, O=Ufuk ASIL, C=TR'], KEYDIR, { stdio: ['ignore', 'ignore', 'inherit'] });
    // Java properties dosyasında "\" kaçış işaretidir; yol "/" ile yazılır.
    fs.writeFileSync(props, ['storeFile=' + jks.replace(/\\/g, '/'), 'storePassword=' + pass, 'keyAlias=pdfkalemi', 'keyPassword=' + pass, ''].join('\n'));
    console.log('UYARI: ' + KEYDIR + ' klasörünü güvenli bir yere yedekleyin (güncellemeler bu anahtarla imzalanır).');
  }
  return props;
}

function prepare() {
  step('Dosyalar hazırlanıyor → ' + BUILD);
  fs.mkdirSync(BUILD, { recursive: true });
  for (const f of ['package.json', 'capacitor.config.json']) fs.copyFileSync(path.join(MOBILE, f), path.join(BUILD, f));
  const skipBuild = (p, e) => e.isDirectory() && /^(build|\.gradle|\.idea)$/.test(e.name);
  copyDir(path.join(MOBILE, 'android'), path.join(BUILD, 'android'), skipBuild);
  const www = path.join(BUILD, 'www'); fs.rmSync(www, { recursive: true, force: true }); fs.mkdirSync(www);
  for (const f of WEB) { const a = path.join(ROOT, f); fs.statSync(a).isDirectory() ? copyDir(a, path.join(www, f)) : fs.copyFileSync(a, path.join(www, f)); }
  // Capacitor kendi köprü kodunu sayfaya satır içi ekleyebildiği için Android kopyasında buna izin verilir.
  const ip = path.join(www, 'index.html');
  fs.writeFileSync(ip, fs.readFileSync(ip, 'utf8').replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"));
  fs.writeFileSync(path.join(BUILD, 'android', 'local.properties'), 'sdk.dir=' + SDK.replace(/\\/g, '/') + '\n');
  const stamp = path.join(BUILD, 'node_modules', '.pk-paket');
  const want = fs.readFileSync(path.join(MOBILE, 'package.json'), 'utf8');
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== want) {
    step('Capacitor kuruluyor');
    run('cmd.exe', ['/c', 'npm', 'install', '--no-audit', '--no-fund'], BUILD);
    fs.writeFileSync(stamp, want);
  }
  run('cmd.exe', ['/c', 'npx', 'cap', 'sync', 'android'], BUILD);
}

function gradle(props) {
  step('APK derleniyor (Gradle)');
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const code = Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60000); // dakika: her derlemede artar
  const genv = Object.assign({}, env, { PK_SIGNING: props });
  execFileSync('cmd.exe', ['/c', path.join(BUILD, 'android', 'gradlew.bat'), 'assembleRelease', '--no-daemon', '-q', '-PpkVersionCode=' + code, '-PpkVersionName=' + ver],
    { cwd: path.join(BUILD, 'android'), stdio: 'inherit', env: genv });
  const apk = path.join(BUILD, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!fs.existsSync(apk)) throw new Error('APK oluşmadı (imzasız olabilir): ' + apk);
  const out = path.join(ROOT, 'dist', 'PDF-Kalemi-android.apk');
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.copyFileSync(apk, out);
  console.log('APK: ' + out + '  (sürüm ' + ver + ', kod ' + code + ')');
}

(async () => { await tools(); const props = signing(); prepare(); gradle(props); })()
  .catch((e) => { console.error('\nANDROID DERLEME HATASI:', (e && e.message) || e); process.exit(1); });
