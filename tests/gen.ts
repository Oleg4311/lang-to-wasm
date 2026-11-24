// Генератор случайных программ. Они всегда проходят проверку типов и всегда завершаются:
// циклы ограничены счётчиком, который увеличивается в самом начале тела (так continue безопасен),
// вызовы идут только в функции с меньшим номером, а единственная рекурсия имеет базовый случай.

class Rng {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed) * 0x9e3779b97f4a7c15n + 12345n;
  }
  next(): bigint {
    this.s = BigInt.asUintN(64, this.s + 0x9e3779b97f4a7c15n);
    let z = this.s;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    return z ^ (z >> 31n);
  }
  below(n: number): number {
    return Number(this.next() % BigInt(n));
  }
  chance(percent: number): boolean {
    return this.below(100) < percent;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.below(xs.length)] as T;
  }
}

type Ty = "int" | "bool";
interface Var {
  name: string;
  type: Ty;
}
interface FnSig {
  name: string;
  params: Ty[];
  ret: Ty;
}

const BIG = ["9223372036854775807", "9223372036854775806", "(-9223372036854775808)", "(-9223372036854775807)"];

export function generateProgram(seed: number): string {
  const r = new Rng(seed);
  const sigs: FnSig[] = [];
  const out: string[] = [];

  // рекурсивная функция с базовым случаем: проверяет вызовы самой себя
  out.push(`fn rec(n: int, acc: int) -> int { if n <= 0 { return acc; } return rec(n - 1, acc * 3 + n); }`);
  sigs.push({ name: "rec", params: ["int", "int"], ret: "int" });

  const nFns = 1 + r.below(4);
  for (let i = 0; i < nFns; i++) {
    const params: Var[] = Array.from({ length: r.below(4) }, (_, k) => ({ name: `p${k}`, type: r.chance(20) ? "bool" : "int" }));
    const ret: Ty = r.chance(25) ? "bool" : "int";
    const sig: FnSig = { name: `f${i}`, params: params.map((p) => p.type), ret };
    out.push(`fn f${i}(${params.map((p) => `${p.name}: ${p.type}`).join(", ")}) -> ${ret} {\n${body(params, ret, [...sigs], 3)}\n}`);
    sigs.push(sig);
  }
  out.push(`fn main() -> int {\n${body([], "int", [...sigs], 4)}\n}`);
  return out.join("\n");

  function body(params: Var[], ret: Ty, callable: FnSig[], budget: number): string {
    const g = new Gen(r, callable);
    g.scopes = [params.slice()];
    const lines: string[] = [];
    const n = 2 + r.below(budget + 2);
    for (let i = 0; i < n; i++) lines.push(g.stmt(1, budget, false));
    lines.push(`  return ${g.expr(ret, 3)};`);
    return lines.join("\n");
  }
}

class Gen {
  scopes: Var[][] = [[]];
  private counter = 0;
  private readonly r: Rng;
  private readonly fns: FnSig[];
  constructor(r: Rng, fns: FnSig[]) {
    this.r = r;
    this.fns = fns;
  }

  private vars(t: Ty): Var[] {
    const seen = new Map<string, Var>();
    for (const sc of this.scopes) for (const v of sc) seen.set(v.name, v);
    return [...seen.values()].filter((v) => v.type === t);
  }

  private fresh(prefix: string): string {
    return `${prefix}${this.counter++}`;
  }

  intLit(): string {
    const r = this.r;
    if (r.chance(12)) return r.pick(BIG);
    const n = r.pick([0, 1, 2, 3, 5, 7, 10, 64, 100, 255, 1000, r.below(50), r.below(100000)]);
    return r.chance(25) ? `(-${n})` : String(n);
  }

