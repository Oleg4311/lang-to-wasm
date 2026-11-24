import assert from "node:assert/strict";
import { test } from "node:test";

import { assertAgree } from "./engines.ts";

const MIN = -(1n << 63n);
const MAX = (1n << 63n) - 1n;

interface Case {
  name: string;
  src: string;
  output?: bigint[];
  result?: bigint;
  trap?: "div0" | "overflow" | "stack";
  maxDepth?: number;
}

const CASES: Case[] = [
  {
    name: "числа Фибоначчи (рекурсия)",
    src: `fn fib(n: int) -> int { if n < 2 { return n; } return fib(n - 1) + fib(n - 2); }
          fn main() -> int { let i = 0; while i < 12 { print(fib(i)); i = i + 1; } return fib(25); }`,
    output: [0n, 1n, 1n, 2n, 3n, 5n, 8n, 13n, 21n, 34n, 55n, 89n],
    result: 75025n,
  },
  {
    name: "наибольший общий делитель (Евклид)",
    src: `fn gcd(a: int, b: int) -> int { while b != 0 { let t = a % b; a = b; b = t; } return a; }
          fn main() -> int { print(gcd(48, 18)); print(gcd(17, 5)); print(gcd(0, 9)); return gcd(1071, 462); }`,
    output: [6n, 1n, 9n],
    result: 21n,
  },
  {
    name: "простые числа решетом перебором",
    src: `fn is_prime(n: int) -> bool {
            if n < 2 { return false; }
            let d = 2;
            while d * d <= n { if n % d == 0 { return false; } d = d + 1; }
            return true;
          }
          fn main() -> int {
            let n = 0; let count = 0;
            while n < 100 { if is_prime(n) { count = count + 1; } n = n + 1; }
            return count;
          }`,
    output: [],
    result: 25n,
  },
  {
    name: "гипотеза Коллатца",
    src: `fn steps(n: int) -> int { let c = 0; while n != 1 { if n % 2 == 0 { n = n / 2; } else { n = 3 * n + 1; } c = c + 1; } return c; }
          fn main() -> int { print(steps(27)); return steps(97); }`,
    output: [111n],
    result: 118n,
  },
  {
    name: "взаимная рекурсия",
    src: `fn even(n: int) -> bool { if n == 0 { return true; } return odd(n - 1); }
          fn odd(n: int) -> bool { if n == 0 { return false; } return even(n - 1); }
          fn main() -> int { if even(100) && !even(7) && odd(9) { return 1; } return 0; }`,
    result: 1n,
  },
  {
    name: "break и continue во вложенных циклах",
    src: `fn main() -> int {
            let total = 0; let i = 0;
            while i < 10 {
              i = i + 1;
              if i % 2 == 0 { continue; }
              let j = 0;
              while true { j = j + 1; if j > i { break; } if j == 3 { continue; } total = total + j; }
              if i > 7 { break; }
            }
            print(i);
            return total;
          }`,
    output: [9n],
    result: 83n, // i = 1,3,5,7,9: 1 + 3 + 12 + 25 + 42
  },
  {
    name: "ленивые && и ||: правая часть не вычисляется",
    src: `fn loud(x: int) -> bool { print(x); return x > 0; }
          fn main() -> int {
            if loud(0) && loud(1) { print(100); }
            if loud(2) || loud(3) { print(200); }
            if loud(-1) || loud(4) && loud(5) { print(300); }
            return 0;
          }`,
    output: [0n, 2n, 200n, -1n, 4n, 5n, 300n],
    result: 0n,
  },
  {
    name: "порядок вычисления аргументов слева направо",
    src: `fn f(a: int, b: int, c: int) -> int { return a * 100 + b * 10 + c; }
          fn main() -> int { return f(print(1), print(2), print(3)); }`,
    output: [1n, 2n, 3n],
    result: 123n,
  },
  {
    name: "затенение переменных в блоках",
    src: `fn main() -> int {
            let x = 1;
            if true { let x = 2; print(x); if true { let x = x + 10; print(x); } print(x); }
            print(x);
            let y = x + 1;
            let x = y * 5;
            return x;
          }`.replace("let x = y * 5;", "let z = y * 5;").replace("return x;", "return z;"),
    output: [2n, 12n, 2n, 1n],
    result: 10n,
  },
  {
    name: "целочисленная арифметика переполняется по модулю 2^64",
    src: `fn main() -> int { print(9223372036854775807 + 1); print(-9223372036854775808 - 1); print(9223372036854775807 * 2); print(-(-9223372036854775808)); return 0; }`,
    output: [MIN, MAX, -2n, MIN],
    result: 0n,
  },
  {
    name: "деление и остаток усекаются к нулю",
    src: `fn main() -> int { print(7 / 2); print(-7 / 2); print(7 / -2); print(-7 / -2); print(7 % 3); print(-7 % 3); print(7 % -3); print(-7 % -3); return 0; }`,
    output: [3n, -3n, -3n, 3n, 1n, -1n, 1n, -1n],
    result: 0n,
  },
  {
    name: "остаток MIN % -1 равен нулю и не падает",
    src: `fn main() -> int { let a = -9223372036854775808; let b = -1; return a % b; }`,
    result: 0n,
  },
  {
    name: "ловушка: деление на ноль",
    src: `fn main() -> int { print(1); let z = 0; print(5 / z); print(2); return 0; }`,
    output: [1n],
    trap: "div0",
  },
  {
    name: "ловушка: остаток от деления на ноль",
    src: `fn main() -> int { let z = 0; return 5 % z; }`,
    trap: "div0",
  },
  {
    name: "ловушка: MIN / -1",
    src: `fn main() -> int { let a = -9223372036854775808; let b = -1; print(7); return a / b; }`,
    output: [7n],
    trap: "overflow",
  },
  {
    name: "ловушка: переполнение стека",
    src: `fn down(n: int) -> int { return down(n + 1) + 1; } fn main() -> int { print(1); return down(0); }`,
    output: [1n],
    trap: "stack",
    maxDepth: 500,
  },
  {
    name: "сравнения bool и int, равенство булевых",
    src: `fn main() -> int {
            let t = 1 < 2; let f = 2 < 1;
            if t == !f && t != f && (t == true) && !(f == true) && 3 >= 3 && 3 <= 3 && 4 > 3 && -1 < 0 { return 7; }
            return 0;
          }`,
    result: 7n,
  },
  {
    name: "переменные цикла видят изменения; let внутри цикла инициализируется каждый раз",
    src: `fn main() -> int { let i = 0; let s = 0; while i < 5 { let k = i * i; let m = 0; m = m + k; s = s + m; i = i + 1; } return s; }`,
    result: 30n,
  },
  {
    name: "функция с булевыми параметрами",
    src: `fn xor(a: bool, b: bool) -> bool { return (a || b) && !(a && b); }
          fn main() -> int { let n = 0; if xor(true, false) { n = n + 1; } if xor(true, true) { n = n + 10; } if xor(false, false) { n = n + 100; } if xor(false, true) { n = n + 1000; } return n; }`,
    result: 1001n,
  },
  {
    name: "else if цепочки",
    src: `fn cls(n: int) -> int { if n < 0 { return -1; } else if n == 0 { return 0; } else if n < 10 { return 1; } else { return 2; } }
          fn main() -> int { return cls(-5) * 1000 + cls(0) * 100 + cls(5) * 10 + cls(50); }`,
    result: -1000n + 10n + 2n,
  },
  {
    name: "ранний return из вложенного цикла",
    src: `fn find(n: int) -> int { let i = 0; while i < 100 { let j = 0; while j < 100 { if i * j == n && i > 1 && j > 1 { return i * 1000 + j; } j = j + 1; } i = i + 1; } return -1; }
          fn main() -> int { print(find(91)); return find(97); }`,
    output: [7013n],
    result: -1n,
  },
];

for (const c of CASES) {
  test(c.name, () => {
    const e = assertAgree(c.src, c.maxDepth ? { maxDepth: c.maxDepth } : undefined);
    if (c.output) assert.deepEqual(e.interp.output, c.output);
    if (c.trap) {
      assert.equal(e.interp.trap, c.trap);
      assert.equal(e.interp.result, null);
    } else {
      assert.equal(e.interp.trap, null);
      if (c.result !== undefined) assert.equal(e.interp.result, c.result);
    }
  });
}
