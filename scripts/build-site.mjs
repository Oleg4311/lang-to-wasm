// Сборка страницы: компилятор переводится в обычный JS (tsc) и кладётся рядом со страницей, без сборщиков и зависимостей в рантайме.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

rmSync("site", { recursive: true, force: true });
mkdirSync("site", { recursive: true });
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], { stdio: "inherit" });
cpSync("site-src", "site", { recursive: true });

const examples = {};
for (const f of readdirSync("examples").sort()) {
  if (f.endsWith(".fox")) examples[f.replace(/\.fox$/, "")] = readFileSync(join("examples", f), "utf8");
}
writeFileSync("site/examples.js", `export const EXAMPLES = ${JSON.stringify(examples, null, 2)};\n`);

const sha = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
writeFileSync("site/version.json", JSON.stringify({ sha, builtAt: new Date().toISOString() }) + "\n");
console.log("страница собрана в site/, коммит", sha.slice(0, 7));
