import assert from "node:assert/strict";
import { test } from "node:test";

import { frontend } from "../src/index.ts";
import { compile } from "../src/index.ts";
import { optimize } from "../src/opt.ts";
import { generateProgram } from "./gen.ts";
import { assertAgree } from "./engines.ts";

const main = (body: string): string => `fn main() -> int { ${body} }`;
const size = (src: string, optimized: boolean): number => compile(src, { optimize: optimized }).bytes.length;

test("константы сворачиваются: тело main сводится к одному return", () => {
  const src = main("let a = 2 + 3 * 4; let b = a * a - 1; return b % 7 + (10 / 3);");
  const text = compile(src).text;
  assert.match(text, /i64\.const 9\b/); // a = 14, b = 195, 195 % 7 = 6, 10 / 3 = 3, итого 9
  assert.ok(!/i64\.(add|mul|sub|rem_s|div_s)/.test(text), text);
  assert.equal(assertAgree(src).interp.result, 9n);
});

test("ветки с константным условием и циклы while false исчезают", () => {
  const src = main("if 1 > 2 { print(1); } else { print(2); } while false { print(3); } if true { return 5; } return 6;");
  const text = compile(src).text;
  assert.ok(!/\bif\b|\bloop\b/.test(text), text);
  assert.deepEqual(assertAgree(src).interp.output, [2n]);
});

test("побочные эффекты и ловушки не выбрасываются", () => {
  // вызов в операнде умножения на ноль должен остаться
  const a = main("let x = print(7) * 0; return x;");
  assert.deepEqual(assertAgree(a).interp.output, [7n]);
  // деление на ноль остаётся ловушкой, даже если результат умножается на ноль
  const b = main("let z = 0; let y = (1 / z) * 0; return y;");
  assert.equal(assertAgree(b).interp.trap, "div0");
  // false && ... не вычисляет правую часть, но true && f() обязана вызвать f
  const c = `fn f() -> bool { print(1); return true; } fn main() -> int { if true && f() { return 1; } return 0; }`;
  assert.deepEqual(assertAgree(c).interp.output, [1n]);
  // false || f() вызывает f; x || true при вызове слева тоже
  const d = `fn f() -> bool { print(2); return false; } fn main() -> int { if f() || true { return 1; } return 0; }`;
  assert.deepEqual(assertAgree(d).interp.output, [2n]);
  // деление на литерал -1 для MIN остаётся ловушкой
  const e = main("let m = -9223372036854775808; return m / -1;");
  assert.equal(assertAgree(e).interp.trap, "overflow");
});

test("переприсваиваемую переменную нельзя заменить константой", () => {
  const src = main("let a = 1; let i = 0; while i < 3 { a = a * 2; i = i + 1; } return a;");
  assert.equal(assertAgree(src).interp.result, 8n);
  const shadow = main("let a = 1; if true { let a = 2; a = a + 1; print(a); } return a;");
  assert.deepEqual(assertAgree(shadow).interp.output, [3n]);
  assert.equal(assertAgree(shadow).interp.result, 1n);
});

test("недостижимый код после break/continue/return убирается", () => {
  const src = main("let i = 0; while true { i = i + 1; if i > 3 { break; print(99); } } return i;");
  const e = assertAgree(src);
  assert.equal(e.interp.result, 4n);
  assert.deepEqual(e.interp.output, []);
});

test("оптимизация не увеличивает код и действительно сокращает его на типичных программах", () => {
  let better = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const src = generateProgram(seed);
    const [plain, opt] = [size(src, false), size(src, true)];
    assert.ok(opt <= plain, `оптимизация раздула код (seed ${seed}): ${plain} → ${opt}`);
    if (opt < plain) better++;
  }
  assert.ok(better > 20, `оптимизация почти ничего не сократила: ${better}/200`);
});

test("оптимизатор идемпотентен: повторный проход ничего не меняет", () => {
  const strip = (v: unknown): string => JSON.stringify(v, (k, x) => (k === "line" || k === "col" ? undefined : typeof x === "bigint" ? `${x}n` : x));
  for (let seed = 1; seed <= 300; seed++) {
    const once = optimize(frontend(generateProgram(seed)).program);
    const twice = optimize(once);
    assert.equal(strip(twice), strip(once), `seed ${seed}`);
  }
});
