import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeModule, sleb, uleb } from "../src/wasm.ts";

const hex = (a: number[]): string => a.map((b) => b.toString(16).padStart(2, "0")).join(" ");

// независимые декодеры: проверяем кодировщик не им же самим
function readUleb(b: number[]): [bigint, number] {
  let r = 0n;
  let shift = 0n;
  let i = 0;
  for (;;) {
    const byte = b[i++] as number;
    r |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
    if (!(byte & 0x80)) return [r, i];
  }
}
function readSleb(b: number[]): [bigint, number] {
  let r = 0n;
  let shift = 0n;
  let i = 0;
  let byte: number;
  do {
    byte = b[i++] as number;
    r |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
  } while (byte & 0x80);
  if (byte & 0x40) r -= 1n << shift;
  return [r, i];
}

test("LEB128: эталонные векторы из спецификации и Википедии", () => {
  assert.equal(hex(uleb(0)), "00");
  assert.equal(hex(uleb(127)), "7f");
  assert.equal(hex(uleb(128)), "80 01");
  assert.equal(hex(uleb(624485)), "e5 8e 26");
  assert.equal(hex(sleb(0)), "00");
  assert.equal(hex(sleb(-1)), "7f");
  assert.equal(hex(sleb(63)), "3f");
  assert.equal(hex(sleb(64)), "c0 00");
  assert.equal(hex(sleb(-64)), "40");
  assert.equal(hex(sleb(-65)), "bf 7f");
  assert.equal(hex(sleb(-123456)), "c0 bb 78");
  assert.equal(hex(sleb(2)), "02");
});

test("LEB128: границы 64 бит туда и обратно", () => {
  const MIN = -(1n << 63n);
  const MAX = (1n << 63n) - 1n;
  for (const v of [MIN, MIN + 1n, -1n, 0n, 1n, MAX - 1n, MAX, 63n, 64n, -64n, -65n, 8191n, 8192n, -8192n, -8193n]) {
    const enc = sleb(v);
    assert.deepEqual(readSleb(enc), [v, enc.length], `sleb ${v}`);
    assert.ok(enc.length <= 10);
  }
  for (const v of [0n, 1n, 127n, 128n, 16383n, 16384n, (1n << 64n) - 1n]) {
    const enc = uleb(v);
    assert.deepEqual(readUleb(enc), [v, enc.length], `uleb ${v}`);
  }
  assert.throws(() => uleb(-1));
});

test("LEB128: случайные числа туда и обратно, кодирование минимально", () => {
  let x = 0x1234_5678_9abc_def0n;
  for (let i = 0; i < 5000; i++) {
    x = BigInt.asUintN(64, x * 6364136223846793005n + 1442695040888963407n);
    const v = BigInt.asIntN(64, x >> BigInt(i % 60));
    const enc = sleb(v);
    assert.deepEqual(readSleb(enc), [v, enc.length]);
    // минимальность: последний байт без «продолжения», предпоследний не лишний
    assert.equal(enc[enc.length - 1]! & 0x80, 0);
    if (enc.length > 1) {
      const shorter = enc.slice(0, -1);
      shorter[shorter.length - 1]! &= 0x7f;
      assert.notEqual(readSleb(shorter)[0], v, "кодирование не минимально");
    }
  }
});

test("пустой модуль с одной функцией проходит валидацию WebAssembly", () => {
  const bytes = encodeModule({
    importPrint: false,
    funcs: [{ name: "main", params: [], result: "i64", locals: [], code: [{ op: "i64.const", value: 42n }, { op: "return" }, { op: "unreachable" }] }],
    exportName: "main",
    exportIndex: 0,
  });
  assert.deepEqual([...bytes.slice(0, 8)], [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  assert.ok(WebAssembly.validate(bytes as BufferSource));
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource));
  assert.equal((inst.exports.main as () => bigint)(), 42n);
});

test("локальные переменные одного типа сворачиваются в группы, разные типы не смешиваются", () => {
  const bytes = encodeModule({
    importPrint: false,
    funcs: [
      {
        name: "main",
        params: [],
        result: "i64",
        locals: ["i64", "i64", "i32", "i64", "i32", "i32"],
        code: [
          { op: "i64.const", value: 7n },
          { op: "local.set", index: 3 },
          { op: "i32.const", value: 1 },
          { op: "local.set", index: 4 },
          { op: "local.get", index: 3 },
          { op: "return" },
          { op: "unreachable" },
        ],
      },
    ],
    exportName: "main",
    exportIndex: 0,
  });
  assert.ok(WebAssembly.validate(bytes as BufferSource));
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource));
  assert.equal((inst.exports.main as () => bigint)(), 7n);
});
