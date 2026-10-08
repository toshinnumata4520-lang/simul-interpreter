// 自動（実験的）モード：Gemini Live Translate で、話した言語を自動判別して訳す。
// 同じマイク音声を2つのセッションに流す。英語向けセッションは英語の発話には黙り、
// 日本語向けセッションは日本語の発話には黙るので、話した言語の反対側だけが訳を返す。
// 不要になったらこのファイルと index.html の「自動モード」部分を消せば元に戻る。

const MODEL = "gemini-3.5-live-translate-preview";
const WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const TARGETS = ["en", "ja"];

// マイクの音声（Float32）をそのまま main スレッドへ渡すだけの AudioWorklet
const WORKLET = `registerProcessor("tap", class extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
});`;

let state = null;

export async function startLive({ key, playAudio, onText, onStatus }) {
  stopLive();
  // iPhone はタップ操作の中で AudioContext を作らないと音が出ない・止まるので、await より前に作る
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const st = state = { ctx, key, playAudio, onText, onStatus, sockets: [], stream: null, node: null,
    pending: [], pendingLen: 0, playAt: 0, stopped: false, retries: 0 };
  try {
    st.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    onStatus("マイクの使用が許可されていません", true);
    stopLive();
    return false;
  }
  await ctx.resume();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const src = ctx.createMediaStreamSource(st.stream);
  st.node = new AudioWorkletNode(ctx, "tap");
  st.node.port.onmessage = e => onMic(st, e.data);
  src.connect(st.node);
  // 無音で出力に繋がないと Safari が処理を止めることがある
  const mute = ctx.createGain(); mute.gain.value = 0;
  st.node.connect(mute).connect(ctx.destination);

  for (const target of TARGETS) connect(st, target);
  onStatus("🎙 自動（日⇄英）で聞き取り中");
  return true;
}

export function stopLive() {
  const st = state; state = null;
  if (!st) return;
  st.stopped = true;
  for (const s of st.sockets) try { s.ws.close(); } catch {}
  st.stream?.getTracks().forEach(t => t.stop());
  try { st.node?.disconnect(); } catch {}
  st.ctx.close().catch(() => {});
}

function connect(st, target) {
  const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(st.key)}`);
  const sess = { ws, target, ready: false };
  st.sockets = st.sockets.filter(s => s.target !== target).concat(sess);
  ws.onopen = () => ws.send(JSON.stringify({ setup: {
    model: `models/${MODEL}`,
    // 文字起こしの指定は generationConfig の中ではなく setup の直下（公式例の位置では 1007 エラーになる）
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    generationConfig: {
      responseModalities: ["AUDIO"],
      translationConfig: { targetLanguageCode: target, echoTargetLanguage: false },
    },
    // 切断後に続きから再開できるよう、受け取った再開用の印を渡す
    ...(st.handles?.[target] ? { sessionResumption: { handle: st.handles[target] } } : {}),
  } }));
  ws.onmessage = async e => {
    const msg = JSON.parse(typeof e.data === "string" ? e.data : await e.data.text());
    if (msg.setupComplete) { sess.ready = true; st.retries = 0; return; }
    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle)
      (st.handles ||= {})[target] = msg.sessionResumptionUpdate.newHandle;
    // 接続時間の上限が近いという通知：新しい接続を張ってから古い方を閉じる
    if (msg.goAway) { connect(st, target); setTimeout(() => { try { ws.close(); } catch {} }, 1500); return; }
    const c = msg.serverContent;
    if (!c) return;
    // 原文は両セッションに同じものが届くので、英語向けセッションの分だけ使う
    if (target === "en" && c.inputTranscription?.text)
      st.onText(target, "src", c.inputTranscription.text, c.inputTranscription.languageCode);
    if (c.outputTranscription?.text) st.onText(target, "tgt", c.outputTranscription.text);
    if (st.playAudio()) for (const p of c.modelTurn?.parts || []) if (p.inlineData?.data) play(st, p.inlineData.data);
    if (c.turnComplete) st.onText(target, "end", "");
  };
  ws.onclose = e => {
    sess.ready = false;
    if (st.stopped || state !== st || !st.sockets.includes(sess)) return;   // goAway で張り替え済みなら何もしない
    // 接続時間の上限などで切れたら、少し待って張り直す
    if (++st.retries > 6) { st.onStatus(`自動モードの接続が切れました（${e.code} ${e.reason || ""}）。停止→開始で再接続してください`, true); return; }
    st.onStatus(`再接続中…（${e.code}${e.reason ? " " + e.reason : ""}）`, e.code !== 1000);
    setTimeout(() => { if (!st.stopped && state === st) connect(st, target); }, 500 * st.retries);
  };
}

// マイク音声を 16kHz・16bit PCM に変換し、約100msごとに両セッションへ送る
function onMic(st, f32) {
  st.pending.push(f32); st.pendingLen += f32.length;
  const rate = st.ctx.sampleRate;
  if (st.pendingLen < rate / 10) return;
  const all = new Float32Array(st.pendingLen);
  let o = 0; for (const p of st.pending) { all.set(p, o); o += p.length; }
  st.pending = []; st.pendingLen = 0;
  const outLen = Math.floor(all.length * 16000 / rate);
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const s = Math.max(-1, Math.min(1, all[Math.floor(i * rate / 16000)]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const data = toBase64(new Uint8Array(pcm.buffer));
  const msg = JSON.stringify({ realtimeInput: { audio: { data, mimeType: "audio/pcm;rate=16000" } } });
  for (const s of st.sockets) if (s.ready && s.ws.readyState === 1) s.ws.send(msg);
}

function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// 訳の音声（24kHz・16bit PCM）を途切れないよう順番に再生する
function play(st, b64) {
  const bin = atob(b64), n = bin.length >> 1;
  const buf = st.ctx.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    ch[i] = v / 0x8000;
  }
  const node = st.ctx.createBufferSource(); node.buffer = buf; node.connect(st.ctx.destination);
  st.playAt = Math.max(st.playAt, st.ctx.currentTime + 0.02);
  node.start(st.playAt);
  st.playAt += buf.duration;
}
