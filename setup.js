// かんたん設定：Googleでログインするだけで、職員本人のGoogleアカウントに
// 通訳用プロジェクトを作り、Gemini APIを有効にして、APIキーを作成する。
// キーは呼び出し元に返すだけ（保存は index.html 側で、端末のブラウザ内のみ）。
// ログインの許可は設定が終わったらその場で取り消す。

// Google Cloud の OAuth クライアントID（設定専用プロジェクト simul-interpreter-setup で作成）
export const CLIENT_ID = "1060802056748-u9g3ko4s3a601qivk0i9ovimr3qmu79h.apps.googleusercontent.com";

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const GEMINI_API = "generativelanguage.googleapis.com";
const DISPLAY_NAME = "simul-interpreter";

// 失敗したときに「手動の手順」に切り替えるべきかを示す
export class SetupError extends Error {
  constructor(message, { fallback = true } = {}) { super(message); this.fallback = fallback; }
}

let gisLoaded = null;
function loadGis() {
  return gisLoaded ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = resolve;
    s.onerror = () => { gisLoaded = null; reject(new SetupError("Googleのログイン機能を読み込めませんでした。通信状態を確認してください", { fallback: false })); };
    document.head.append(s);
  });
}

// ボタンを押した直後（iPhone でポップアップを許可させるため、await より前）に呼ぶ
export function preloadGis() { if (CLIENT_ID) loadGis().catch(() => {}); }

function getToken() {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: r => r.error ? reject(new SetupError("Googleのログインが完了しませんでした（" + r.error + "）", { fallback: false })) : resolve(r.access_token),
      error_callback: e => reject(new SetupError(e.type === "popup_closed" ? "ログイン画面が閉じられました。もう一度お試しください" : "Googleのログインを開けませんでした（" + e.type + "）。ポップアップを許可してください", { fallback: false })),
    });
    client.requestAccessToken({ prompt: "consent" });
  });
}

async function api(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || res.status;
    const e = new SetupError(String(msg));
    e.status = res.status;
    throw e;
  }
  return data;
}

// 長時間操作（Operation）の完了を待つ
async function waitOp(token, base, op, label, onStep) {
  for (let i = 0; !op.done; i++) {
    if (i > 60) throw new SetupError(label + "が時間内に終わりませんでした");
    await new Promise(r => setTimeout(r, i < 5 ? 1000 : 2000));
    op = await api(token, "GET", `${base}/${op.name}`);
    onStep?.();
  }
  if (op.error) throw new SetupError(label + "に失敗しました：" + (op.error.message || op.error.code));
  return op.response || {};
}

// すでにこの設定で作ったプロジェクトがあれば使い回す（やり直したときに増やさない）
async function findOrCreateProject(token, step) {
  const list = await api(token, "GET",
    `https://cloudresourcemanager.googleapis.com/v1/projects?filter=${encodeURIComponent(`name:${DISPLAY_NAME} lifecycleState:ACTIVE`)}`);
  if (list.projects?.length) { step("既存の通訳用プロジェクトを使います"); return list.projects[0].projectId; }
  const id = `${DISPLAY_NAME}-${Math.random().toString(36).slice(2, 8)}`;
  step("通訳用のプロジェクトを作成しています…");
  let op;
  try {
    op = await api(token, "POST", "https://cloudresourcemanager.googleapis.com/v1/projects", { projectId: id, name: DISPLAY_NAME });
  } catch (e) {
    // Google Cloud を一度も使っていないアカウントは、利用規約への同意が済んでいないため作れない
    if (/terms of service|tos/i.test(e.message)) throw new SetupError("Google Cloud の利用規約への同意が済んでいないため、自動では作れませんでした");
    throw e;
  }
  await waitOp(token, "https://cloudresourcemanager.googleapis.com/v1", op, "プロジェクトの作成");
  return id;
}

async function enable(token, project, service, label, step) {
  step(label + "を有効にしています…");
  const op = await api(token, "POST", `https://serviceusage.googleapis.com/v1/projects/${project}/services/${service}:enable`);
  await waitOp(token, "https://serviceusage.googleapis.com/v1", op, label + "の有効化");
}

async function createKey(token, project, step) {
  step("APIキーを作成しています…");
  const op = await api(token, "POST", `https://apikeys.googleapis.com/v2/projects/${project}/locations/global/keys`, {
    displayName: "同時通訳アプリ",
    // 万一キーが漏れても Gemini API 以外には使えないように制限する
    restrictions: { apiTargets: [{ service: GEMINI_API }] },
  });
  const res = await waitOp(token, "https://apikeys.googleapis.com/v2", op, "APIキーの作成");
  if (res.keyString) return res.keyString;
  const k = await api(token, "GET", `https://apikeys.googleapis.com/v2/${res.name}/keyString`);
  return k.keyString;
}

// 作ったキーで Gemini が実際に使えるか確かめる（有効化の反映に少し時間がかかることがある）
async function testKey(key, model, step) {
  step("キーが使えるか確認しています…");
  for (let i = 0; i < 12; i++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Say OK." }] }], generationConfig: { maxOutputTokens: 5 } }),
    });
    if (r.ok) return;
    if (r.status !== 403 && r.status !== 400) throw new SetupError("キーの確認に失敗しました（" + r.status + "）", { fallback: false });
    await new Promise(res => setTimeout(res, 5000));
  }
  throw new SetupError("キーは作れましたが、まだ使えるようになっていません。数分後にもう一度お試しください", { fallback: false });
}

// 全体の流れ。成功したら APIキーの文字列を返す
export async function autoSetup({ model, onStep }) {
  if (!CLIENT_ID) throw new SetupError("かんたん設定はまだ準備中です");
  const step = msg => onStep?.(msg);
  await loadGis();
  step("Googleのログイン画面を開いています…");
  const token = await getToken();
  try {
    const project = await findOrCreateProject(token, step);
    await enable(token, project, "apikeys.googleapis.com", "キー管理の機能", step);
    await enable(token, project, GEMINI_API, "Gemini API", step);
    const key = await createKey(token, project, step);
    await testKey(key, model, step);
    return key;
  } finally {
    // ログインで得た許可は設定が終わったらすぐ取り消す
    try { google.accounts.oauth2.revoke(token, () => {}); } catch {}
  }
}
