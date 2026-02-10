/**
 * Lokal "fil-lagring" server (ingen dependencies).
 *
 * Kører på http://localhost:3000
 * - Serverer index.html / styles.css / app.js
 * - GET  /api/records  -> læser data/records.json
 * - POST /api/records  -> skriver data/records.json
 *
 * Start:
 *   node server.js
 *
 * Tip: Hvis du kører via Live Server, gemmer appen i browser localStorage.
 *      Hvis du kører via denne server, kan du udvide app.js til at bruge /api/records.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "records.json");

function ensureDataFile(){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if(!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}
ensureDataFile();

function send(res, status, body, contentType="text/plain; charset=utf-8"){
  res.writeHead(status, {"Content-Type": contentType});
  res.end(body);
}

function serveStatic(req, res, pathname){
  const map = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
    "/README.txt": "README.txt",
  };
  const file = map[pathname];
  if(!file) return false;

  const filePath = path.join(ROOT, file);
  if(!fs.existsSync(filePath)) return false;

  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html":"text/html; charset=utf-8",
    ".css":"text/css; charset=utf-8",
    ".js":"application/javascript; charset=utf-8",
    ".txt":"text/plain; charset=utf-8",
    ".json":"application/json; charset=utf-8",
  };
  send(res, 200, fs.readFileSync(filePath), types[ext] || "application/octet-stream");
  return true;
}

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url, true);

  if(pathname === "/api/records" && req.method === "GET"){
    try{
      ensureDataFile();
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      send(res, 200, raw, "application/json; charset=utf-8");
    }catch(e){
      send(res, 500, JSON.stringify({error:String(e)}), "application/json; charset=utf-8");
    }
    return;
  }

  if(pathname === "/api/records" && req.method === "POST"){
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try{
        ensureDataFile();
        const data = JSON.parse(body || "[]");
        if(!Array.isArray(data)) throw new Error("Body skal være JSON array");
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
        send(res, 200, JSON.stringify({ok:true, count:data.length}), "application/json; charset=utf-8");
      }catch(e){
        send(res, 400, JSON.stringify({ok:false, error:String(e)}), "application/json; charset=utf-8");
      }
    });
    return;
  }

  if(serveStatic(req, res, pathname)) return;

  send(res, 404, "Not found");
});

server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
