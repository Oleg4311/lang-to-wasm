// Лексер, AST и парсер языка. Ошибки всегда с позицией «строка:столбец».

export class CompileError extends Error {
  readonly line: number;
  readonly col: number;
  constructor(message: string, line: number, col: number) {
    super(`${line}:${col}: ${message}`);
    this.name = "CompileError";
    this.line = line;
    this.col = col;
  }
}

export interface Pos {
  line: number;
  col: number;
}

// ---------- лексер ----------

export type TokKind = "int" | "ident" | "kw" | "op" | "eof";

export interface Token extends Pos {
  kind: TokKind;
  text: string;
}

const KEYWORDS = new Set(["fn", "let", "if", "else", "while", "return", "break", "continue", "true", "false", "int", "bool"]);
const TWO_CHAR = new Set(["==", "!=", "<=", ">=", "&&", "||", "->"]);
const ONE_CHAR = new Set("+-*/%<>=!(){},;:".split(""));

export function lex(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const adv = (): string => {
    const c = src[i++] as string;
    if (c === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return c;
  };
  while (i < src.length) {
    const c = src[i] as string;
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      adv();
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") adv();
    } else if (c >= "0" && c <= "9") {
      const start = { line, col };
      let text = "";
      while (i < src.length && (src[i] as string) >= "0" && (src[i] as string) <= "9") text += adv();
      const next = src[i];
      if (next !== undefined && (/[A-Za-z_]/.test(next))) {
        throw new CompileError(`число не может сразу переходить в букву «${next}»`, line, col);
      }
      out.push({ kind: "int", text, ...start });
    } else if (/[A-Za-z_]/.test(c)) {
      const start = { line, col };
      let text = "";
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i] as string)) text += adv();
      out.push({ kind: KEYWORDS.has(text) ? "kw" : "ident", text, ...start });
    } else {
      const start = { line, col };
      const two = src.slice(i, i + 2);
      if (TWO_CHAR.has(two)) {
        adv();
        adv();
        out.push({ kind: "op", text: two, ...start });
      } else if (ONE_CHAR.has(c)) {
        adv();
        out.push({ kind: "op", text: c, ...start });
      } else {
        throw new CompileError(`неожиданный символ «${c}»`, line, col);
      }
    }
  }
  out.push({ kind: "eof", text: "", line, col });
  return out;
}

// ---------- AST ----------

export type Type = "int" | "bool";

export type BinOp = "+" | "-" | "*" | "/" | "%" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "&&" | "||";

export type Expr =
  | (Pos & { kind: "int"; value: bigint })
  | (Pos & { kind: "bool"; value: boolean })
  | (Pos & { kind: "var"; name: string })
  | (Pos & { kind: "unary"; op: "-" | "!"; operand: Expr })
  | (Pos & { kind: "binary"; op: BinOp; left: Expr; right: Expr })
  | (Pos & { kind: "call"; name: string; args: Expr[] });

export type Stmt =
  | (Pos & { kind: "let"; name: string; init: Expr })
  | (Pos & { kind: "assign"; name: string; value: Expr })
  | (Pos & { kind: "if"; cond: Expr; then: Stmt[]; else_: Stmt[] | null })
  | (Pos & { kind: "while"; cond: Expr; body: Stmt[] })
  | (Pos & { kind: "return"; value: Expr })
  | (Pos & { kind: "break" })
  | (Pos & { kind: "continue" })
  | (Pos & { kind: "expr"; expr: Expr })
  /** Вложенный блок. Парсер его не создаёт: он появляется только после оптимизации. */
  | (Pos & { kind: "block"; body: Stmt[] });

export interface Param {
  name: string;
  type: Type;
}

export interface FnDecl extends Pos {
  name: string;
  params: Param[];
  ret: Type;
  body: Stmt[];
}

export interface Program {
  fns: FnDecl[];
}

// ---------- парсер (рекурсивный спуск, приоритеты по возрастанию) ----------

const INT_MAX = (1n << 63n) - 1n;

class Parser {
  private p = 0;
  private readonly toks: Token[];
  constructor(toks: Token[]) {
    this.toks = toks;
  }

  private get cur(): Token {
    return this.toks[this.p] as Token;
  }

  private err(msg: string, t: Token = this.cur): never {
    throw new CompileError(msg, t.line, t.col);
  }

  private isOp(text: string): boolean {
    return this.cur.kind === "op" && this.cur.text === text;
  }

  private isKw(text: string): boolean {
    return this.cur.kind === "kw" && this.cur.text === text;
  }

  private describe(t: Token): string {
    return t.kind === "eof" ? "конец файла" : `«${t.text}»`;
  }

  private expectOp(text: string): Token {
    if (!this.isOp(text)) this.err(`ожидалось «${text}», а встретилось ${this.describe(this.cur)}`);
    return this.toks[this.p++] as Token;
  }

  private expectKw(text: string): Token {
    if (!this.isKw(text)) this.err(`ожидалось «${text}», а встретилось ${this.describe(this.cur)}`);
    return this.toks[this.p++] as Token;
  }

  private ident(what: string): Token {
    if (this.cur.kind !== "ident") this.err(`ожидалось ${what}, а встретилось ${this.describe(this.cur)}`);
    return this.toks[this.p++] as Token;
  }

  program(): Program {
    const fns: FnDecl[] = [];
    while (this.cur.kind !== "eof") fns.push(this.fn());
    return { fns };
  }

  private type(): Type {
    if (this.isKw("int") || this.isKw("bool")) return (this.toks[this.p++] as Token).text as Type;
    return this.err(`ожидался тип (int или bool), а встретилось ${this.describe(this.cur)}`);
  }

