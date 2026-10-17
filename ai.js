// Yapay zeka asistanı: ekrandaki slaytın görüntüsü + sesli soru → OpenRouter (ücretsiz model) → yazılı ve sesli cevap.
// API anahtarı yalnızca bu cihazda (localStorage) saklanır; koda, GitHub'a veya buluta gitmez.
(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const API = 'https://openrouter.ai/api/v1';
const LS = 'pdfkalemi:ai', LS_MODELS = 'pdfkalemi:ai-modeller';
// Ücretsiz görüntü modelleri arasında tercih sırası (Ekim 2026 denemesine göre).
const PREFER = ['nvidia/nemotron-3.5-super-vl:free', 'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'];
// Ücretsiz sürümü bize kapalı olanlar, sohbet modeli olmayanlar ve otomatik yönlendirici (soruyu güvenlik
// sınıflandırıcısına bile gönderebildiği için kullanılmaz).
const BLOCKED = /inkling|safety|guard|lyria|^openrouter\//i;
const isDesktopApp = !!(window.desktop && !window.desktop.web);
// Masaüstü uygulamasında sesi bilgisayarın kendisi tanır (Whisper) ve konuşur (Piper); tarayıcıda tarayıcının motorları kullanılır.
const localVoice = !!(window.desktop && window.desktop.voiceStt);
const SP = window.PKSpeech; // ses servisleri (speech.js): Azure, ElevenLabs, yerel, tarayıcı
const SYSTEM = [
  "Sen PDF Kalemi uygulamasının ders asistanısın. Kullanıcı bir öğretim üyesi; derste sunum yaparken sana soru soruyor.",
  "Sana ekrandaki slaytın görüntüsü ve kullanıcının sorusu gelir (ses kaydı ya da yazı).",
  "Kurallar:",
  "- Her zaman Türkçe cevap ver.",
  "- Cevabın sesli okunacak: madde işareti, başlık, tablo, emoji, yıldız, markdown veya LaTeX kullanma. Formülleri konuşur gibi yaz (örneğin 'x kare artı bir', 'A birleşim B').",
  "- Kısa ve net ol: genellikle iki ile beş cümle. Kullanıcı ayrıntı isterse uzat.",
  "- Soru slaytla ilgiliyse slayttaki içeriğe dayan; slaytta olmayan bir bilgi ekliyorsan bunu belirt.",
  "- Soru ses kaydıysa cevabın İLK SATIRI tam olarak 'Soru: ' ile başlasın ve duyduğun soruyu yazsın; sonra yeni satırda cevaba geç.",
  "- Ses kaydını anlayamazsan bunu kısaca söyle ve tekrar sormasını iste."
].join('\n');

/* ---------- Ayarlar ---------- */
const cfg = Object.assign({ key: '', model: '', voice: 'auto', rate: 1, speak: true, fab: true, autoSend: false }, (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } })());
const saveCfg = () => { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) {} };
let models = (() => { try { return JSON.parse(localStorage.getItem(LS_MODELS) || 'null'); } catch (e) { return null; } })();

async function fetchModels() {
  const r = await fetch(API + '/models'); if (!r.ok) throw new Error('Model listesi alınamadı (' + r.status + ')');
  const all = (await r.json()).data || [];
  const free = all.filter((m) => m.pricing && +m.pricing.prompt === 0 && +m.pricing.completion === 0 && m.architecture
    && (m.architecture.input_modalities || []).includes('image') && (m.architecture.output_modalities || ['text']).includes('text')
    && !(m.architecture.output_modalities || []).includes('audio') && !BLOCKED.test(m.id));
  models = free.map((m) => ({ id: m.id, name: m.name || m.id, audio: (m.architecture.input_modalities || []).includes('audio') }))
    .sort((a, b) => rank(a) - rank(b) || (b.audio - a.audio) || a.name.localeCompare(b.name));
  try { localStorage.setItem(LS_MODELS, JSON.stringify(models)); } catch (e) {}
  return models;
}
const rank = (m) => { const i = PREFER.indexOf(m.id); return i < 0 ? 99 : i; };
function currentModel() {
  const list = models || [];
  return list.find((m) => m.id === cfg.model) || list[0] || { id: cfg.model || PREFER[0], name: cfg.model || PREFER[0], audio: /omni/.test(cfg.model || '') };
}
// Seçilen model meşgul ya da kapalıysa sırayla denenecek yedekler (en sonda otomatik yönlendirici).
function candidates() {
  const first = currentModel().id, out = [first];
  for (const id of [...(models || []).map((m) => m.id), ...PREFER]) if (!out.includes(id) && !BLOCKED.test(id) && out.length < 3) out.push(id);
  return out;
}

/* ---------- Arayüz ---------- */
const fab = $('#aiFab'), panel = $('#aiPanel'), log = $('#aiLog'), input = $('#aiText');
function setState(s) {
  fab.dataset.state = s; panel.dataset.state = s;
  $('#aiStatus').textContent = { idle: '', listening: 'Dinliyorum… Bitirince sus ya da Bitir’e bas. Vazgeçmek: İptal / Esc', review: 'Kontrol et, sonra Gönder. Vazgeçmek: İptal / Esc', thinking: 'Çalışıyor… Vazgeçmek: balona dokun / Esc', speaking: 'Konuşuyor… Susturmak için balona dokun' }[s] || '';
}
let state = 'idle';
function go(s) { state = s; setState(s); }
function openPanel() { panel.hidden = false; }
function closePanel() { panel.hidden = true; }
function toast(t) { if (window.__app && window.__app.toast) window.__app.toast(t); }
function applyFab() { fab.hidden = !cfg.fab; }

