// Вспомогательный скрипт: показывает, куда указывает позиция ошибки для каждой «плохой» программы из tests/frontend.test.ts.
import { readFileSync } from "node:fs";

import { CompileError, compile } from "../src/index.ts";

const t = readFileSync("tests/frontend.test.ts", "utf8");
const re = /^ {2}\[("(?:[^"\\]|\\.)*"), "/gm;
for (const m of t.matchAll(re)) {
  const src = JSON.parse(m[1] as string) as string;
  try {
    compile(src);
    console.log("ПРИНЯТА?!", src);
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    const l = src.split("\n")[e.line - 1] ?? "";
    console.log(`${e.line}:${e.col}  ${l.slice(0, e.col - 1)}⟦${l.slice(e.col - 1)}   — ${e.message.replace(/^\d+:\d+: /, "")}`);
  }
}
