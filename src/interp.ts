// Эталонный интерпретатор: самый простой способ выполнить программу. С ним сверяется скомпилированный код.

import type { Checked } from "./check.ts";
import type { Expr, FnDecl, Stmt } from "./syntax.ts";

export type TrapKind = "div0" | "overflow" | "stack" | "fuel" | "output";

export interface RunResult {
  output: bigint[];
  /** Значение, которое вернула main; null, если выполнение оборвалось ловушкой. */
  result: bigint | null;
  trap: TrapKind | null;
}

class Trap extends Error {
  readonly kind: TrapKind;
  constructor(kind: TrapKind) {
    super(kind);
    this.kind = kind;
  }
}

type Value = bigint | boolean;

class Return {
  readonly value: Value;
  constructor(value: Value) {
    this.value = value;
  }
}
const BREAK = Symbol("break");
const CONTINUE = Symbol("continue");

const MIN = -(1n << 63n);
const wrap = (v: bigint): bigint => BigInt.asIntN(64, v);

export interface InterpOptions {
  /** Предел числа выполненных операций (защита от бесконечных циклов). */
  fuel?: number;
  /** Предел глубины вызовов. */
  maxDepth?: number;
}

export function interpret(checked: Checked, opts: InterpOptions = {}): RunResult {
  let fuel = opts.fuel ?? 50_000_000;
  const maxDepth = opts.maxDepth ?? 10_000;
  const fns = new Map<string, FnDecl>(checked.program.fns.map((f) => [f.name, f]));
  const output: bigint[] = [];
  let depth = 0;

  const tick = (): void => {
    if (--fuel < 0) throw new Trap("fuel");
  };

  const evalExpr = (e: Expr, env: Map<string, Value>[]): Value => {
    tick();
    switch (e.kind) {
      case "int":
        return e.value;
      case "bool":
        return e.value;
      case "var":
        return lookup(env, e.name);
      case "unary":
        return e.op === "-" ? wrap(-(evalExpr(e.operand, env) as bigint)) : !(evalExpr(e.operand, env) as boolean);
      case "binary": {
        if (e.op === "&&") return (evalExpr(e.left, env) as boolean) && (evalExpr(e.right, env) as boolean);
        if (e.op === "||") return (evalExpr(e.left, env) as boolean) || (evalExpr(e.right, env) as boolean);
        const l = evalExpr(e.left, env);
        const r = evalExpr(e.right, env);
        switch (e.op) {
          case "+":
            return wrap((l as bigint) + (r as bigint));
          case "-":
            return wrap((l as bigint) - (r as bigint));
          case "*":
            return wrap((l as bigint) * (r as bigint));
          case "/":
            if (r === 0n) throw new Trap("div0");
            if (l === MIN && r === -1n) throw new Trap("overflow");
            return (l as bigint) / (r as bigint);
          case "%":
            if (r === 0n) throw new Trap("div0");
            if (r === -1n) return 0n;
            return (l as bigint) % (r as bigint);
          case "<":
            return (l as bigint) < (r as bigint);
          case "<=":
            return (l as bigint) <= (r as bigint);
          case ">":
            return (l as bigint) > (r as bigint);
          case ">=":
            return (l as bigint) >= (r as bigint);
          case "==":
            return l === r;
          case "!=":
            return l !== r;
        }
        throw new Error("неизвестная операция");
      }
      case "call": {
        const args = e.args.map((a) => evalExpr(a, env));
        if (e.name === "print") {
          output.push(args[0] as bigint);
          return args[0] as bigint;
        }
        return call(fns.get(e.name) as FnDecl, args);
      }
    }
  };

  const lookup = (env: Map<string, Value>[], name: string): Value => {
    for (let i = env.length - 1; i >= 0; i--) {
      const v = (env[i] as Map<string, Value>).get(name);
      if (v !== undefined) return v;
    }
    throw new Error(`внутренняя ошибка: переменная ${name}`);
  };

  const assign = (env: Map<string, Value>[], name: string, v: Value): void => {
    for (let i = env.length - 1; i >= 0; i--) {
      const m = env[i] as Map<string, Value>;
      if (m.has(name)) {
        m.set(name, v);
        return;
      }
    }
    throw new Error(`внутренняя ошибка: присваивание ${name}`);
  };

  const exec = (stmts: Stmt[], env: Map<string, Value>[]): typeof BREAK | typeof CONTINUE | Return | null => {
    env.push(new Map());
    try {
      for (const s of stmts) {
        tick();
        switch (s.kind) {
          case "let":
            (env[env.length - 1] as Map<string, Value>).set(s.name, evalExpr(s.init, env));
            break;
          case "assign":
            assign(env, s.name, evalExpr(s.value, env));
            break;
          case "if": {
            const branch = (evalExpr(s.cond, env) as boolean) ? s.then : s.else_;
            if (branch) {
              const r = exec(branch, env);
              if (r) return r;
            }
            break;
          }
          case "while":
            while (evalExpr(s.cond, env) as boolean) {
              tick();
              const r = exec(s.body, env);
              if (r === BREAK) break;
              if (r instanceof Return) return r;
            }
            break;
          case "return":
            return new Return(evalExpr(s.value, env));
          case "break":
            return BREAK;
          case "continue":
            return CONTINUE;
          case "expr":
            evalExpr(s.expr, env);
            break;
          case "block": {
            const r = exec(s.body, env);
            if (r) return r;
            break;
          }
        }
      }
      return null;
    } finally {
      env.pop();
    }
  };

  const call = (fn: FnDecl, args: Value[]): Value => {
    if (++depth > maxDepth) throw new Trap("stack");
    try {
      const frame = new Map<string, Value>(fn.params.map((p, i) => [p.name, args[i] as Value]));
      const r = exec(fn.body, [frame]);
      if (!(r instanceof Return)) throw new Error("внутренняя ошибка: функция без return");
      return r.value;
    } finally {
      depth--;
    }
  };

  try {
    const v = call(fns.get("main") as FnDecl, []) as bigint;
    return { output, result: v, trap: null };
  } catch (e) {
    if (e instanceof Trap) return { output, result: null, trap: e.kind };
    throw e;
  }
}