function turnEl(snap) {
  const t = document.createElement('div'); t.className = 'ai-turn';
  if (snap) { const im = document.createElement('img'); im.src = snap.url; im.alt = 'Sayfa ' + snap.page; im.title = 'Gönderilen görüntü: sayfa ' + snap.page; t.appendChild(im); }
  const q = document.createElement('div'); q.className = 'ai-q'; const a = document.createElement('div'); a.className = 'ai-a';
  const md = document.createElement('div'); md.className = 'ai-m';
  t.append(q, a, md); log.appendChild(t); log.scrollTop = log.scrollHeight;
  return { q, a, el: t, model: md };
}

/* ---------- Slayt görüntüsü: o anki sayfa + üstündeki çizimler ---------- */
async function snapshot() {
  const A = window.__app; if (!A || !A.state.pages.length) return null;
  const i = A.currentIndex(), pv = A.state.pages[i];
  const k = Math.min(1600 / Math.max(pv.w, pv.h), 3);
  const cv = document.createElement('canvas'); cv.width = Math.round(pv.w * k); cv.height = Math.round(pv.h * k);
  const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
  await pv.page.render({ canvasContext: c, viewport: pv.page.getViewport({ scale: k }) }).promise;
  if (pv.ink && pv.ink.width) c.drawImage(pv.ink, 0, 0, cv.width, cv.height);
  return { url: cv.toDataURL('image/jpeg', 0.85), page: i + 1 };
}

/* ---------- Ses kaydı: konuşma bitince (1,6 sn sessizlik) kendiliğinden durur ---------- */
let rec = null;
async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mr = new MediaRecorder(stream), chunks = [];
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const ac = new AudioContext(), an = ac.createAnalyser(); an.fftSize = 1024; ac.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize), t0 = performance.now();
  rec = { stream, mr, chunks, ac, spoke: false, quiet: 0, stopped: null };
  rec.stopped = new Promise((res) => { mr.onstop = () => res(new Blob(chunks, { type: mr.mimeType || 'audio/webm' })); });
  mr.start(250);
  const tick = () => {
    if (!rec || rec.mr !== mr || mr.state !== 'recording') return;
    an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v;
    const rms = Math.sqrt(s / buf.length), now = performance.now();
    fab.style.setProperty('--lvl', Math.min(1, rms * 12).toFixed(3));
    if (rms > 0.03) { rec.spoke = true; rec.quiet = 0; } else if (rec.spoke) { rec.quiet = rec.quiet || now; if (now - rec.quiet > 1600) return finishRecording(); }
    if (!rec.spoke && now - t0 > 8000) return finishRecording();
    if (now - t0 > 45000) return finishRecording();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function stopTracks() { if (!rec) return; rec.stream.getTracks().forEach((t) => t.stop()); try { rec.ac.close(); } catch (e) {} fab.style.setProperty('--lvl', 0); }
let onRecorded = null;
function finishRecording() { if (rec && rec.mr.state === 'recording') rec.mr.stop(); }

// Kaydı 16 kHz tek kanallı sese çevirir (Whisper ve ses alan modellerin beklediği biçim).
async function decode16k(blob) {
  const ac = new AudioContext(); const audio = await ac.decodeAudioData(await blob.arrayBuffer()); ac.close();
  const rate = 16000, len = Math.max(1, Math.ceil(audio.duration * rate));
  const off = new OfflineAudioContext(1, len, rate), src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
  return { pcm: (await off.startRendering()).getChannelData(0), seconds: audio.duration };
}
async function toWavBase64(blob) {
  const { pcm, seconds } = await decode16k(blob), rate = 16000, dv = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  const bytes = new Uint8Array(dv.buffer); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { data: btoa(bin), seconds };
}

// Model sesi anlamıyorsa: tarayıcının konuşma tanıması (Chrome, Edge, Android)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function recognize(onText) {
  return new Promise((resolve, reject) => {
    const r = new SR(); r.lang = 'tr-TR'; r.interimResults = true; r.continuous = false; let final = '';
    r.onresult = (e) => { let t = ''; for (const x of e.results) t += x[0].transcript; final = t; onText(t); };
    r.onerror = (e) => reject(new Error(e.error === 'not-allowed' ? 'Mikrofon izni verilmedi.' : e.error === 'network' ? 'Bu cihazda konuşma tanıma çalışmıyor; soruyu yaz ya da sesi anlayan bir model seç.' : 'Konuşma tanınamadı (' + e.error + ').'));
    r.onend = () => resolve(final.trim());
    r.onerror = ((orig) => (e) => { if (e.error === 'aborted') resolve(''); else orig(e); })(r.onerror);
    rec = { recognizer: r }; r.start();
  });
}