  expr(t: Ty, depth: number): string {
    const r = this.r;
    const vars = this.vars(t);
    if (depth <= 0 || r.chance(20)) {
      if (vars.length && r.chance(65)) return (r.pick(vars) as Var).name;
      return t === "int" ? this.intLit() : r.pick(["true", "false"]);
    }
    if (t === "int") {
      const calls = this.fns.filter((f) => f.ret === "int" && f.name !== "rec");
      switch (r.below(12)) {
        case 0:
        case 1:
        case 2:
        case 3:
          return `(${this.expr("int", depth - 1)} ${r.pick(["+", "-", "*"])} ${this.expr("int", depth - 1)})`;
        case 4: {
          const op = r.pick(["/", "%"]);
          // чаще безопасный делитель (2..18), иногда любой: тогда возможна ловушка
          const divisor = r.chance(75) ? `(${this.expr("int", depth - 1)} % 9 + 10)` : this.expr("int", depth - 1);
          return `(${this.expr("int", depth - 1)} ${op} ${divisor})`;
        }
        case 5:
          return `(-${this.expr("int", depth - 1)})`;
        case 6:
          return `print(${this.expr("int", depth - 1)})`;
        case 7:
          return `rec(${this.expr("int", depth - 1)} % 12, ${this.expr("int", depth - 1)})`;
        case 8:
        case 9:
          if (calls.length) return this.call(r.pick(calls), depth);
          return this.intLit();
        default:
          return vars.length ? (r.pick(vars) as Var).name : this.intLit();
      }
    }
    switch (r.below(8)) {
      case 0:
      case 1:
        return `(${this.expr("int", depth - 1)} ${r.pick(["<", "<=", ">", ">=", "==", "!="])} ${this.expr("int", depth - 1)})`;
      case 2:
        return `(${this.expr("bool", depth - 1)} ${r.pick(["&&", "||"])} ${this.expr("bool", depth - 1)})`;
      case 3:
        return `(!${this.expr("bool", depth - 1)})`;
      case 4:
        return `(${this.expr("bool", depth - 1)} ${r.pick(["==", "!="])} ${this.expr("bool", depth - 1)})`;
      case 5: {
        const calls = this.fns.filter((f) => f.ret === "bool");
        return calls.length ? this.call(r.pick(calls), depth) : r.pick(["true", "false"]);
      }
      default:
        return vars.length ? (r.pick(vars) as Var).name : r.pick(["true", "false"]);
    }
  }

  private call(f: FnSig, depth: number): string {
    return `${f.name}(${f.params.map((p) => this.expr(p, depth - 1)).join(", ")})`;
  }

  /** Блок с отдельной областью видимости. */
  private block(indent: number, budget: number, inLoop: boolean): string {
    this.scopes.push([]);
    const n = 1 + this.r.below(3);
    const lines: string[] = [];
    for (let i = 0; i < n; i++) lines.push(this.stmt(indent, budget - 1, inLoop));
    this.scopes.pop();
    return lines.join("\n");
  }

  stmt(indent: number, budget: number, inLoop: boolean): string {
    const r = this.r;
    const pad = "  ".repeat(indent);
    const kind = r.below(budget <= 0 ? 4 : 9);
    switch (kind) {
      case 0:
      case 1: {
        const t: Ty = r.chance(25) ? "bool" : "int";
        const init = this.expr(t, 3);
        const name = this.fresh("v");
        (this.scopes[this.scopes.length - 1] as Var[]).push({ name, type: t });
        return `${pad}let ${name} = ${init};`;
      }
      case 2:
      case 3: {
        const t: Ty = r.chance(25) ? "bool" : "int";
        const vars = this.vars(t);
        if (!vars.length) return `${pad}print(${this.expr("int", 2)});`;
        return `${pad}${(r.pick(vars) as Var).name} = ${this.expr(t, 3)};`;
      }
      case 4:
      case 5: {
        const cond = this.expr("bool", 3);
        const then = this.block(indent + 1, budget, inLoop);
        const els = r.chance(50) ? `\n${pad}} else {\n${this.block(indent + 1, budget, inLoop)}` : "";
        return `${pad}if ${cond} {\n${then}${els}\n${pad}}`;
      }
      case 6: {
        if (inLoop && r.chance(70)) return `${pad}if ${this.expr("bool", 2)} { ${r.pick(["break", "continue"])}; }`;
        return `${pad}print(${this.expr("int", 3)});`;
      }
      case 7:
      case 8: {
        const counter = this.fresh("c");
        const bound = 1 + r.below(3);
        this.scopes.push([]);
        const inner = this.block(indent + 1, budget - 1, true);
        this.scopes.pop();
        return `${pad}let ${counter} = 0;\n${pad}while ${counter} < ${bound} {\n${pad}  ${counter} = ${counter} + 1;\n${inner}\n${pad}}`;
      }
      default:
        return `${pad}print(${this.expr("int", 2)});`;
    }
  }
}
