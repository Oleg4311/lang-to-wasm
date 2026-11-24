import assert from "node:assert/strict";
import { test } from "node:test";

import { interpretSource } from "../src/index.ts";
import { assertAgree } from "./engines.ts";
import { generateProgram } from "./gen.ts";

const CASES = Number(process.env.DIFF_CASES ?? 1500);

test(`случайные программы: интерпретатор, компилятор и оптимизированный компилятор дают одно и то же (${CASES} шт.)`, () => {
  let traps = 0;
  let heavy = 0;
  let printed = 0;
  let sizeDiff = 0;
  for (let seed = 1; seed <= CASES; seed++) {
    const src = generateProgram(seed);
    const e = assertAgree(src, { fuel: 5_000_000 });
    assert.notEqual(e.interp.trap, "fuel", `генератор породил незавершающуюся программу (seed ${seed})\n${src}`);
    if (e.interp.trap) traps++;
    printed += e.interp.output.length;
    sizeDiff += e.plainSize - e.optimizedSize;
  }
  // генератор не должен вырождаться: нужны и ловушки, и обычные завершения, и вывод
  assert.ok(traps > CASES * 0.02, `слишком мало программ с ловушками: ${traps}`);
  assert.ok(traps < CASES * 0.6, `слишком много программ с ловушками: ${traps}`);
  assert.ok(printed > CASES, `слишком мало вывода: ${printed}`);
  assert.ok(heavy < CASES * 0.1, `слишком много тяжёлых программ: ${heavy}`);
  assert.ok(sizeDiff >= 0, "оптимизация не должна увеличивать суммарный размер");
  console.log(`  программ: ${CASES}, с ловушками: ${traps}, тяжёлых пропущено: ${heavy}, напечатано чисел: ${printed}, сэкономлено байт: ${sizeDiff}`);
});