/* ---------- Sesli okuma: cihazın en doğal Türkçe sesi (Edge: Emel/Ahmet, Android: Google) ---------- */
const speaker = { gen: 0, chain: Promise.resolve() };
function sysVoices() { return (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter((v) => /^tr(-|_|$)/i.test(v.lang)); }
function bestSysVoice() {
  const score = (v) => (/natural|neural|online/i.test(v.name) ? 3 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return sysVoices().sort((a, b) => score(b) - score(a))[0] || null;
}
function cleanForSpeech(t) { return t.replace(/[*_#`>|~]/g, '').replace(/\$+/g, '').replace(/\s+/g, ' ').trim(); }
// Her parça hemen üretilmeye başlar (bir sonraki okunurken hazırlanır); okuma sırası korunur.
// Bulut ses (Azure/ElevenLabs) hata verirse o parça yerel sesle okunur, asistan susmaz.
function speak(text, force) {
  text = cleanForSpeech(text); if (!text || (!cfg.speak && !force)) return;
  const gen = speaker.gen, eng = SP.ttsEngine(), prev = speaker.prev; speaker.prev = text;
  let job;
  if (eng === 'azure' || eng === 'eleven') {
    const p = SP.synth(eng, text, prev).catch(() => null);
    job = async () => { const r = await p; if (r) await playAudio(r.bytes, r.mime, gen); else await localSpeak(text, gen); };
  } else if (eng === 'piper') {
    const p = window.desktop.voiceTts(text, SP.cfg.rate).catch((e) => { console.error(e); return null; });
    job = async () => { const w = await p; if (w) await playAudio(w, 'audio/wav', gen); else await sysSpeak(text, gen); };
  } else job = () => sysSpeak(text, gen);
  speaker.chain = speaker.chain.then(job);
  speaker.chain = speaker.chain.then(() => { if (gen === speaker.gen && state === 'speaking' && !speaker.pending) go('idle'); });
}
function localSpeak(text, gen) {
  if (!localVoice) return sysSpeak(text, gen);
  return window.desktop.voiceTts(text, SP.cfg.rate).then((w) => (w ? playAudio(w, 'audio/wav', gen) : sysSpeak(text, gen))).catch(() => sysSpeak(text, gen));
}
function playAudio(bytes, mime, gen) {
  return new Promise((res) => {
    if (gen !== speaker.gen) return res();
    const url = URL.createObjectURL(new Blob([bytes], { type: mime })), a = new Audio(url);
    speaker.audio = a; a.onended = a.onerror = () => { URL.revokeObjectURL(url); if (speaker.audio === a) speaker.audio = null; res(); };
    a.play().catch(() => res());
  });
}
function sysSpeak(text, gen) {
  return new Promise((res) => {
    if (gen !== speaker.gen || !window.speechSynthesis || !speechSynthesis.getVoices().length) return res();
    const u = new SpeechSynthesisUtterance(text), want = SP.cfg.sysVoice;
    const v = (want && speechSynthesis.getVoices().find((x) => x.voiceURI === want)) || bestSysVoice();
    if (v) u.voice = v; u.lang = v ? v.lang : 'tr-TR'; u.rate = SP.cfg.rate || 1;
    u.onend = u.onerror = () => res(); speechSynthesis.speak(u);
  });
}
function stopSpeaking() {
  speaker.gen++; speaker.pending = false; speaker.chain = Promise.resolve(); speaker.prev = '';
  if (speaker.audio) { speaker.audio.pause(); speaker.audio = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
}

/* ---------- OpenRouter: akışlı cevap ---------- */
// Ücretsiz modeller zaman zaman meşgul olur, boş döner ya da çok yavaş başlar. Cevabın ilk kelimesi gelmeden
// bunlardan biri olursa sıradaki ücretsiz modele geçilir; kullanıcının iptali ise hemen durdurur.
const FIRST_TOKEN_MS = 30000;
let abort = null, userCancel = false;
const history = []; // son birkaç soru-cevap (yazı olarak)
class Fatal extends Error {}
async function ask({ snap, audio, text }, view) {
  const m = currentModel();
  const content = [];
  content.push({ type: 'text', text: text ? 'Soru: ' + text : 'Soru ses kaydında. Önce duyduğun soruyu "Soru: ..." satırına yaz, sonra cevapla.' });
  if (snap) content.push({ type: 'image_url', image_url: { url: snap.url } });
  if (audio) content.push({ type: 'input_audio', input_audio: { data: audio.data, format: 'wav' } });
  const messages = [{ role: 'system', content: SYSTEM }];
  for (const h of history.slice(-3)) messages.push({ role: 'user', content: h.q }, { role: 'assistant', content: h.a });
  messages.push({ role: 'user', content });
  userCancel = false;
  let lastErr = '';
  for (const id of candidates()) {
    if (audio && id !== m.id && !(models || []).some((x) => x.id === id && x.audio)) continue; // ses kaydını yalnızca sesi anlayan model alır
    if (id !== m.id) view.model.textContent = shortName(id) + ' deneniyor…';
    const res = await attempt(id, messages, text, view);
    if (res.ok) {
      view.model.textContent = id === m.id ? '' : 'Seçili model meşguldü; ' + shortName(id) + ' cevapladı.';
      history.push({ q: res.heard ? 'Soru: ' + res.heard : '(sesli soru)', a: res.answer }); if (history.length > 6) history.shift();
      if (!cfg.speak || state !== 'speaking') go('idle');
      speaker.chain.then(() => { if (state === 'speaking' && !speaker.pending) go('idle'); });
      return;
    }
    lastErr = res.error || lastErr;
  }
  view.model.textContent = '';
  throw new Error(lastErr || 'Ücretsiz modellerin hepsi şu an meşgul. Biraz sonra tekrar dene.');
}
// Tek model denemesi. Sonuç: { ok, answer, heard } ya da { ok: false, error } (sıradaki model denenir).
async function attempt(id, messages, text, view) {
  const ctl = new AbortController(); abort = ctl;
  let got = false, slow = false;
  const timer = setTimeout(() => { if (!got) { slow = true; ctl.abort(); } }, FIRST_TOKEN_MS);
  let full = '', spoken = 0, heard = text || null, answer = '', pend = '', chunks = 0;
  const say = (s, last) => {
    if (s) pend += (pend ? ' ' : '') + s;
    if (pend && (last || pend.length >= (chunks ? 110 : 30))) { if (cfg.speak) { if (state !== 'speaking') go('speaking'); speak(pend); } pend = ''; chunks++; }
  };
  const flush = (final) => {
    // Cevabın başındaki "Soru: ..." satırı ayrıştırılır (modeller yazılı soruda da tekrar edebiliyor); okunmaz.
    let body = full;
    const m2 = /^\s*soru\s*:\s*(.*?)(\n|$)/i.exec(body);
    if (m2 && (m2[2] === '\n' || final)) { body = body.slice(m2[0].length); if (!text) { heard = m2[1].trim(); view.q.textContent = '“' + heard + '”'; } }
    else if (/^\s*s(o(r(u)?)?)?\s*:?\s*$/i.test(body) || (m2 && !final)) return; // ilk satır henüz gelmedi
    view.a.textContent = body.trim(); log.scrollTop = log.scrollHeight;
    const rest = body.slice(spoken), re = /[^.!?…\n]*[.!?…\n]+(\s|$)/g; let mm, upto = 0;
    while ((mm = re.exec(rest))) { const s = mm[0].trim(); upto = re.lastIndex; if (s.length > 1) say(s, false); }
    spoken += upto;
    if (final) { say(body.slice(spoken).trim(), true); spoken = body.length; }
    answer = body.trim();
  };
  try {
    const r = await fetch(API + '/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://ufukasia.github.io/pdf-kalemi/', 'X-Title': 'PDF Kalemi' },
      body: JSON.stringify({ model: id, messages, stream: true, temperature: 0.4, max_tokens: 4000, reasoning: { effort: 'low', exclude: true } })
    });
    if (!r.ok) { const msg = await explain(r); if (r.status === 401 || r.status === 402) { const f = new Fatal(msg); f.code = r.status === 401 ? 'key' : 'credit'; throw f; } return { ok: false, error: msg }; }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    speaker.pending = true;
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim(); if (d === '[DONE]') continue;
        let j; try { j = JSON.parse(d); } catch (e) { continue; }
        if (j.error) { const msg = j.error.message || 'Model hata verdi.'; if (!got) return { ok: false, error: msg }; throw new Fatal(msg); }
        const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (t) { got = true; full += t; flush(false); }
      }
    }
    flush(true);
    if (!full.trim()) return { ok: false, error: 'Model boş cevap verdi.' };
    return { ok: true, answer: answer || full.trim(), heard };
  } catch (e) {
    if (e instanceof Fatal) throw e;
    if (userCancel) { const x = new Error('iptal'); x.name = 'AbortError'; throw x; }
    if (got) throw e; // cevabın bir kısmı geldikten sonra koptu: yarım cevabı göster, yeniden sorma
    return { ok: false, error: slow ? 'Model ' + FIRST_TOKEN_MS / 1000 + ' saniyede cevaba başlamadı.' : e.message };
  } finally { clearTimeout(timer); speaker.pending = false; }
}
function shortName(id) { const m = (models || []).find((x) => x.id === id); return (m ? m.name : id).replace(/\s*\(free\)\s*$/i, ''); }
async function explain(r) {
  let msg = ''; try { const j = await r.json(); msg = (j.error && (j.error.message || j.error.code)) || ''; } catch (e) {}
  if (r.status === 401) return 'API anahtarı geçersiz. Ayarlar > Yapay zeka bölümünden kontrol et.';
  if (r.status === 402) return 'OpenRouter hesabında bu istek için kredi gerekiyor. Ücretsiz bir model seçtiğinden emin ol.';
  if (r.status === 429) return 'Ücretsiz kullanım sınırına ulaşıldı. Biraz sonra tekrar dene ya da başka bir ücretsiz model seç.';
  if (r.status === 403 && /agentic|harness/i.test(msg)) return 'Bu modelin ücretsiz sürümü bu uygulamaya kapalı. Ayarlar\'dan başka bir model seç.';
  if (r.status >= 500) return 'Modelin sağlayıcısı şu an meşgul. ' + msg;
  if (r.status === 404 && /data policy|privacy/i.test(msg)) return 'Bu ücretsiz model, OpenRouter gizlilik ayarında "ücretsiz modellerin verileri kullanmasına" izin verilmesini istiyor (openrouter.ai/settings/privacy).';
  if (r.status === 404) return 'Model bulunamadı ya da artık ücretsiz değil. Ayarlar\'da "Modelleri yenile"ye bas. ' + msg;
  if (r.status === 400 && /audio/i.test(msg)) return 'Bu model ses kaydını kabul etmedi. Ayarlar\'dan sesi anlayan bir model seç ya da soruyu yaz. ' + msg;
  return 'İstek başarısız (' + r.status + '). ' + msg;
}

/* ---------- Ana akış: dokun → dinle → ONAY (düzelt, slaytı ekle/çıkar) → Gönder → oku ----------
   Kullanıcı "Gönder"e basmadan hiçbir şey modele gitmez. Her aşamada İptal, ✕ ya da Esc tamamen vazgeçer:
   her sorunun bir oturum numarası var; iptal edilen oturumun bekleyen adımları sessizce düşer. */
let runId = 0, current = null;
function cancelAll() {
  runId++;
  if (rec) {
    if (rec.mr && rec.mr.state === 'recording') rec.mr.stop();
    if (rec.recognizer) { try { rec.recognizer.abort(); } catch (e) {} }
    stopTracks(); rec = null;
  }
  userCancel = true; if (abort) abort.abort();
  stopSpeaking(); progressEl = null;
  if (current) {
    if (current.resolveReview) current.resolveReview({ action: 'cancel' });
    const v = current.view; if (v && !v.answer && !v.a.textContent.replace('…', '').trim()) v.el.remove(); // cevabı olmayan taslak silinir
    current = null;
  }
  go('idle');
}
function stopListening() { if (rec && rec.mr) finishRecording(); else if (rec && rec.recognizer) rec.recognizer.stop(); }
function button(text, cls, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (cls ? ' ' + cls : ''); b.textContent = text; b.addEventListener('click', fn); return b; }
// Dinlerken görünen düğmeler
function listenControls(view) {
  const row = document.createElement('div'); row.className = 'ai-ctl';
  row.append(button('Bitir', 'primary', stopListening), button('İptal', '', cancelAll));
  view.q.after(row); return row;
}
// Onay ekranı: söylenen cümle düzenlenebilir, slayt görüntüsü eklenip çıkarılabilir.
function review(view, { text, audio, snap, img }) {
  return new Promise((resolve) => {
    const box = document.createElement('div'); box.className = 'ai-review';
    let ta = null, cb = null;
    view.q.textContent = audio && !text ? '🎤 Sesli soru (' + audio.seconds.toFixed(1) + ' sn) — gönderilsin mi?' : 'Anladığım soru (düzeltebilirsin):';
    if (!(audio && !text)) {
      ta = document.createElement('textarea'); ta.value = text || ''; ta.rows = Math.min(5, 1 + Math.ceil((text || '').length / 48)); ta.setAttribute('aria-label', 'Gönderilecek soru');
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done({ action: 'send' }); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelAll(); }
      });
      box.appendChild(ta);
    }
    if (snap) {
      const l = document.createElement('label'); cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
      cb.addEventListener('change', () => { if (img) img.classList.toggle('off', !cb.checked); });
      l.append(cb, ' Slaytın görüntüsünü de gönder (sayfa ' + snap.page + ')'); box.appendChild(l);
    }
    const row = document.createElement('div'); row.className = 'ai-ctl';
    row.append(button('Gönder', 'primary', () => done({ action: 'send' })), button('Tekrar söyle', '', () => done({ action: 'again' })), button('İptal', '', cancelAll));
    box.appendChild(row); view.q.after(box);
    function done(d) {
      if (d.action === 'send' && ta && !ta.value.trim()) { ta.focus(); return; }
      box.remove(); current && (current.resolveReview = null);
      resolve(Object.assign(d, { text: ta ? ta.value.trim() : text, withSnap: cb ? cb.checked : !!snap }));
    }
    current.resolveReview = (d) => { box.remove(); resolve(d); };
    setTimeout(() => { if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 30);
  });
}
async function run(textQuestion, keepSnap) {
  if (!cfg.key) { openPanel(); showKeyHint('missing'); return; }
  cancelAll(); clearHints();
  const id = runId; userCancel = false;
  openPanel(); const snapP = keepSnap ? Promise.resolve(keepSnap) : snapshot().catch(() => null);
  const m = currentModel(), view = turnEl(null); current = { view, id };
  const alive = () => id === runId;
  try {
    let audio = null, text = textQuestion || null;
    const fromVoice = !text;
    if (fromVoice) {
      const mode = SP.sttMode();
      if (mode === 'azure' || mode === 'local' || (mode === 'none' && m.audio)) {
        // Kayıt → Azure ya da bu bilgisayarda Whisper ile yazıya çevirme (ya da sesi anlayan modele ses)
        view.q.textContent = '🎤 Dinliyorum…'; go('listening');
        await startRecording(); if (!alive()) { stopTracks(); return; }
        const ctl = listenControls(view);
        const blob = await rec.stopped; ctl.remove(); stopTracks(); rec = null;
        if (!alive()) return;
        if (!blob.size) throw new Error('Ses kaydedilemedi.');
        if (mode === 'azure' || mode === 'local') {
          const { pcm, seconds } = await decode16k(blob); if (!alive()) return;
          if (seconds < 0.6) { view.el.remove(); current = null; go('idle'); toast('Ses duyulmadı.'); return; }
          go('thinking');
          const whisper = async () => {
            progressEl = view.q;
            const st = await window.desktop.voiceStatus().catch(() => ({}));
            view.q.textContent = st.asr ? '✍ Sesin bu bilgisayarda yazıya çevriliyor…' : '⬇ Ses tanıma modeli indiriliyor (yalnızca ilk kullanımda, yaklaşık 250 MB)…';
            const t = await window.desktop.voiceStt(pcm); progressEl = null; return t;
          };
          if (mode === 'azure') {
            view.q.textContent = '✍ Sesin yazıya çevriliyor…';
            try { text = await SP.azureStt(pcm); }
            catch (err) { if (!alive()) return; if (!localVoice) throw err; toast(err.message + ' Bu bilgisayarda çevriliyor.'); text = await whisper(); }
          } else text = await whisper();
          if (!alive()) return;
          if (!text) { view.q.textContent = ''; view.a.textContent = 'Söylediğini anlayamadım; biraz daha yakından ya da yüksek sesle tekrar dener misin?'; current = null; go('idle'); return; }
        } else {
          audio = await toWavBase64(blob); if (!alive()) return;
          if (audio.seconds < 0.6) { view.el.remove(); current = null; go('idle'); toast('Ses duyulmadı.'); return; }
        }
      } else if (mode === 'browser') {
        go('listening'); view.q.textContent = '🎤 Dinliyorum…';
        const ctl = listenControls(view);
        text = await recognize((t) => { view.q.textContent = '“' + t + '”'; }); ctl.remove(); rec = null;
        if (!alive()) return;
        if (!text) { view.el.remove(); current = null; go('idle'); toast('Ses duyulmadı.'); return; }
      } else {
        view.el.remove(); current = null; go('idle'); input.focus();
        toast('Bu tarayıcıda konuşma tanıma yok; sorunu yaz.');
        return;
      }
    }
    let snap = await snapP; if (!alive()) return;
    let img = null;
    if (snap) { img = document.createElement('img'); img.src = snap.url; img.alt = 'Sayfa ' + snap.page; img.title = 'Slayt görüntüsü: sayfa ' + snap.page; view.el.insertBefore(img, view.q); }
    // Sesle sorulduysa önce onay (ayarlardan "onaysız gönder" seçilmediyse)
    if (fromVoice && !cfg.autoSend) {
      go('review');
      const d = await review(view, { text, audio, snap, img }); if (!alive()) return;
      if (d.action === 'cancel') { cancelAll(); return; }
      if (d.action === 'again') { view.el.remove(); current = null; return run(null, snap); }
      text = d.text || text;
      if (!d.withSnap) { snap = null; if (img) img.remove(); }
    }
    view.q.textContent = text ? '“' + text + '”' : '🎤 Sesli soru (' + audio.seconds.toFixed(1) + ' sn)';
    go('thinking'); view.a.textContent = '…';
    await ask({ snap, audio, text }, view);
    if (alive()) current = null;
  } catch (e) {
    if (!alive()) return; // iptal edilmiş oturumun hatası gösterilmez
    if (rec && rec.stream) stopTracks(); rec = null; speaker.pending = false; progressEl = null; current = null;
    if (e.name === 'AbortError') { view.a.textContent = '(iptal edildi)'; go('idle'); return; }
    if (e.code === 'key') { cfg.keyOk = false; saveCfg(); syncKeyState(); view.el.remove(); showKeyHint('invalid'); go('idle'); return; }
    view.a.textContent = '⚠ ' + (e.name === 'NotAllowedError' ? 'Mikrofon izni verilmedi. Tarayıcı veya Windows ayarlarından mikrofona izin ver.' : e.name === 'NotFoundError' ? 'Mikrofon bulunamadı.' : e.message);
    view.a.classList.add('err'); go('idle');
  }
}
// Balon: dinlerken → kaydı bitirir (onay ekranına geçer, bir şey gitmez); onay ekranında → iptal;
// yazıya çevirirken / cevap beklerken → iptal; konuşurken → susar; boştayken → yeni soru.
function press() {
  if (state === 'listening') { stopListening(); return; }
  if (state === 'review' || state === 'thinking') { cancelAll(); return; }
  if (state === 'speaking') { stopSpeaking(); go('idle'); return; }
  run(null);
}
function clearHints() { log.querySelectorAll('.ai-turn.hint').forEach((e) => e.remove()); }
function showKeyHint(reason) {
  clearHints();
  const v = turnEl(null); v.el.classList.add('hint');
  v.q.textContent = reason === 'invalid' ? 'API anahtarı geçersiz' : 'API anahtarı gerekli';
  v.a.textContent = reason === 'invalid'
    ? 'Kayıtlı anahtar OpenRouter tarafından reddedildi (silinmiş ya da yanlış olabilir). Yeni anahtarı buraya yapıştır:'
    : 'Asistan için OpenRouter API anahtarını buraya yapıştır. Yalnızca bu cihazda saklanır.';
  const f = document.createElement('form'); f.className = 'ai-keyform';
  const i = document.createElement('input'); i.type = 'password'; i.placeholder = 'sk-or-…'; i.autocomplete = 'off'; i.spellcheck = false; i.setAttribute('aria-label', 'OpenRouter API anahtarı');
  const b = document.createElement('button'); b.type = 'submit'; b.className = 'btn primary'; b.textContent = 'Kaydet';
  const msg = document.createElement('div'); msg.className = 'ai-m';
  f.append(i, b); v.a.after(f, msg);
  i.addEventListener('keydown', (e) => e.stopPropagation());
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); b.disabled = true; msg.textContent = 'Anahtar doğrulanıyor…';
    const r = await saveKey(i.value); b.disabled = false; msg.textContent = r.ok ? '' : r.error;
    if (r.ok) { i.value = ''; clearHints(); const ok = turnEl(null); ok.el.classList.add('hint'); ok.a.textContent = '✓ Anahtar kaydedildi. Balona dokun ve sorunu sor.'; }
  });
  setTimeout(() => i.focus(), 50);
}
// Anahtarı OpenRouter'da doğrular, geçerliyse bu cihaza kaydeder.
async function checkKey(k) {
  try {
    const r = await fetch(API + '/key', { headers: { Authorization: 'Bearer ' + k } });
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'Bu anahtar geçersiz. OpenRouter > Keys sayfasından kopyaladığından emin ol.' };
    if (!r.ok) return { ok: true, unverified: true };
    const d = (await r.json()).data || {}; return { ok: true, free: !!d.is_free_tier, label: d.label };
  } catch (e) { return { ok: true, unverified: true }; } // internet yoksa yine kaydet, sonra denenir
}
async function saveKey(v) {
  v = String(v || '').trim();
  if (!v) return { ok: false, error: 'Anahtar boş.' };
  if (!/^sk-or-[\w-]{20,}$/.test(v)) return { ok: false, error: 'Bu bir OpenRouter anahtarına benzemiyor (sk-or- ile başlamalı).' };
  const c = await checkKey(v); if (!c.ok) return c;
  cfg.key = v; cfg.keyOk = !c.unverified; cfg.keyFree = !!c.free; saveCfg(); syncKeyState(); clearHints();
  toast(c.unverified ? 'Anahtar kaydedildi (internet olmadığı için doğrulanamadı).' : 'Anahtar doğrulandı ve bu cihaza kaydedildi.');
  if (!models) fetchModels().then(fillModels).catch(() => {});
  return { ok: true };
}
let progressEl = null;
if (localVoice && window.desktop.onVoiceProgress) window.desktop.onVoiceProgress((p) => {
  const t = (p.kind === 'asr' ? '⬇ Ses tanıma modeli' : '⬇ Konuşma sesi') + ' indiriliyor: %' + p.percent + (p.totalMb ? ' (' + p.mb + ' / ' + p.totalMb + ' MB)' : '') + ' — yalnızca ilk kullanımda';
  if (progressEl) progressEl.textContent = t;
  const s = $('#aiVoiceSt'); if (s) s.textContent = t;
});

