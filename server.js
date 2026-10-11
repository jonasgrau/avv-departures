// Local development server: static files from public/ plus the departures API
const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { handleDeparturesRequest } = require("./lib/board");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Mirrors Vercel's cleanUrls: /anzeige serves anzeige.html
async function resolveFile(pathname) {
  const target = path.resolve(PUBLIC_DIR, "." + decodeURIComponent(pathname));
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) return null;

  for (const candidate of [target, target + ".html", path.join(target, "index.html")]) {
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  return null;
}

async function serveStatic(req, res, pathname) {
  const file = await resolveFile(pathname);
  if (!file) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Nicht gefunden");
    return;
  }
  res.setHeader("Content-Type", MIME_TYPES[path.extname(file)] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.end(await fs.readFile(file));
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname === "/api/departures") return handleDeparturesRequest(req, res);
  serveStatic(req, res, pathname).catch((err) => {
    console.error(err);
    res.statusCode = 500;
    res.end();
  });
});

server.listen(PORT, () => {
  console.log(`Bushof-Monitor läuft auf http://localhost:${PORT}`);
  if (process.env.DEMO === "1") console.log("Demo-Modus: Beispieldaten statt Live-Daten");
});
