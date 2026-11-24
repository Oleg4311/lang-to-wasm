// Публичный интерфейс: компиляция исходника в WebAssembly и запуск результата.

import { check } from "./check.ts";
import type { Checked } from "./check.ts";
import { generate } from "./codegen.ts";
import { interpret } from "./interp.ts";
import type { RunResult, TrapKind } from "./interp.ts";
import { optimize } from "./opt.ts";
import { parse } from "./syntax.ts";
import { encodeModule, formatFunc } from "./wasm.ts";

import { CompileError } from "./syntax.ts";

export { CompileError };
export type { RunResult, TrapKind } from "./interp.ts";

export interface Compiled {
  bytes: Uint8Array;
  /** Текстовое представление (в стиле WAT) для чтения человеком. */
  text: string;
}

export interface CompileOptions {
  optimize?: boolean;
}

export function frontend(source: string): Checked {
  try {
    return check(parse(source));
  } catch (e) {
    // рекурсивный спуск упирается в стек на патологической вложенности: сообщаем как обычную ошибку программы
    if (e instanceof RangeError) throw new CompileError("слишком глубокая вложенность выражений или блоков", 1, 1);
    throw e;
  }
}

export function compile(source: string, opts: CompileOptions = {}): Compiled {
  let checked = frontend(source);
  if (opts.optimize ?? true) checked = { ...checked, program: optimize(checked.program) };
  const spec = generate(checked);
  const text = [`(module`, `  (import "env" "print" (func $print (param i64) (result i64)))`, ...spec.funcs.map((f) => formatFunc(f).replace(/^/gm, "  ")), `  (export "main" (func ${spec.exportIndex}))`, `)`].join("\n");
  return { bytes: encodeModule(spec), text };
}

/** Выполняет эталонным интерпретатором. */
export function interpretSource(source: string, opts?: { fuel?: number; maxDepth?: number }): RunResult {
  return interpret(frontend(source), opts);
}

function trapKind(e: unknown): TrapKind {
  if (e instanceof RangeError) return "stack";
  const msg = e instanceof Error ? e.message : String(e);
  if (/(divide|remainder) by zero/i.test(msg)) return "div0";
  if (/unrepresentable|overflow/i.test(msg)) return "overflow";
  if (/call stack|stack/i.test(msg)) return "stack";
  throw e;
}

/** Запускает скомпилированный модуль: main() и всё, что программа напечатала. */
export function run(bytes: Uint8Array, opts: { maxOutput?: number } = {}): RunResult {
  const output: bigint[] = [];
  const maxOutput = opts.maxOutput ?? Number.POSITIVE_INFINITY;
  const limit = new Error("output limit");
  const module = new WebAssembly.Module(bytes as BufferSource);
  const instance = new WebAssembly.Instance(module, {
    env: {
      print: (x: bigint): bigint => {
        if (output.length >= maxOutput) throw limit;
        output.push(x);
        return x;
      },
    },
  });
  try {
    const result = (instance.exports.main as () => bigint)();
    return { output, result, trap: null };
  } catch (e) {
    if (e === limit) return { output, result: null, trap: "output" };
    return { output, result: null, trap: trapKind(e) };
  }
}
