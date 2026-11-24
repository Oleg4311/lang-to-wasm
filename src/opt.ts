// Оптимизатор на уровне AST: свёртка констант, подстановка неизменяемых констант, упрощение условий и циклов.
//
// Главное правило: поведение программы не меняется вообще — ни результат, ни вывод, ни ловушки.
// Поэтому выражение, которое может упасть (деление) или иметь побочный эффект (вызов), никогда не выбрасывается.
// Проверяется сравнением с интерпретатором на тысячах случайных программ (tests/differential.test.ts).

import type { BinOp, Expr, FnDecl, Pos, Program, Stmt } from "./syntax.ts";

const MIN = -(1n << 63n);
const wrap = (v: bigint): bigint => BigInt.asIntN(64, v);

/** Выражение без побочных эффектов и без возможности упасть: его можно выбросить или продублировать. */
export function effectFree(e: Expr): boolean {
  switch (e.kind) {
    case "int":
    case "bool":
    case "var":
      return true;
    case "unary":
      return effectFree(e.operand);
    case "binary":
      if (e.op === "/" || e.op === "%") {
        // делитель — константа, отличная от 0 и -1: ловушка невозможна
        const r = e.right;
        if (!(r.kind === "int" && r.value !== 0n && r.value !== -1n)) return false;
      }
      return effectFree(e.left) && effectFree(e.right);
    case "call":
      return false;
  }
}

const isInt = (e: Expr, v?: bigint): e is Expr & { kind: "int" } => e.kind === "int" && (v === undefined || e.value === v);
const isBool = (e: Expr, v?: boolean): e is Expr & { kind: "bool" } => e.kind === "bool" && (v === undefined || e.value === v);

const intLit = (at: Pos, value: bigint): Expr => ({ kind: "int", value, line: at.line, col: at.col });
const boolLit = (at: Pos, value: boolean): Expr => ({ kind: "bool", value, line: at.line, col: at.col });

function foldBinary(e: Expr & { kind: "binary" }, l: Expr, r: Expr): Expr {
  const at = e;
  const op: BinOp = e.op;
  if (isInt(l) && isInt(r)) {
    const a = l.value;
    const b = r.value;
    switch (op) {
      case "+":
        return intLit(at, wrap(a + b));
      case "-":
        return intLit(at, wrap(a - b));
      case "*":
        return intLit(at, wrap(a * b));
      case "/":
        if (b !== 0n && !(a === MIN && b === -1n)) return intLit(at, a / b);
        break;
      case "%":
        if (b !== 0n) return intLit(at, b === -1n ? 0n : a % b);
        break;
      case "<":
        return boolLit(at, a < b);
      case "<=":
        return boolLit(at, a <= b);
      case ">":
        return boolLit(at, a > b);
      case ">=":
        return boolLit(at, a >= b);
      case "==":
        return boolLit(at, a === b);
      case "!=":
        return boolLit(at, a !== b);
    }
  }
  if (isBool(l) && isBool(r) && (op === "==" || op === "!=")) {
    return boolLit(at, op === "==" ? l.value === r.value : l.value !== r.value);
  }
  switch (op) {
    case "+":
      if (isInt(r, 0n)) return l;
      if (isInt(l, 0n)) return r;
      break;
    case "-":
      if (isInt(r, 0n)) return l;
      break;
    case "*":
      if (isInt(r, 1n)) return l;
      if (isInt(l, 1n)) return r;
      if (isInt(r, 0n) && effectFree(l)) return r;
      if (isInt(l, 0n) && effectFree(r)) return l;
      break;
    case "/":
      if (isInt(r, 1n)) return l;
      break;
    case "&&":
      if (isBool(l, true)) return r;
      if (isBool(l, false)) return l;
      if (isBool(r, true)) return l;
      if (isBool(r, false) && effectFree(l)) return r;
      break;
    case "||":
      if (isBool(l, false)) return r;
      if (isBool(l, true)) return l;
      if (isBool(r, false)) return l;
      if (isBool(r, true) && effectFree(l)) return r;
      break;
    case "==":
    case "<=":
    case ">=":
      if (l.kind === "var" && r.kind === "var" && l.name === r.name) return boolLit(at, true);
      break;
    case "!=":
    case "<":
    case ">":
      if (l.kind === "var" && r.kind === "var" && l.name === r.name) return boolLit(at, false);
      break;
  }
  return { ...e, left: l, right: r };
}

// ---------- разрешение имён: какие объявления переприсваиваются ----------

type Decl = object;

