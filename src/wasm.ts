// Бинарный кодировщик WebAssembly: LEB128, секции, инструкции. Всё вручную, без библиотек.
// Здесь же текстовый вывод (в стиле WAT) из тех же инструкций, чтобы показывать результат человеку.

export type ValType = "i32" | "i64";

const VALTYPE: Record<ValType, number> = { i32: 0x7f, i64: 0x7e };

// ---------- LEB128 ----------

/** Беззнаковый LEB128 (индексы, длины). */
export function uleb(value: number | bigint): number[] {
  let v = BigInt(value);
  if (v < 0n) throw new RangeError("uleb: отрицательное число");
  const out: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    out.push(byte);
  } while (v !== 0n);
  return out;
}

/** Знаковый LEB128 (константы). Работает для любых целых, в том числе 64-битных. */
export function sleb(value: number | bigint): number[] {
  let v = BigInt(value);
  const out: number[] = [];
  for (;;) {
    const byte = Number(v & 0x7fn);
    v >>= 7n; // арифметический сдвиг у BigInt
    const done = (v === 0n && (byte & 0x40) === 0) || (v === -1n && (byte & 0x40) !== 0);
    out.push(done ? byte : byte | 0x80);
    if (done) return out;
  }
}

// ---------- инструкции ----------

export type Instr =
  | { op: "i64.const"; value: bigint }
  | { op: "i32.const"; value: number }
  | { op: "local.get" | "local.set" | "local.tee"; index: number }
  | { op: "call"; index: number; name?: string }
  | { op: "br" | "br_if"; depth: number }
  | { op: "block" | "loop" | "if"; result: ValType | null }
  | { op: SimpleOp };

export type SimpleOp =
  | "unreachable"
  | "else"
  | "end"
  | "return"
  | "drop"
  | "i32.eqz"
  | "i32.eq"
  | "i32.ne"
  | "i64.eqz"
  | "i64.eq"
  | "i64.ne"
  | "i64.lt_s"
  | "i64.gt_s"
  | "i64.le_s"
  | "i64.ge_s"
  | "i64.add"
  | "i64.sub"
  | "i64.mul"
  | "i64.div_s"
  | "i64.rem_s";

const SIMPLE: Record<SimpleOp, number> = {
  unreachable: 0x00,
  else: 0x05,
  end: 0x0b,
  return: 0x0f,
  drop: 0x1a,
  "i32.eqz": 0x45,
  "i32.eq": 0x46,
  "i32.ne": 0x47,
  "i64.eqz": 0x50,
  "i64.eq": 0x51,
  "i64.ne": 0x52,
  "i64.lt_s": 0x53,
  "i64.gt_s": 0x55,
  "i64.le_s": 0x57,
  "i64.ge_s": 0x59,
  "i64.add": 0x7c,
  "i64.sub": 0x7d,
  "i64.mul": 0x7e,
  "i64.div_s": 0x7f,
  "i64.rem_s": 0x81,
};

export function encodeInstr(i: Instr, out: number[]): void {
  switch (i.op) {
    case "i64.const":
      out.push(0x42, ...sleb(BigInt.asIntN(64, i.value)));
      return;
    case "i32.const":
      out.push(0x41, ...sleb(i.value | 0));
      return;
    case "local.get":
      out.push(0x20, ...uleb(i.index));
      return;
    case "local.set":
      out.push(0x21, ...uleb(i.index));
      return;
    case "local.tee":
      out.push(0x22, ...uleb(i.index));
      return;
    case "call":
      out.push(0x10, ...uleb(i.index));
      return;
    case "br":
      out.push(0x0c, ...uleb(i.depth));
      return;
    case "br_if":
      out.push(0x0d, ...uleb(i.depth));
      return;
    case "block":
      out.push(0x02, i.result ? VALTYPE[i.result] : 0x40);
      return;
    case "loop":
      out.push(0x03, i.result ? VALTYPE[i.result] : 0x40);
      return;
    case "if":
      out.push(0x04, i.result ? VALTYPE[i.result] : 0x40);
      return;
    default:
      out.push(SIMPLE[i.op]);
  }
}

