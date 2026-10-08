# 同時通訳 JA⇄EN

ブラウザで動く日本語⇄英語の同時通訳アプリ。音声認識はブラウザ内蔵機能、翻訳は Gemini API（無料枠、gemini-3.5-flash-lite）または Claude API（有料、Haiku 5.5）を設定で選べる。

- 公開ページ: https://toshinnumata4520-lang.github.io/simul-interpreter/
- APIキーは各端末のブラウザ内にのみ保存され、このリポジトリには含まれません。
- PCで使う場合は `start.bat` でローカル起動もできます（Node.js が必要）。

## 自動モード（実験的）
方向ボタンを「自動」にすると、Gemini Live Translate（`gemini-3.5-live-translate-preview`）で話した言語を自動判別して訳す。
英語向け・日本語向けの2つの接続に同じマイク音声を流し、話した言語と反対側の接続だけが訳を返す仕組み。

消すとき: `live.js` を削除し、`index.html` の「自動モード」と書かれたブロックと行を削除する。
または `git checkout before-live -- index.html server.js` と `git rm live.js` で、追加前の状態に戻せる。