function findAssigned(fn: FnDecl): Set<Decl> {
  const assigned = new Set<Decl>();
  const scopes: Map<string, Decl>[] = [new Map(fn.params.map((p) => [p.name, p]))];
  const resolve = (name: string): Decl | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const d = (scopes[i] as Map<string, Decl>).get(name);
      if (d) return d;
    }
    return undefined;
  };
  const block = (stmts: Stmt[]): void => {
    scopes.push(new Map());
    for (const s of stmts) stmt(s);
    scopes.pop();
  };
  const stmt = (s: Stmt): void => {
    switch (s.kind) {
      case "let":
        (scopes[scopes.length - 1] as Map<string, Decl>).set(s.name, s);
        return;
      case "assign": {
        const d = resolve(s.name);
        if (d) assigned.add(d);
        return;
      }
      case "if":
        block(s.then);
        if (s.else_) block(s.else_);
        return;
      case "while":
        block(s.body);
        return;
      case "block":
        block(s.body);
        return;
      default:
        return;
    }
  };
  block(fn.body);
  return assigned;
}

// ---------- основной проход ----------

interface Binding {
  decl: Decl;
  value: Expr | null; // подставляемая константа
}

function optFn(fn: FnDecl): FnDecl {
  const assigned = findAssigned(fn);
  const scopes: Map<string, Binding>[] = [new Map(fn.params.map((p) => [p.name, { decl: p, value: null }]))];
  const lookup = (name: string): Binding | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const b = (scopes[i] as Map<string, Binding>).get(name);
      if (b) return b;
    }
    return undefined;
  };

  const expr = (e: Expr): Expr => {
    switch (e.kind) {
      case "int":
      case "bool":
        return e;
      case "var": {
        const b = lookup(e.name);
        return b?.value ? { ...b.value, line: e.line, col: e.col } : e;
      }
      case "unary": {
        const o = expr(e.operand);
        if (e.op === "-") {
          if (isInt(o)) return intLit(e, wrap(-o.value));
          if (o.kind === "unary" && o.op === "-") return o.operand;
        } else {
          if (isBool(o)) return boolLit(e, !o.value);
          if (o.kind === "unary" && o.op === "!") return o.operand;
        }
        return { ...e, operand: o };
      }
      case "binary":
        return foldBinary(e, expr(e.left), expr(e.right));
      case "call":
        return { ...e, args: e.args.map(expr) };
    }
  };

  const block = (stmts: Stmt[]): Stmt[] => {
    scopes.push(new Map());
    const out: Stmt[] = [];
    for (const s of stmts) {
      const r = stmt(s);
      for (const x of r) out.push(x);
      const last = r[r.length - 1];
      // всё после безусловного выхода недостижимо
      if (last && (last.kind === "return" || last.kind === "break" || last.kind === "continue")) break;
    }
    scopes.pop();
    return out;
  };

  /** Вложенный блок можно вставить на место без потери областей видимости, если в нём нет объявлений. */
  const inline = (body: Stmt[], at: Pos): Stmt[] => {
    if (body.length === 0) return [];
    return body.some((s) => s.kind === "let") ? [{ kind: "block", body, line: at.line, col: at.col }] : body;
  };

  const stmt = (s: Stmt): Stmt[] => {
    switch (s.kind) {
      case "let": {
        const init = expr(s.init);
        const constant = (isInt(init) || isBool(init)) && !assigned.has(s);
        (scopes[scopes.length - 1] as Map<string, Binding>).set(s.name, { decl: s, value: constant ? init : null });
        return constant ? [] : [{ ...s, init }];
      }
      case "assign":
        return [{ ...s, value: expr(s.value) }];
      case "if": {
        const cond = expr(s.cond);
        if (isBool(cond)) return inline(block(cond.value ? s.then : (s.else_ ?? [])), s);
        const then = block(s.then);
        const else_ = s.else_ ? block(s.else_) : null;
        if (then.length === 0 && (else_ === null || else_.length === 0) && effectFree(cond)) return [];
        return [{ ...s, cond, then, else_: else_ && else_.length ? else_ : null }];
      }
      case "while": {
        const cond = expr(s.cond);
        if (isBool(cond, false)) return [];
        return [{ ...s, cond, body: block(s.body) }];
      }
      case "return":
        return [{ ...s, value: expr(s.value) }];
      case "break":
      case "continue":
        return [s];
      case "expr":
        return [{ ...s, expr: expr(s.expr) }];
      case "block":
        return inline(block(s.body), s);
    }
  };

  return { ...fn, body: block(fn.body) };
}

const shape = (p: Program): string => JSON.stringify(p, (k, x) => (k === "line" || k === "col" ? undefined : typeof x === "bigint" ? `${x}n` : x));

/** Повторяет проход до неподвижной точки: удаление недостижимых присваиваний открывает новые подстановки. */
export function optimize(p: Program): Program {
  let cur = p;
  let key = shape(cur);
  for (let i = 0; i < 8; i++) {
    const next: Program = { fns: cur.fns.map(optFn) };
    const nk = shape(next);
    if (nk === key) return next;
    cur = next;
    key = nk;
  }
  return cur;
}
