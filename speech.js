// Ses servisleri: konuşmayı anlama (STT) ve asistanın sesi (TTS).
// Varsayılan: Microsoft Azure Speech — ücretsiz katman ayda 500.000 karakter seslendirme + 5 saat tanıma.
// Seçenekler: ElevenLabs (en insansı ses; ücretsiz plan ayda 10.000 karakter), bu bilgisayarda (Whisper/Piper),
// tarayıcının/cihazın kendi sesi. Seçilen servis kurulmamışsa ya da hata verirse yerel seçeneğe düşülür.
// Anahtarlar yalnızca bu cihazda (localStorage) saklanır; koda, GitHub'a veya buluta gitmez.
(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const LS = 'pdfkalemi:ses';
const localVoice = !!(window.desktop && window.desktop.voiceStt);
const isDesktopApp = !!(window.desktop && !window.desktop.web);
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const EL = 'https://api.elevenlabs.io/v1';
const REGIONS = ['westeurope', 'northeurope', 'germanywestcentral', 'francecentral', 'swedencentral', 'switzerlandnorth', 'uksouth', 'italynorth', 'polandcentral',
  'eastus', 'eastus2', 'westus2', 'westus3', 'centralus', 'canadacentral', 'brazilsouth', 'uaenorth', 'qatarcentral', 'centralindia', 'southeastasia', 'eastasia', 'japaneast', 'koreacentral', 'australiaeast'];
const ELEVEN_MODELS = [['eleven_multilingual_v2', 'Multilingual v2 — dengeli, Türkçede en tutarlı'], ['eleven_v3', 'v3 — en duygulu, en insansı'], ['eleven_flash_v2_5', 'Flash v2.5 — en hızlı, yarı kredi']];

/* ---------- Ayarlar ---------- */
const stored = (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } })();
const legacy = (() => { try { return JSON.parse(localStorage.getItem('pdfkalemi:ai') || '{}'); } catch (e) { return {}; } })();
const cfg = Object.assign({ stt: 'azure', tts: 'azure', rate: +legacy.rate || 1, sysVoice: '' }, stored);
cfg.azure = Object.assign({ key: '', region: 'westeurope', voice: 'tr-TR-EmelNeural', ok: undefined, voices: null }, stored.azure);
cfg.eleven = Object.assign({ key: '', voice: '', model: 'eleven_multilingual_v2', ok: undefined, voices: null, tier: '' }, stored.eleven);
const save = () => { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) {} };
const toast = (t) => { if (window.__app && window.__app.toast) window.__app.toast(t); };

const azureReady = () => !!(cfg.azure.key && cfg.azure.region && cfg.azure.ok !== false);
const elevenReady = () => !!(cfg.eleven.key && cfg.eleven.voice && cfg.eleven.ok !== false);
const browserSTT = () => !!SR && !isDesktopApp;
// Seçilen servis kullanılamıyorsa: masaüstünde yerel motor, tarayıcıda tarayıcının kendi motoru.
function sttMode() {
  if (cfg.stt === 'azure' && azureReady()) return 'azure';
  if (cfg.stt === 'local' && localVoice) return 'local';
  if (cfg.stt === 'browser' && browserSTT()) return 'browser';
  return localVoice ? 'local' : browserSTT() ? 'browser' : 'none';
}
function ttsEngine() {
  if (cfg.tts === 'azure' && azureReady()) return 'azure';
  if (cfg.tts === 'eleven' && elevenReady()) return 'eleven';
  if (cfg.tts === 'local' && localVoice) return 'piper';
  if (cfg.tts === 'browser') return 'browser';
  return localVoice ? 'piper' : 'browser';
}
const NAMES = { azure: 'Azure', eleven: 'ElevenLabs', local: 'bu bilgisayardaki motor', piper: 'bu bilgisayardaki ses (Piper)', browser: 'tarayıcının kendi motoru', none: 'yok' };

/* ---------- Ortak yardımcılar ---------- */
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
function pcmToWav(pcm, rate) {
  const dv = new DataView(new ArrayBuffer(44 + pcm.length * 2)), w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Uint8Array(dv.buffer);
}
async function failure(r, who) {
  let msg = ''; try { const t = await r.text(); try { const j = JSON.parse(t); msg = (j.detail && (j.detail.message || j.detail.status)) || j.message || (j.error && j.error.message) || ''; } catch (e) { msg = t.slice(0, 120); } } catch (e) {}
  const e = new Error(
    r.status === 401 || r.status === 403 ? who + ' anahtarı geçersiz' + (who === 'Azure' ? ' ya da bölge yanlış.' : '.') :
    r.status === 402 || /quota/i.test(msg) ? who + ' kotan doldu.' :
    r.status === 429 ? who + ' çok fazla istek aldı; biraz sonra tekrar dene.' :
    who + ' hata verdi (' + r.status + ').' + (msg ? ' ' + msg : ''));
  e.status = r.status; return e;
}

