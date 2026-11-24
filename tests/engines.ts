// Общий помощник тестов: выполняет программу всеми тремя способами и сверяет их между собой.

import assert from "node:assert/strict";

import { compile, interpretSource, run } from "../src/index.ts";
import type { RunResult } from "../src/index.ts";

export interface Engines {
  interp: RunResult;
  plain: RunResult;
  optimized: RunResult;
  plainSize: number;
  optimizedSize: number;
}

export function runAll(src: string, interpOpts?: { fuel?: number; maxDepth?: number }): Engines {
  const interp = interpretSource(src, interpOpts);
  const a = compile(src, { optimize: false });
  const b = compile(src, { optimize: true });
  assert.ok(WebAssembly.validate(a.bytes as BufferSource), `неоптимизированный модуль не прошёл валидацию:\n${a.text}`);
  assert.ok(WebAssembly.validate(b.bytes as BufferSource), `оптимизированный модуль не прошёл валидацию:\n${b.text}`);
  return { interp, plain: run(a.bytes), optimized: run(b.bytes), plainSize: a.bytes.length, optimizedSize: b.bytes.length };
}

/** Три движка обязаны дать одно и то же: вывод, результат и ловушку. */
export function assertAgree(src: string, interpOpts?: { fuel?: number; maxDepth?: number }): Engines {
  const e = runAll(src, interpOpts);
  const where = `\n--- программа ---\n${src}`;
  assert.deepEqual(e.plain, e.interp, `компилятор без оптимизации расходится с интерпретатором${where}`);
  assert.deepEqual(e.optimized, e.interp, `оптимизированный код расходится с интерпретатором${where}`);
  return e;
}
