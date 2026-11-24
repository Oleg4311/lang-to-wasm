// Генерация инструкций WebAssembly из проверенной программы.
//
// Соглашения: int — i64, bool — i32 (0/1). Каждая объявленная переменная получает собственный локальный слот.
// while превращается в block { loop { …; br_if выход; тело; br повтор } }, break/continue — переходы br на нужную метку.

import type { Checked } from "./check.ts";
import type { Expr, FnDecl, Stmt, Type } from "./syntax.ts";
import type { FuncBody, Instr, ModuleSpec, ValType } from "./wasm.ts";

const valType = (t: Type): ValType => (t === "int" ? "i64" : "i32");

const CMP: Record<string, Instr["op"]> = { "<": "i64.lt_s", "<=": "i64.le_s", ">": "i64.gt_s", ">=": "i64.ge_s" };
const ARITH: Record<string, Instr["op"]> = { "+": "i64.add", "-": "i64.sub", "*": "i64.mul", "/": "i64.div_s", "%": "i64.rem_s" };

interface Slot {
  index: number;
  type: Type;
}

export function generate(checked: Checked): ModuleSpec {
  const PRINT_INDEX = 0;
  const fnIndex = new Map<string, number>(checked.program.fns.map((f, i) => [f.name, i + 1]));
  const funcs = checked.program.fns.map((f) => genFn(f));
  return { importPrint: true, funcs, exportName: "main", exportIndex: fnIndex.get("main") as number };

  function genFn(fn: FnDecl): FuncBody {
    const code: Instr[] = [];
    const locals: ValType[] = [];
    const scopes: Map<string, Slot>[] = [new Map()];
    let nParams = 0;
    for (const p of fn.params) {
      (scopes[0] as Map<string, Slot>).set(p.name, { index: nParams++, type: p.type });
    }
    // метки структурного управления: depth считается от вершины стека меток
    const labels: string[] = [];
    const loops: { block: number; loop: number }[] = [];

    const find = (name: string): Slot => {
      for (let i = scopes.length - 1; i >= 0; i--) {
        const s = (scopes[i] as Map<string, Slot>).get(name);
        if (s) return s;
      }
      throw new Error(`внутренняя ошибка: переменная ${name}`);
    };
    const declare = (name: string, type: Type): Slot => {
      const slot = { index: nParams + locals.length, type };
      locals.push(valType(type));
      (scopes[scopes.length - 1] as Map<string, Slot>).set(name, slot);
      return slot;
    };
    const open = (op: "block" | "loop" | "if", result: ValType | null = null): void => {
      code.push({ op, result });
      labels.push(op);
    };
    const close = (): void => {
      code.push({ op: "end" });
      labels.pop();
    };

    /** Генерирует выражение и возвращает его тип. */
    const expr = (e: Expr): Type => {
      switch (e.kind) {
        case "int":
          code.push({ op: "i64.const", value: e.value });
          return "int";
        case "bool":
          code.push({ op: "i32.const", value: e.value ? 1 : 0 });
          return "bool";
        case "var": {
          const s = find(e.name);
          code.push({ op: "local.get", index: s.index });
          return s.type;
        }
        case "unary":
          if (e.op === "-") {
            code.push({ op: "i64.const", value: 0n });
            expr(e.operand);
            code.push({ op: "i64.sub" });
            return "int";
          }
          expr(e.operand);
          code.push({ op: "i32.eqz" });
          return "bool";
        case "binary": {
          if (e.op === "&&" || e.op === "||") {
            // ленивое вычисление: правый операнд выполняется только при необходимости
            expr(e.left);
            open("if", "i32");
            if (e.op === "&&") {
              expr(e.right);
              code.push({ op: "else" });
              code.push({ op: "i32.const", value: 0 });
            } else {
              code.push({ op: "i32.const", value: 1 });
              code.push({ op: "else" });
              expr(e.right);
            }
            close();
            return "bool";
          }
          const lt = expr(e.left);
          expr(e.right);
          if (e.op === "==" || e.op === "!=") {
            const eq = e.op === "==";
            code.push({ op: lt === "int" ? (eq ? "i64.eq" : "i64.ne") : eq ? "i32.eq" : "i32.ne" } as Instr);
            return "bool";
          }
          if (e.op in CMP) {
            code.push({ op: CMP[e.op] } as Instr);
            return "bool";
          }
          code.push({ op: ARITH[e.op] } as Instr);
          return "int";
        }
        case "call": {
          e.args.forEach((a) => expr(a));
          const sig = checked.sigs.get(e.name);
          if (!sig) throw new Error(`внутренняя ошибка: функция ${e.name}`);
          code.push({ op: "call", index: e.name === "print" ? PRINT_INDEX : (fnIndex.get(e.name) as number), name: e.name });
          return sig.ret;
        }
      }
    };

    const block = (stmts: Stmt[]): void => {
      scopes.push(new Map());
      for (const s of stmts) stmt(s);
      scopes.pop();
    };

    const stmt = (s: Stmt): void => {
      switch (s.kind) {
        case "let": {
          const t = expr(s.init);
          // слот создаётся после вычисления инициализатора: в нём ещё виден внешний «x» при `let x = x + 1`
          const slot = declare(s.name, t);
          code.push({ op: "local.set", index: slot.index });
          return;
        }
        case "assign":
          expr(s.value);
          code.push({ op: "local.set", index: find(s.name).index });
          return;
        case "if":
          expr(s.cond);
          open("if");
          block(s.then);
          if (s.else_) {
            code.push({ op: "else" });
            block(s.else_);
          }
          close();
          return;
        case "while": {
          open("block");
          open("loop");
          loops.push({ block: labels.length - 2, loop: labels.length - 1 });
          expr(s.cond);
          code.push({ op: "i32.eqz" });
          code.push({ op: "br_if", depth: 1 });
          block(s.body);
          code.push({ op: "br", depth: 0 });
          loops.pop();
          close();
          close();
          return;
        }
        case "return":
          expr(s.value);
          code.push({ op: "return" });
          return;
        case "break": {
          const l = loops[loops.length - 1] as { block: number; loop: number };
          code.push({ op: "br", depth: labels.length - 1 - l.block });
          return;
        }
        case "continue": {
          const l = loops[loops.length - 1] as { block: number; loop: number };
          code.push({ op: "br", depth: labels.length - 1 - l.loop });
          return;
        }
        case "expr":
          expr(s.expr);
          code.push({ op: "drop" });
          return;
        case "block":
          block(s.body);
          return;
      }
    };

    block(fn.body);
    // проверка типов гарантирует return на всех путях, но валидатору WebAssembly это нужно сказать явно
    code.push({ op: "unreachable" });
    return { name: fn.name, params: fn.params.map((p) => valType(p.type)), result: valType(fn.ret), locals, code };
  }
}