/* ---------- Azure Speech ---------- */
async function azureVoices(key, region) {
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { headers: { 'Ocp-Apim-Subscription-Key': key } });
  if (!r.ok) throw await failure(r, 'Azure');
  const all = await r.json();
  const tr = all.filter((v) => v.Locale === 'tr-TR');
  const multi = all.filter((v) => v.Locale !== 'tr-TR' && (v.SecondaryLocaleList || []).includes('tr-TR'));
  const lab = (v, native) => (v.LocalName || v.DisplayName) + ' (' + (v.Gender === 'Female' ? 'kadın' : 'erkek') + (native ? ', Türkçe' : ', çok dilli') + ')' + (/HD/i.test(v.ShortName) ? ' · HD' : '');
  return [...tr.map((v) => [v.ShortName, lab(v, true)]), ...multi.map((v) => [v.ShortName, lab(v, false)])];
}
async function azureTts(text) {
  const v = cfg.azure.voice || 'tr-TR-EmelNeural', rate = Math.round((cfg.rate - 1) * 100);
  const inner = v.startsWith('tr-TR') ? xml(text) : '<lang xml:lang="tr-TR">' + xml(text) + '</lang>'; // çok dilli sesler Türkçe konuşsun
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="tr-TR"><voice name="${xml(v)}"><prosody rate="${rate >= 0 ? '+' : ''}${rate}%">${inner}</prosody></voice></speak>`;
  const r = await fetch(`https://${cfg.azure.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST', body: ssml,
    headers: { 'Ocp-Apim-Subscription-Key': cfg.azure.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3' }
  });
  if (!r.ok) throw await failure(r, 'Azure');
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: 'audio/mpeg' };
}
// 16 kHz tek kanallı ses → Türkçe metin (en fazla 60 sn)
async function azureStt(pcm) {
  const r = await fetch(`https://${cfg.azure.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=tr-TR&format=simple`, {
    method: 'POST', body: pcmToWav(pcm, 16000),
    headers: { 'Ocp-Apim-Subscription-Key': cfg.azure.key, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json' }
  });
  if (!r.ok) throw await failure(r, 'Azure');
  const j = await r.json();
  return j.RecognitionStatus === 'Success' ? String(j.DisplayText || '').trim() : '';
}

/* ---------- ElevenLabs ---------- */
async function elevenVoices(key) {
  const r = await fetch(EL + '/voices', { headers: { 'xi-api-key': key } });
  if (!r.ok) throw await failure(r, 'ElevenLabs');
  const j = await r.json();
  return (j.voices || []).map((v) => [v.voice_id, v.name + (v.labels && v.labels.gender ? ' (' + (v.labels.gender === 'female' ? 'kadın' : v.labels.gender === 'male' ? 'erkek' : v.labels.gender) + ')' : '')]);
}
async function elevenTier(key) {
  try {
    const r = await fetch(EL + '/user/subscription', { headers: { 'xi-api-key': key } }); if (!r.ok) return '';
    const s = await r.json(); return (s.tier || '') + (s.character_limit ? ' · kalan ' + Math.max(0, s.character_limit - s.character_count).toLocaleString('tr') + ' karakter' : '');
  } catch (e) { return ''; }
}
// prev: bir önceki parça — tonlamanın cümleler arasında kopmaması için bağlam olarak gönderilir.
async function elevenTts(text, prev) {
  const m = cfg.eleven.model, body = { text, model_id: m, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true, speed: Math.max(0.7, Math.min(1.2, cfg.rate)) } };
  if (m !== 'eleven_v3' && prev) body.previous_text = prev;
  if (/flash|turbo/.test(m)) body.language_code = 'tr';
  const r = await fetch(`${EL}/text-to-speech/${encodeURIComponent(cfg.eleven.voice)}?output_format=mp3_44100_128`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'xi-api-key': cfg.eleven.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }
  });
  if (!r.ok) throw await failure(r, 'ElevenLabs');
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: 'audio/mpeg' };
}

// Bulut seslendirme: hata verirse çağıran yerel sese düşer; aynı oturumda bir kez haber verilir.
let warned = {};
async function synth(engine, text, prev) {
  try { return engine === 'eleven' ? await elevenTts(text, prev) : await azureTts(text); }
  catch (e) {
    if (e.status === 401 || e.status === 403) { (engine === 'eleven' ? cfg.eleven : cfg.azure).ok = false; save(); syncUi(); }
    if (!warned[engine]) { warned[engine] = true; toast(e.message + ' Şimdilik ' + (localVoice ? 'bu bilgisayardaki sese' : 'cihazın sesine') + ' geçildi.'); }
    throw e;
  }
}

