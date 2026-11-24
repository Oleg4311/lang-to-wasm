// Мутационная проверка: ломаем компилятор и оптимизатор по одной детали и убеждаемся, что тесты это замечают.
// Сначала обязателен зелёный базовый прогон: иначе «поймано» ничего не значит.
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const ONLY = process.argv[2];
const MUTATIONS = [
  ["src/codegen.ts", 'code.push({ op: "br_if", depth: 1 });', 'code.push({ op: "br_if", depth: 0 });', "выход из цикла по неверной метке"],
  ["src/codegen.ts", "depth: labels.length - 1 - l.loop", "depth: labels.length - 1 - l.block", "continue прыгает на выход из цикла"],
  ["src/codegen.ts", "depth: labels.length - 1 - l.block", "depth: labels.length - 1 - l.loop", "break прыгает на начало цикла"],
  ["src/codegen.ts", 'code.push({ op: "i32.const", value: 0 });\n            } else {', 'code.push({ op: "i32.const", value: 1 });\n            } else {', "&& при ложном левом даёт true"],
  ["src/codegen.ts", 'code.push({ op: "i64.const", value: 0n });\n            expr(e.operand);\n            code.push({ op: "i64.sub" });', 'expr(e.operand);\n            code.push({ op: "i64.const", value: 0n });\n            code.push({ op: "i64.sub" });', "унарный минус с перепутанным порядком"],
  ["src/codegen.ts", 'const slot = declare(s.name, t);', 'const slot = declare(s.name, t); scopes[scopes.length - 1]!.set(s.name, slot);\n          void 0;', "(контроль) безвредное изменение", true],
  ["src/opt.ts", "if (isInt(r, 0n) && effectFree(l)) return r;", "if (isInt(r, 0n)) return r;", "умножение на ноль выбрасывает вызов слева"],
  ["src/opt.ts", "if (isInt(l, 0n) && effectFree(r)) return l;", "if (isInt(l, 0n)) return l;", "умножение на ноль выбрасывает деление справа"],
  ["src/opt.ts", "if (isInt(l, 0n)) return r;", "if (isInt(l, 0n) || isInt(l, 1n)) return r;", "1 + x превращается в x"],
  ["src/opt.ts", "return intLit(at, wrap(a * b));", "return intLit(at, a * b);", "свёртка умножения без переполнения 2^64"],
  ["src/opt.ts", "if (b !== 0n && !(a === MIN && b === -1n)) return intLit(at, a / b);", "if (b !== 0n) return intLit(at, a / b);", "свёртка MIN / -1 вместо ловушки"],
  ["src/opt.ts", "if (b !== 0n) return intLit(at, b === -1n ? 0n : a % b);", "if (true) return intLit(at, b === 0n ? 0n : a % b);", "свёртка остатка от деления на ноль"],
  ["src/opt.ts", "if (isBool(cond)) return inline(block(cond.value ? s.then : (s.else_ ?? [])), s);", "if (isBool(cond)) return inline(block(cond.value ? (s.else_ ?? []) : s.then), s);", "if с константой выбирает не ту ветку"],
  ["src/opt.ts", "const constant = (isInt(init) || isBool(init)) && !assigned.has(s);", "const constant = isInt(init) || isBool(init);", "подстановка константы в изменяемую переменную"],
  ["src/opt.ts", "if (isBool(r, false) && effectFree(l)) return r;", "if (isBool(r, false)) return r;", "x && false выбрасывает вызов в x"],
  ["src/opt.ts", "if (isBool(cond, false)) return [];", "if (isBool(cond, true)) return [];", "while true исчезает"],
  ["src/wasm.ts", "const done = (v === 0n && (byte & 0x40) === 0) || (v === -1n && (byte & 0x40) !== 0);", "const done = v === 0n || v === -1n;", "знаковый LEB128 обрывается слишком рано"],
  ["src/check.ts", 'if (!block(fn.body, 0)) fail(`функция «${fn.name}» может завершиться без return`, fn);', "block(fn.body, 0);", "пропущен контроль return на всех путях"],
  ["src/interp.ts", "if (r === -1n) return 0n;", "if (r === -1n) throw new Trap(\"overflow\");", "эталон: MIN % -1 как ловушка"],
];

const run = () => spawnSync(process.execPath, ["--test", "--test-timeout=30000", "tests/*.test.ts"], { encoding: "utf8", timeout: 240000, killSignal: "SIGKILL", env: { ...process.env, DIFF_CASES: "400" } });

const base = run();
if (base.status !== 0) {
  console.log("БАЗОВЫЙ ПРОГОН КРАСНЫЙ — проверка мутаций бессмысленна");
  console.log(base.stdout.slice(-2000));
  process.exit(2);
}
let missed = 0;
for (const [file, from, to, name, control] of MUTATIONS) {
  if (ONLY && !name.includes(ONLY)) continue;
  const src = readFileSync(file, "utf8");
  if (!src.includes(from)) {
    console.log(`НЕ НАЙДЕНО  ${name}`);
    missed++;
    continue;
  }
  copyFileSync(file, `${file}.bak`);
  writeFileSync(file, src.replace(from, to));
  const r = run();
  renameSync(`${file}.bak`, file);
  const caught = r.status !== 0;
  if (control) {
    console.log(`${caught ? "КОНТРОЛЬ УПАЛ" : "контроль зелёный"}  ${name}`);
    if (caught) missed++;
  } else {
    console.log(`${caught ? "поймано  " : "ПРОПУЩЕНО"}  ${name}`);
    if (!caught) missed++;
  }
}
console.log(missed === 0 ? "\nвсе мутации пойманы" : `\nпроблем: ${missed}`);
process.exit(missed === 0 ? 0 : 1);
