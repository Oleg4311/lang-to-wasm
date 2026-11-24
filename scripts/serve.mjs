// Минимальный статический сервер для локального просмотра и e2e-тестов.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
};
const port = Number(process.env.PORT ?? 4183);

createServer(async (req, res) => {
  const raw = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const rel = normalize(raw).split(sep).filter((p) => p !== "").join("/");
  if (rel.split("/").includes("..")) {
    res.writeHead(400).end();
    return;
  }
  const file = join("site", raw.endsWith("/") || rel === "" ? `${rel}/index.html` : rel);
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(data);
  } catch {
    res.writeHead(404).end("не найдено");
  }
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/`));