// Balon: dokununca asistan çalışır; sürüklenince sahnede istenen yere taşınır, konumu hatırlanır.
const FAB = 60;
function placeFab() {
  const p = cfg.fabPos || { x: 0.94, y: 0.82 };
  const x = Math.round(p.x * Math.max(0, innerWidth - FAB)), y = Math.round(p.y * Math.max(0, innerHeight - FAB));
  fab.style.transform = `translate(${x}px, ${y}px)`; fab._x = x; fab._y = y;
  if (!panel.hidden) placePanel();
}
// Panel balonun yanında açılır: balon alttaysa üstünde, üstteyse altında.
function placePanel() {
  const W = Math.min(420, innerWidth - 24), cx = fab._x + FAB / 2, below = fab._y + FAB / 2 < innerHeight / 2;
  panel.style.width = W + 'px'; panel.style.left = Math.round(Math.max(12, Math.min(innerWidth - W - 12, cx - W / 2))) + 'px';
  if (below) { panel.style.top = (fab._y + FAB + 10) + 'px'; panel.style.bottom = 'auto'; panel.style.maxHeight = Math.max(200, innerHeight - fab._y - FAB - 22) + 'px'; }
  else { panel.style.bottom = (innerHeight - fab._y + 10) + 'px'; panel.style.top = 'auto'; panel.style.maxHeight = Math.max(200, fab._y - 22) + 'px'; }
}
let drag = null;
fab.addEventListener('pointerdown', (e) => {
  e.preventDefault(); try { fab.setPointerCapture(e.pointerId); } catch (err) {}
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: fab._x, y0: fab._y, moved: false };
});
fab.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 8) return;
  drag.moved = true; fab.classList.add('drag');
  const x = Math.max(0, Math.min(innerWidth - FAB, drag.x0 + dx)), y = Math.max(0, Math.min(innerHeight - FAB, drag.y0 + dy));
  fab.style.transform = `translate(${x}px, ${y}px)`; fab._x = x; fab._y = y;
  if (!panel.hidden) placePanel();
});
const dropFab = (e, cancel) => {
  if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null; fab.classList.remove('drag');
  if (d.moved) { cfg.fabPos = { x: fab._x / Math.max(1, innerWidth - FAB), y: fab._y / Math.max(1, innerHeight - FAB) }; saveCfg(); }
  else if (!cancel) press();
};
fab.addEventListener('pointerup', (e) => dropFab(e, false));
fab.addEventListener('pointercancel', (e) => dropFab(e, true));
fab.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); press(); } });
window.addEventListener('resize', placeFab);
const _open = openPanel; openPanel = () => { _open(); placePanel(); };
$('#aiClose').addEventListener('click', () => { cancelAll(); closePanel(); });
$('#aiClear').addEventListener('click', () => { log.textContent = ''; history.length = 0; });
$('#aiForm').addEventListener('submit', (e) => { e.preventDefault(); const t = input.value.trim(); if (!t || state !== 'idle') return; input.value = ''; run(t); });
input.addEventListener('keydown', (e) => e.stopPropagation());
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (e.key === 'Escape' && state !== 'idle') { e.preventDefault(); cancelAll(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); press(); }
});

