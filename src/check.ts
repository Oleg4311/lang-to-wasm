// Проверка типов и областей видимости. Результат — сигнатуры функций и тип каждого выражения.

import { CompileError } from "./syntax.ts";
import type { Expr, FnDecl, Pos, Program, Stmt, Type } from "./syntax.ts";

export interface Signature {
  params: Type[];
  ret: Type;
}

export interface Checked {
  program: Program;
  sigs: Map<string, Signature>;
  types: WeakMap<Expr, Type>;
}

/** Встроенная функция: печатает число и возвращает его же. */
export const BUILTINS: ReadonlyMap<string, Signature> = new Map([["print", { params: ["int"], ret: "int" }]]);

function fail(msg: string, at: Pos): never {
  throw new CompileError(msg, at.line, at.col);
}

export function check(program: Program): Checked {
  const sigs = new Map<string, Signature>(BUILTINS);
  for (const fn of program.fns) {
    if (BUILTINS.has(fn.name)) fail(`имя «${fn.name}» занято встроенной функцией`, fn);
    if (sigs.has(fn.name)) fail(`функция «${fn.name}» объявлена дважды`, fn);
    sigs.set(fn.name, { params: fn.params.map((p) => p.type), ret: fn.ret });
  }
  const main = sigs.get("main");
  if (!main) throw new CompileError("нет функции main", 1, 1);
  if (main.params.length !== 0 || main.ret !== "int") {
    const decl = program.fns.find((f) => f.name === "main") as FnDecl;
    fail("main должна быть без параметров и возвращать int: fn main() -> int", decl);
  }
  const types = new WeakMap<Expr, Type>();
  for (const fn of program.fns) checkFn(fn, sigs, types);
  return { program, sigs, types };
}

function checkFn(fn: FnDecl, sigs: Map<string, Signature>, types: WeakMap<Expr, Type>): void {
  const scopes: Map<string, Type>[] = [new Map()];
  const seen = new Set<string>();
  for (const p of fn.params) {
    if (seen.has(p.name)) fail(`параметр «${p.name}» повторяется`, fn);
    seen.add(p.name);
    (scopes[0] as Map<string, Type>).set(p.name, p.type);
  }
  const lookup = (name: string): Type | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const t = (scopes[i] as Map<string, Type>).get(name);
      if (t) return t;
    }
    return undefined;
  };

  const expr = (e: Expr): Type => {
    const t = exprInner(e);
    types.set(e, t);
    return t;
  };
  const want = (e: Expr, t: Type, what: string): void => {
    const got = expr(e);
    if (got !== t) fail(`${what}: ожидался ${t}, а выражение имеет тип ${got}`, e);
  };
  const exprInner = (e: Expr): Type => {
    switch (e.kind) {
      case "int":
        return "int";
      case "bool":
        return "bool";
      case "var": {
        const t = lookup(e.name);
        if (!t) fail(`переменная «${e.name}» не объявлена`, e);
        return t;
      }
      case "unary":
        want(e.operand, e.op === "-" ? "int" : "bool", `операнд «${e.op}»`);
        return e.op === "-" ? "int" : "bool";
      case "binary": {
        switch (e.op) {
          case "+":
          case "-":
          case "*":
          case "/":
          case "%":
            want(e.left, "int", `левый операнд «${e.op}»`);
            want(e.right, "int", `правый операнд «${e.op}»`);
            return "int";
          case "<":
          case "<=":
          case ">":
          case ">=":
            want(e.left, "int", `левый операнд «${e.op}»`);
            want(e.right, "int", `правый операнд «${e.op}»`);
            return "bool";
          case "&&":
          case "||":
            want(e.left, "bool", `левый операнд «${e.op}»`);
            want(e.right, "bool", `правый операнд «${e.op}»`);
            return "bool";
          case "==":
          case "!=": {
            const l = expr(e.left);
            want(e.right, l, `правый операнд «${e.op}»`);
            return "bool";
          }
        }
      }
      // fallthrough недостижим: switch по BinOp исчерпывающий
      case "call": {
        const sig = sigs.get(e.name);
        if (!sig) fail(`функция «${e.name}» не объявлена`, e);
        if (e.args.length !== sig.params.length) {
          fail(`«${e.name}» принимает аргументов: ${sig.params.length}, передано: ${e.args.length}`, e);
        }
        e.args.forEach((a, i) => want(a, sig.params[i] as Type, `аргумент ${i + 1} функции «${e.name}»`));
        return sig.ret;
      }
    }
  };

  /** Возвращает true, если блок гарантированно завершается return. */
  const block = (stmts: Stmt[], loopDepth: number): boolean => {
    scopes.push(new Map());
    let returns = false;
    for (const s of stmts) {
      if (returns) fail("недостижимый код после return", s);
      if (stmt(s, loopDepth)) returns = true;
    }
    scopes.pop();
    return returns;
  };

  const stmt = (s: Stmt, loopDepth: number): boolean => {
    switch (s.kind) {
      case "let": {
        const t = expr(s.init);
        const top = scopes[scopes.length - 1] as Map<string, Type>;
        if (top.has(s.name)) fail(`переменная «${s.name}» уже объявлена в этом блоке`, s);
        top.set(s.name, t);
        return false;
      }
      case "assign": {
        const t = lookup(s.name);
        if (!t) fail(`переменная «${s.name}» не объявлена`, s);
        want(s.value, t, `присваивание «${s.name}»`);
        return false;
      }
      case "if": {
        want(s.cond, "bool", "условие if");
        const a = block(s.then, loopDepth);
        const b = s.else_ ? block(s.else_, loopDepth) : false;
        return a && b;
      }
      case "while":
        want(s.cond, "bool", "условие while");
        block(s.body, loopDepth + 1);
        return false;
      case "return":
        want(s.value, fn.ret, `return в «${fn.name}»`);
        return true;
      case "break":
      case "continue":
        if (loopDepth === 0) fail(`«${s.kind}» вне цикла`, s);
        return false;
      case "expr":
        expr(s.expr);
        return false;
      case "block":
        return block(s.body, loopDepth);
    }
  };

  if (!block(fn.body, 0)) fail(`функция «${fn.name}» может завершиться без return`, fn);
}
