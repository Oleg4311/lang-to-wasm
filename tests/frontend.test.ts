import assert from "node:assert/strict";
import { test } from "node:test";

import { CompileError, compile } from "../src/index.ts";

function errorOf(src: string): CompileError {
  try {
    compile(src);
  } catch (e) {
    if (e instanceof CompileError) return e;
    throw e;
  }
  assert.fail(`программа должна была отвергнуться:\n${src}`);
}

const MAIN = "fn main() -> int { return 0; }";

// [исходник, часть сообщения, строка, столбец]
const BAD: [string, string, number, number][] = [
  ["fn main() -> int { return 1 }", "ожидалось «;»", 1, 29],
  ["fn main() -> int { return 1;", "не закрыта фигурная скобка", 1, 29],
  ["fn main() -> int { return 1 + ; }", "ожидалось выражение", 1, 31],
  ["fn main() -> int { return @; }", "неожиданный символ «@»", 1, 27],
  ["fn main() -> int { return 12abc; }", "число не может сразу переходить в букву", 1, 29],
  ["fn main() -> int { return 9223372036854775808; }", "не помещается в int", 1, 27],
  ["fn main() -> int { return 1 < 2 < 3; }", "цепочк", 1, 33],
  ["fn main() -> int { return x; }", "переменная «x» не объявлена", 1, 27],
  ["fn main() -> int { let a = 1; let a = 2; return a; }", "уже объявлена в этом блоке", 1, 31],
  ["fn main() -> int { return true; }", "ожидался int, а выражение имеет тип bool", 1, 27],
  ["fn main() -> int { if 1 { } return 0; }", "условие if: ожидался bool", 1, 23],
  ["fn main() -> int { while 0 { } return 0; }", "условие while: ожидался bool", 1, 26],
  ["fn main() -> int { return 1 + true; }", "правый операнд «+»", 1, 31],
  ["fn main() -> int { return 1 == true; }", "правый операнд «==»", 1, 32],
  ["fn main() -> int { return !1; }", "операнд «!»", 1, 28],
  ["fn main() -> int { return -true; }", "операнд «-»", 1, 28],
  ["fn main() -> int { let a = 1; a = true; return a; }", "присваивание «a»", 1, 35],
  ["fn main() -> int { b = 1; return 0; }", "переменная «b» не объявлена", 1, 20],
  ["fn main() -> int { break; return 0; }", "«break» вне цикла", 1, 20],
  ["fn main() -> int { continue; return 0; }", "«continue» вне цикла", 1, 20],
  ["fn main() -> int { return 1; return 2; }", "недостижимый код", 1, 30],
  ["fn main() -> int { let a = 1; }", "может завершиться без return", 1, 1],
  ["fn main() -> int { if true { return 1; } }", "может завершиться без return", 1, 1],
  ["fn main() -> int { while true { return 1; } }", "может завершиться без return", 1, 1],
  ["fn f(a: int) -> int { return a; } fn main() -> int { return f(1, 2); }", "принимает аргументов: 1, передано: 2", 1, 61],
  ["fn f(a: int) -> int { return a; } fn main() -> int { return f(true); }", "аргумент 1 функции «f»", 1, 63],
  ["fn main() -> int { return g(); }", "функция «g» не объявлена", 1, 27],
  ["fn main() -> int { return 0; } fn main() -> int { return 1; }", "объявлена дважды", 1, 32],
  ["fn print(a: int) -> int { return a; } fn main() -> int { return 0; }", "занято встроенной", 1, 1],
  ["fn f(a: int, a: int) -> int { return a; } fn main() -> int { return 0; }", "параметр «a» повторяется", 1, 1],
  ["fn f() -> int { return 0; }", "нет функции main", 1, 1],
  ["fn main(a: int) -> int { return a; }", "main должна быть без параметров", 1, 1],
  ["fn main() -> bool { return true; }", "main должна быть без параметров", 1, 1],
  ["fn main() -> int { 1 + 2; return 0; }", "должно быть вызовом", 1, 20],
  ["fn main() -> int\n{\n  let x = 1;\n  return y;\n}", "переменная «y» не объявлена", 4, 10],
  ["fn main() -> int { return 0; } extra", "ожидалось «fn»", 1, 32],
  ["", "нет функции main", 1, 1],
];

for (const [src, part, line, col] of BAD) {
  test(`ошибка: ${JSON.stringify(src).slice(0, 70)}`, () => {
    const e = errorOf(src);
    assert.ok(e.message.includes(part), `сообщение «${e.message}» не содержит «${part}»`);
    assert.deepEqual([e.line, e.col], [line, col], e.message);
    assert.ok(e.message.startsWith(`${line}:${col}: `));
  });
}

test("комментарии, пробелы и переводы строк не влияют на смысл", () => {
  assert.doesNotThrow(() => compile("// начало\nfn main() -> int { // тут\n  return 1; // конец\n}\n// хвост"));
  assert.doesNotThrow(() => compile(MAIN.replace(/ /g, "\n\t ")));
});

test("затенение в других блоках допустимо, а параметр можно перекрыть в теле", () => {
  assert.doesNotThrow(() =>
    compile(`fn f(a: int) -> int { let a = a + 1; if true { let a = 5; return a; } return a; } fn main() -> int { return f(1); }`),
  );
});

test("минимальный int записывается через унарный минус", () => {
  assert.doesNotThrow(() => compile("fn main() -> int { return -9223372036854775808; }"));
  assert.throws(() => compile("fn main() -> int { return 9223372036854775808; }"), CompileError);
  assert.throws(() => compile("fn main() -> int { return -9223372036854775809; }"), CompileError);
});

test("патологическая вложенность даёт ошибку компиляции, а не падение", () => {
  const deep = `fn main() -> int { return ${"(".repeat(50000)}1${")".repeat(50000)}; }`;
  assert.throws(() => compile(deep), (e: unknown) => e instanceof CompileError && e.message.includes("вложенность"));
  const blocks = `fn main() -> int { ${"if true { ".repeat(30000)}return 1; ${"} ".repeat(30000)} return 0; }`;
  assert.throws(() => compile(blocks), (e: unknown) => e instanceof CompileError);
});

test("ограничение вывода останавливает программу, которая печатает бесконечно", async () => {
  const { run } = await import("../src/index.ts");
  const bytes = compile("fn main() -> int { while true { print(1); } return 0; }").bytes;
  const r = run(bytes, { maxOutput: 1000 });
  assert.equal(r.trap, "output");
  assert.equal(r.output.length, 1000);
});