/* ---------- Ayarlar paneli: Yapay zeka bölümü ---------- */
function fillModels() {
  const sel = $('#aiModel'); sel.textContent = '';
  const list = models && models.length ? models : PREFER.map((id) => ({ id, name: id, audio: /inkling|omni/.test(id) }));
  for (const m of list) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name.replace(/\s*\(free\)\s*$/i, '') + (m.audio ? '  · görüntü + ses' : '  · görüntü'); sel.appendChild(o); }
  sel.value = currentModel().id;
}
function syncKeyState() {
  $('#aiKeyState').textContent = !cfg.key ? 'Girilmedi' : cfg.keyOk === false ? '⚠ Kayıtlı ama geçersiz (…' + cfg.key.slice(-4) + ')' : '✓ Kayıtlı' + (cfg.keyOk ? ' ve doğrulandı' : '') + (cfg.keyFree ? ', ücretsiz katman' : '') + ' (…' + cfg.key.slice(-4) + ')';
}
function syncAiUi() {
  syncKeyState();
  $('#aiSpeak').checked = !!cfg.speak; $('#aiFabOpt').checked = !!cfg.fab; $('#aiAuto').checked = !!cfg.autoSend;
  fillModels(); SP.syncUi(); applyFab();
}
async function saveFromSettings() {
  const i = $('#aiKey'), b = $('#aiKeySave'); if (!i.value.trim()) return;
  b.disabled = true; $('#aiKeyState').textContent = 'Doğrulanıyor…';
  const r = await saveKey(i.value); b.disabled = false;
  if (r.ok) i.value = ''; else { syncKeyState(); toast(r.error); }
}
$('#aiKeySave').addEventListener('click', saveFromSettings);
$('#aiKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveFromSettings(); } });
$('#aiKey').addEventListener('paste', () => setTimeout(saveFromSettings, 50)); // yapıştırınca kendiliğinden kaydet
$('#aiKeyDel').addEventListener('click', () => { cfg.key = ''; cfg.keyOk = cfg.keyFree = undefined; saveCfg(); syncAiUi(); toast('API anahtarı bu cihazdan silindi.'); });
$('#aiModel').addEventListener('change', (e) => { cfg.model = e.target.value; saveCfg(); });
$('#aiModels').addEventListener('click', async (e) => {
  const b = e.currentTarget; b.disabled = true; b.textContent = 'Getiriliyor…';
  try { await fetchModels(); fillModels(); toast(models.length + ' ücretsiz görüntü modeli bulundu.'); } catch (err) { toast(err.message); }
  b.disabled = false; b.textContent = 'Modelleri yenile';
});
$('#aiSpeak').addEventListener('change', (e) => { cfg.speak = e.target.checked; if (!cfg.speak) stopSpeaking(); saveCfg(); });
$('#aiFabOpt').addEventListener('change', (e) => { cfg.fab = e.target.checked; saveCfg(); applyFab(); });
$('#aiAuto').addEventListener('change', (e) => { cfg.autoSend = e.target.checked; saveCfg(); });
// Masaüstü: ses modellerinin durumu ve önceden indirme
async function syncVoiceModels() {
  const s = $('#aiVoiceSt'); if (!s || !localVoice) return;
  try { const st = await window.desktop.voiceStatus(); s.textContent = st.asr && st.tts ? '✓ Hazır: Whisper (tanıma) ve Piper (ses) bu bilgisayarda.' : 'İlk kullanımda indirilecek (yaklaşık 315 MB, bir kez). İstersen şimdi indir.'; $('#aiVoicePrep').hidden = st.asr && st.tts; } catch (e) { s.textContent = ''; }
}
if (localVoice) {
  document.documentElement.classList.add('localvoice');
  $('#aiVoicePrep').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await window.desktop.voicePrepare(); toast('Ses modelleri hazır.'); } catch (err) { toast('İndirilemedi: ' + err.message); }
    b.disabled = false; syncVoiceModels();
  });
  syncVoiceModels();
  // Modeller zaten indirilmişse, ilk soruda yükleme beklemesi olmasın diye arka planda hazırla.
  // Yalnızca yerel motor kullanılacaksa (Azure kurulu değilse ya da yerel seçildiyse) belleğe yükle.
  if (cfg.key && (SP.sttMode() === 'local' || SP.ttsEngine() === 'piper')) setTimeout(() => window.desktop.voiceStatus().then((st) => { if (st.asr && st.tts) window.desktop.voicePrepare().catch(() => {}); }).catch(() => {}), 5000);
}

go('idle'); syncAiUi(); placeFab();
if (cfg.key && !models) fetchModels().then(fillModels).catch(() => {});
// Kayıtlı anahtar hiç doğrulanmamışsa sessizce doğrula (durum satırı güncellenir).
if (cfg.key && cfg.keyOk === undefined) checkKey(cfg.key).then((c) => { if (!c.unverified) { cfg.keyOk = c.ok; cfg.keyFree = !!c.free; saveCfg(); syncKeyState(); } });
window.__ai = { cfg, press, run, snapshot, currentModel, fetchModels, speak, stopSpeaking };
})();