  private fn(): FnDecl {
    const start = this.expectKw("fn");
    const name = this.ident("имя функции");
    this.expectOp("(");
    const params: Param[] = [];
    if (!this.isOp(")")) {
      for (;;) {
        const pn = this.ident("имя параметра");
        this.expectOp(":");
        params.push({ name: pn.text, type: this.type() });
        if (this.isOp(",")) this.p++;
        else break;
      }
    }
    this.expectOp(")");
    this.expectOp("->");
    const ret = this.type();
    const body = this.block();
    return { name: name.text, params, ret, body, line: start.line, col: start.col };
  }

  private block(): Stmt[] {
    this.expectOp("{");
    const out: Stmt[] = [];
    while (!this.isOp("}")) {
      if (this.cur.kind === "eof") this.err("не закрыта фигурная скобка: достигнут конец файла");
      out.push(this.stmt());
    }
    this.p++;
    return out;
  }

  private stmt(): Stmt {
    const t = this.cur;
    const pos = { line: t.line, col: t.col };
    if (this.isKw("let")) {
      this.p++;
      const name = this.ident("имя переменной").text;
      this.expectOp("=");
      const init = this.expr();
      this.expectOp(";");
      return { kind: "let", name, init, ...pos };
    }
    if (this.isKw("if")) return this.ifStmt();
    if (this.isKw("while")) {
      this.p++;
      const cond = this.expr();
      return { kind: "while", cond, body: this.block(), ...pos };
    }
    if (this.isKw("return")) {
      this.p++;
      const value = this.expr();
      this.expectOp(";");
      return { kind: "return", value, ...pos };
    }
    if (this.isKw("break") || this.isKw("continue")) {
      this.p++;
      this.expectOp(";");
      return { kind: t.text as "break" | "continue", ...pos };
    }
    if (t.kind === "ident" && this.toks[this.p + 1]?.kind === "op" && this.toks[this.p + 1]?.text === "=") {
      this.p += 2;
      const value = this.expr();
      this.expectOp(";");
      return { kind: "assign", name: t.text, value, ...pos };
    }
    const expr = this.expr();
    if (expr.kind !== "call") this.err("выражение-инструкция должно быть вызовом функции", t);
    this.expectOp(";");
    return { kind: "expr", expr, ...pos };
  }

  private ifStmt(): Stmt {
    const t = this.expectKw("if");
    const cond = this.expr();
    const then = this.block();
    let else_: Stmt[] | null = null;
    if (this.isKw("else")) {
      this.p++;
      else_ = this.isKw("if") ? [this.ifStmt()] : this.block();
    }
    return { kind: "if", cond, then, else_, line: t.line, col: t.col };
  }

  // уровни: || , && , сравнения (без цепочек) , + - , * / % , унарные , первичные
  private expr(): Expr {
    return this.binLeft(0);
  }

  private static readonly LEVELS: BinOp[][] = [["||"], ["&&"], [], ["+", "-"], ["*", "/", "%"]];

  private binLeft(level: number): Expr {
    if (level === 2) return this.comparison();
    if (level >= Parser.LEVELS.length) return this.unary();
    let left = this.binLeft(level + 1);
    for (;;) {
      const t = this.cur;
      const op = (Parser.LEVELS[level] as BinOp[]).find((o) => t.kind === "op" && t.text === o);
      if (!op) return left;
      this.p++;
      const right = this.binLeft(level + 1);
      left = { kind: "binary", op, left, right, line: t.line, col: t.col };
    }
  }

  private comparison(): Expr {
    const left = this.binLeft(3);
    const t = this.cur;
    const cmp = ["<", "<=", ">", ">=", "==", "!="].find((o) => t.kind === "op" && t.text === o);
    if (!cmp) return left;
    this.p++;
    const right = this.binLeft(3);
    const n = this.cur;
    if (n.kind === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(n.text)) {
      this.err("сравнения нельзя записывать цепочкой: используйте && и скобки");
    }
    return { kind: "binary", op: cmp as BinOp, left, right, line: t.line, col: t.col };
  }

  private unary(): Expr {
    const t = this.cur;
    if (t.kind === "op" && (t.text === "-" || t.text === "!")) {
      this.p++;
      // «-9223372036854775808» — единственное место, где допустим литерал 2^63
      const n = this.cur;
      if (t.text === "-" && n.kind === "int" && BigInt(n.text) === INT_MAX + 1n) {
        this.p++;
        return { kind: "int", value: -(INT_MAX + 1n), line: t.line, col: t.col };
      }
      return { kind: "unary", op: t.text, operand: this.unary(), line: t.line, col: t.col };
    }
    return this.primary();
  }

  private primary(): Expr {
    const t = this.cur;
    const pos = { line: t.line, col: t.col };
    if (t.kind === "int") {
      this.p++;
      const v = BigInt(t.text);
      if (v > INT_MAX) this.err(`литерал ${t.text} не помещается в int (64 бита со знаком)`, t);
      return { kind: "int", value: v, ...pos };
    }
    if (this.isKw("true") || this.isKw("false")) {
      this.p++;
      return { kind: "bool", value: t.text === "true", ...pos };
    }
    if (this.isOp("(")) {
      this.p++;
      const e = this.expr();
      this.expectOp(")");
      return e;
    }
    if (t.kind === "ident") {
      this.p++;
      if (this.isOp("(")) {
        this.p++;
        const args: Expr[] = [];
        if (!this.isOp(")")) {
          for (;;) {
            args.push(this.expr());
            if (this.isOp(",")) this.p++;
            else break;
          }
        }
        this.expectOp(")");
        return { kind: "call", name: t.text, args, ...pos };
      }
      return { kind: "var", name: t.text, ...pos };
    }
    return this.err(`ожидалось выражение, а встретилось ${this.describe(t)}`);
  }
}

export function parse(src: string): Program {
  return new Parser(lex(src)).program();
}
