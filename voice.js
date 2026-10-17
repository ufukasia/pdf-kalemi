// Yerel ses motorları (yalnızca masaüstü uygulaması, ana süreç):
//  - Konuşma tanıma: Whisper small (OpenAI, açık kaynak) — onnxruntime ile bu bilgisayarda çalışır.
//  - Konuşma üretimi: Piper Türkçe "dfki" sesi (açık kaynak, MIT) + eSpeak-NG ile Türkçe telaffuz.
// Modeller ilk kullanımda bir kez indirilir (kullanıcı veri klasörüne), sonra internetsiz çalışır. Ses dışarı gönderilmez.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const WHISPER = 'onnx-community/whisper-small';
const WHISPER_FILES = ['encoder_model_quantized.onnx', 'decoder_model_merged_quantized.onnx'];
const PIPER_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki/medium/tr_TR-dfki-medium';
const THREADS = Math.max(2, Math.min(8, os.cpus().length - 2));

let dir = null, asrP = null, ttsP = null, onProgress = () => {};
const modelsDir = () => { if (!dir) { dir = path.join(app.getPath('userData'), 'ses-modelleri'); fs.mkdirSync(dir, { recursive: true }); } return dir; };
const piperFile = () => path.join(modelsDir(), 'tr_TR-dfki-medium.onnx');

// İndirme ilerlemesi: dosya başına bayt toplanıp tek yüzde olarak sayfaya bildirilir.
const prog = { asr: {}, tts: {} };
function report(kind, file, loaded, total) {
  prog[kind][file] = { loaded, total };
  const v = Object.values(prog[kind]), l = v.reduce((a, x) => a + x.loaded, 0), t = v.reduce((a, x) => a + (x.total || 0), 0);
  onProgress({ kind, percent: t ? Math.min(100, Math.round(l * 100 / t)) : 0, mb: Math.round(l / 1e6), totalMb: Math.round(t / 1e6) });
}

function loadAsr() {
  if (!asrP) asrP = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = modelsDir(); env.allowLocalModels = false;
    return pipeline('automatic-speech-recognition', WHISPER, {
      device: 'cpu', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
      session_options: { intraOpNumThreads: THREADS, interOpNumThreads: 1 },
      progress_callback: (p) => { if (p.status === 'progress' && p.total) report('asr', p.file, p.loaded, p.total); }
    });
  })().catch((e) => { asrP = null; throw e; });
  return asrP;
}

async function download(url, file, kind) {
  if (fs.existsSync(file)) return;
  const r = await fetch(url); if (!r.ok) throw new Error('Ses modeli indirilemedi (' + r.status + ').');
  const total = +r.headers.get('content-length') || 0, tmp = file + '.part', out = fs.createWriteStream(tmp);
  let loaded = 0;
  for await (const chunk of r.body) { out.write(chunk); loaded += chunk.length; report(kind, path.basename(file), loaded, total); }
  await new Promise((res, rej) => { out.on('error', rej); out.end(res); });
  fs.renameSync(tmp, file);
}

function loadTts() {
  if (!ttsP) ttsP = (async () => {
    const onnx = piperFile(), json = onnx + '.json';
    await download(PIPER_URL + '.onnx.json', json, 'tts');
    await download(PIPER_URL + '.onnx', onnx, 'tts');
    const ort = require('onnxruntime-node');
    const ESpeakNg = (await import('espeak-ng')).default;
    const cfg = JSON.parse(fs.readFileSync(json, 'utf8'));
    const sess = await ort.InferenceSession.create(onnx, { intraOpNumThreads: Math.min(4, THREADS) });
    return { ort, ESpeakNg, cfg, sess };
  })().catch((e) => { ttsP = null; throw e; });
  return ttsP;
}

// Türkçe metin → IPA fonemleri (eSpeak-NG). Metin sanal dosyadan UTF-8 olarak okunur.
async function phonemize(ESpeakNg, text) {
  const es = await ESpeakNg({
    arguments: ['--phonout', 'ph', '-q', '-b', '1', '--ipa', '-v', 'tr', '-f', 'in.txt'],
    preRun: [(m) => m.FS.writeFile('in.txt', new TextEncoder().encode(text))],
    print: () => {}, printErr: () => {}
  });
  return es.FS.readFile('ph', { encoding: 'utf8' }).replace(/\([a-z-]+\)/g, '').replace(/\s*\n\s*/g, ' ').trim();
}

function wav(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}

module.exports = {
  setProgress(fn) { onProgress = fn; },
  status() {
    const w = path.join(modelsDir(), WHISPER, 'onnx');
    return { asr: WHISPER_FILES.every((f) => fs.existsSync(path.join(w, f))), tts: fs.existsSync(piperFile()) };
  },
  async prepare() { await Promise.all([loadAsr(), loadTts()]); return module.exports.status(); },
  // 16 kHz tek kanallı ses → Türkçe metin
  async stt(pcm) {
    const asr = await loadAsr();
    const out = await asr(pcm instanceof Float32Array ? pcm : new Float32Array(pcm), { language: 'turkish', task: 'transcribe' });
    return String(out.text || '').trim();
  },
  // Türkçe metin → WAV (22 kHz). rate: 1 normal, 1.2 daha hızlı.
  async tts(text, rate) {
    text = String(text || '').trim(); if (!text) return null;
    const { ort, ESpeakNg, cfg, sess } = await loadTts();
    const ph = await phonemize(ESpeakNg, text), map = cfg.phoneme_id_map, ids = [...map['^']];
    for (const ch of Array.from(ph.normalize('NFD'))) if (map[ch]) ids.push(...map[ch], ...map['_']);
    ids.push(...map['$']);
    const inf = cfg.inference || {}, r = Math.max(0.6, Math.min(1.6, +rate || 1));
    const res = await sess.run({
      input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / r, inf.noise_w ?? 0.8]), [3])
    });
    return wav(res.output.data, cfg.audio.sample_rate);
  }
};