// ---------- модуль ----------

export interface FuncBody {
  name: string;
  params: ValType[];
  result: ValType;
  /** Типы локальных переменных после параметров. */
  locals: ValType[];
  code: Instr[];
}

export interface ModuleSpec {
  /** Импортированная функция print(i64) -> i64 из модуля «env». */
  importPrint: boolean;
  funcs: FuncBody[];
  exportName: string;
  exportIndex: number;
}

function section(id: number, payload: number[]): number[] {
  return [id, ...uleb(payload.length), ...payload];
}

function vec(items: number[][]): number[] {
  return [...uleb(items.length), ...items.flat()];
}

function name(s: string): number[] {
  const bytes = [...new TextEncoder().encode(s)];
  return [...uleb(bytes.length), ...bytes];
}

function funcType(params: ValType[], result: ValType): number[] {
  return [0x60, ...uleb(params.length), ...params.map((p) => VALTYPE[p]), 0x01, VALTYPE[result]];
}

export function encodeModule(m: ModuleSpec): Uint8Array {
  const types: number[][] = [];
  const typeKey: string[] = [];
  const typeIndex = (params: ValType[], result: ValType): number => {
    const key = `${params.join(",")}->${result}`;
    let i = typeKey.indexOf(key);
    if (i < 0) {
      i = typeKey.length;
      typeKey.push(key);
      types.push(funcType(params, result));
    }
    return i;
  };

  const printType = m.importPrint ? typeIndex(["i64"], "i64") : -1;
  const funcTypes = m.funcs.map((f) => typeIndex(f.params, f.result));

  const out: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  out.push(...section(1, vec(types)));
  if (m.importPrint) out.push(...section(2, vec([[...name("env"), ...name("print"), 0x00, ...uleb(printType)]])));
  out.push(...section(3, vec(funcTypes.map((t) => uleb(t)))));
  out.push(...section(7, vec([[...name(m.exportName), 0x00, ...uleb(m.exportIndex)]])));

  const bodies = m.funcs.map((f) => {
    // локальные одного типа подряд сворачиваются в группу (счётчик, тип)
    const groups: number[][] = [];
    for (let i = 0; i < f.locals.length; ) {
      let j = i;
      while (j < f.locals.length && f.locals[j] === f.locals[i]) j++;
      groups.push([...uleb(j - i), VALTYPE[f.locals[i] as ValType]]);
      i = j;
    }
    const body: number[] = [...vec(groups)];
    for (const ins of f.code) encodeInstr(ins, body);
    body.push(0x0b); // конец функции
    return [...uleb(body.length), ...body];
  });
  out.push(...section(10, vec(bodies)));
  return Uint8Array.from(out);
}

// ---------- текстовый вывод ----------

export function formatInstr(i: Instr): string {
  switch (i.op) {
    case "i64.const":
      return `i64.const ${i.value}`;
    case "i32.const":
      return `i32.const ${i.value}`;
    case "local.get":
    case "local.set":
    case "local.tee":
      return `${i.op} ${i.index}`;
    case "call":
      return i.name ? `call ${i.index} ;; ${i.name}` : `call ${i.index}`;
    case "br":
    case "br_if":
      return `${i.op} ${i.depth}`;
    case "block":
    case "loop":
    case "if":
      return i.result ? `${i.op} (result ${i.result})` : i.op;
    default:
      return i.op;
  }
}

export function formatFunc(f: FuncBody): string {
  const lines: string[] = [];
  const params = f.params.map((p) => `(param ${p})`).join(" ");
  lines.push(`(func $${f.name} ${params} (result ${f.result})`.replace("  ", " "));
  if (f.locals.length) lines.push(`  (local ${f.locals.join(" ")})`);
  let depth = 1;
  for (const ins of f.code) {
    if (ins.op === "end" || ins.op === "else") depth--;
    lines.push(`${"  ".repeat(depth)}${formatInstr(ins)}`);
    if (ins.op === "block" || ins.op === "loop" || ins.op === "if" || ins.op === "else") depth++;
  }
  lines.push(")");
  return lines.join("\n");
}
