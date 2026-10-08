// マイクを使うため localhost で配信する簡易サーバー
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8765;
const file = path.join(__dirname, "index.html");

http.createServer((req, res) => {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(500); res.end(String(err)); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`http://localhost:${PORT}/`));
