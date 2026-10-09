// 表示言語の切り替え。画面の文言は日本語で書き、英語は data-en 属性に持たせる。
// スクリプト内のメッセージは L("日本語", "English") で書く。

let current = "ja";

export function setLang(lang) { current = lang === "en" ? "en" : "ja"; }
export function getLang() { return current; }
export const L = (ja, en) => current === "en" ? en : ja;

// 端末の言語から、最初の表示言語を決める
export function detectLang() {
  return /^ja\b/i.test(navigator.language || "") ? "ja" : "en";
}

// data-en（中身）/ data-en-title / data-en-aria / data-en-placeholder を持つ要素を切り替える
export function applyStatic(root = document) {
  document.documentElement.lang = current;
  for (const el of root.querySelectorAll("[data-en]")) {
    if (el.dataset.ja === undefined) el.dataset.ja = el.innerHTML;
    el.innerHTML = current === "en" ? el.dataset.en : el.dataset.ja;
  }
  for (const [attr, key] of [["title", "enTitle"], ["aria-label", "enAria"], ["placeholder", "enPlaceholder"]]) {
    for (const el of root.querySelectorAll(`[data-${key.replace(/[A-Z]/g, c => "-" + c.toLowerCase())}]`)) {
      const jaKey = "ja" + key.slice(2);
      if (el.dataset[jaKey] === undefined) el.dataset[jaKey] = el.getAttribute(attr) || "";
      el.setAttribute(attr, current === "en" ? el.dataset[key] : el.dataset[jaKey]);
    }
  }
}