/* ---------- Ayarlar paneli: Ses bölümü ---------- */
function sysVoices() { return (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter((v) => /^tr(-|_|$)/i.test(v.lang)); }
function opt(sel, items, val) {
  sel.textContent = '';
  for (const [v, t] of items) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
  if ([...sel.options].some((o) => o.value === val)) sel.value = val;
}
function syncUi() {
  if (!$('#spStt')) return;
  opt($('#spStt'), [['azure', 'Azure (önerilen)'], ...(localVoice ? [['local', 'Bu bilgisayarda — Whisper']] : []), ...(browserSTT() ? [['browser', 'Tarayıcının kendi tanıması']] : [])], cfg.stt);
  opt($('#spTts'), [['azure', 'Azure — Emel, Ahmet…'], ['eleven', 'ElevenLabs — en insansı'], ...(localVoice ? [['local', 'Bu bilgisayarda — Piper']] : []), ['browser', 'Cihazın kendi sesi']], cfg.tts);
  const sm = sttMode(), te = ttsEngine();
  $('#spSttNote').textContent = cfg.stt !== sm ? '⚠ ' + NAMES[cfg.stt] + ' henüz kurulmadı; şimdilik ' + NAMES[sm] + ' kullanılıyor.' : sm === 'azure' ? 'Sesin, yazıya çevrilmesi için Microsoft\'a gönderilir.' : sm === 'local' ? 'Sesin bu bilgisayardan çıkmaz.' : '';
  const want = { azure: 'azure', eleven: 'eleven', local: 'piper', browser: 'browser' }[cfg.tts];
  $('#spTtsNote').textContent = want !== te ? '⚠ ' + NAMES[cfg.tts] + ' henüz kurulmadı; şimdilik ' + NAMES[te] + ' kullanılıyor.' : '';
  // Ses listesi seçilen servise göre
  const vs = $('#aiVoice');
  if (te === 'azure') opt(vs, cfg.azure.voices || [[cfg.azure.voice, cfg.azure.voice]], cfg.azure.voice);
  else if (te === 'eleven') opt(vs, cfg.eleven.voices || [[cfg.eleven.voice, cfg.eleven.voice]], cfg.eleven.voice);
  else if (te === 'piper') opt(vs, [['piper', 'Piper Türkçe (dfki, erkek)']], 'piper');
  else { const tr = sysVoices(); opt(vs, [['', tr.length ? 'Otomatik (en doğal ses)' : 'Bu cihazda Türkçe ses yok'], ...tr.map((v) => [v.voiceURI, v.name])], cfg.sysVoice); }
  $('#aiVoiceNote').textContent = te === 'piper' ? 'İlk kullanımda bir kez yaklaşık 65 MB indirilir.' : te === 'browser' && !sysVoices().length ? 'Bu cihazda Türkçe ses yok; Azure ya da ElevenLabs kur.' : '';
  $('#aiRate').value = cfg.rate; $('#aiRateOut').textContent = (+cfg.rate).toFixed(1) + '×';
  // Servis kartları
  $('#azKey').placeholder = cfg.azure.key ? 'Kayıtlı (…' + cfg.azure.key.slice(-4) + ') — değiştirmek için yeni anahtarı yapıştır' : 'KEY 1 (anahtar)';
  $('#azRegion').value = cfg.azure.region || '';
  $('#azState').textContent = !cfg.azure.key ? 'kurulmadı' : cfg.azure.ok === false ? '⚠ anahtar ya da bölge hatalı' : cfg.azure.ok ? '✓ hazır' : 'kayıtlı';
  $('#elKey').placeholder = cfg.eleven.key ? 'Kayıtlı (…' + cfg.eleven.key.slice(-4) + ') — değiştirmek için yeni anahtarı yapıştır' : 'API anahtarı';
  opt($('#elModel'), ELEVEN_MODELS, cfg.eleven.model);
  $('#elState').textContent = !cfg.eleven.key ? 'kurulmadı' : cfg.eleven.ok === false ? '⚠ anahtar geçersiz' : '✓ hazır' + (cfg.eleven.tier ? ' · ' + cfg.eleven.tier : '');
  // Kurulu değilse ilgili kart açık gelsin
  if (cfg.tts === 'azure' || cfg.stt === 'azure') $('#svcAzure').open = !azureReady();
  if (cfg.tts === 'eleven') $('#svcEleven').open = !elevenReady();
  document.dispatchEvent(new CustomEvent('pk-speech-changed'));
}
async function saveAzure() {
  const key = $('#azKey').value.trim() || cfg.azure.key, region = $('#azRegion').value.trim().toLowerCase().replace(/\s+/g, '');
  const st = $('#azState');
  if (!key) { st.textContent = 'Önce anahtarı yapıştır.'; return; }
  if (!/^[a-z0-9]+$/.test(region)) { st.textContent = 'Bölgeyi Azure\'daki gibi yaz (örnek: westeurope).'; return; }
  st.textContent = 'Deneniyor…';
  try {
    const voices = await azureVoices(key, region);
    Object.assign(cfg.azure, { key, region, ok: true, voices });
    if (!voices.some(([v]) => v === cfg.azure.voice)) cfg.azure.voice = (voices[0] || ['tr-TR-EmelNeural'])[0];
    $('#azKey').value = ''; warned.azure = false; save(); syncUi();
    toast('Azure hazır: ' + voices.length + ' Türkçe konuşabilen ses bulundu.');
    if (ttsEngine() === 'azure') testVoice();
  } catch (e) { st.textContent = '⚠ ' + (e.message === 'Failed to fetch' ? 'Bağlanılamadı; bölge adını ve interneti kontrol et.' : e.message); }
}
async function saveEleven() {
  const key = $('#elKey').value.trim() || cfg.eleven.key, st = $('#elState');
  if (!key) { st.textContent = 'Önce anahtarı yapıştır.'; return; }
  st.textContent = 'Deneniyor…';
  try {
    const voices = await elevenVoices(key);
    if (!voices.length) throw new Error('Hesapta ses bulunamadı; ElevenLabs\'te bir ses ekle.');
    Object.assign(cfg.eleven, { key, ok: true, voices, tier: await elevenTier(key) });
    if (!voices.some(([v]) => v === cfg.eleven.voice)) cfg.eleven.voice = voices[0][0];
    $('#elKey').value = ''; warned.eleven = false; save(); syncUi();
    toast('ElevenLabs hazır: ' + voices.length + ' ses bulundu.');
    if (ttsEngine() === 'eleven') testVoice();
  } catch (e) { st.textContent = '⚠ ' + e.message; }
}
function testVoice() { if (window.__ai && window.__ai.speak) { window.__ai.stopSpeaking(); window.__ai.speak('Merhaba hocam, sesim böyle. Slaytla ilgili sorularını cevaplamaya hazırım.', true); } }
function link(sel, url) { const a = $(sel); if (a) a.addEventListener('click', (e) => { e.preventDefault(); if (window.desktop && window.desktop.openExternal) window.desktop.openExternal(url); else window.open(url, '_blank', 'noopener'); }); }

if ($('#spStt')) {
  const dl = $('#azRegions'); for (const r of REGIONS) { const o = document.createElement('option'); o.value = r; dl.appendChild(o); }
  $('#spStt').addEventListener('change', (e) => { cfg.stt = e.target.value; save(); syncUi(); });
  $('#spTts').addEventListener('change', (e) => { cfg.tts = e.target.value; save(); syncUi(); });
  $('#aiVoice').addEventListener('change', (e) => {
    const te = ttsEngine();
    if (te === 'azure') cfg.azure.voice = e.target.value; else if (te === 'eleven') cfg.eleven.voice = e.target.value; else if (te === 'browser') cfg.sysVoice = e.target.value;
    save();
  });
  $('#aiRate').addEventListener('input', (e) => { cfg.rate = +e.target.value; $('#aiRateOut').textContent = cfg.rate.toFixed(1) + '×'; save(); });
  $('#aiTest').addEventListener('click', testVoice);
  $('#azSave').addEventListener('click', saveAzure);
  $('#azDel').addEventListener('click', () => { Object.assign(cfg.azure, { key: '', ok: undefined, voices: null }); save(); syncUi(); toast('Azure anahtarı bu cihazdan silindi.'); });
  $('#elSave').addEventListener('click', saveEleven);
  $('#elDel').addEventListener('click', () => { Object.assign(cfg.eleven, { key: '', ok: undefined, voices: null, tier: '' }); save(); syncUi(); toast('ElevenLabs anahtarı bu cihazdan silindi.'); });
  $('#elModel').addEventListener('change', (e) => { cfg.eleven.model = e.target.value; save(); });
  for (const id of ['#azKey', '#azRegion', '#elKey']) $(id).addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); (id === '#elKey' ? saveEleven : saveAzure)(); } });
  link('#lnkAzure', 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices');
  link('#lnkAzureFree', 'https://azure.microsoft.com/free/');
  link('#lnkEleven', 'https://elevenlabs.io/app/settings/api-keys');
  if (window.speechSynthesis) speechSynthesis.addEventListener('voiceschanged', syncUi);
  syncUi();
}

window.PKSpeech = { cfg, sttMode, ttsEngine, azureStt, synth, syncUi, sysVoices };
})();
