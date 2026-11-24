import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("страница загружается, пример выполняется, результат совпадает с интерпретатором", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.locator("#status")).toContainText("main вернула 12586269025");
  await expect(page.locator("#output")).toContainText("34");
  await expect(page.locator("#stats")).toContainText("Совпадает с интерпретатором: да");
  await expect(page.locator("#wat")).toContainText("(func $fib");
  expect(errors).toEqual([]);
});

test("ошибка компиляции показывается с позицией, исправление её убирает", async ({ page }) => {
  await page.goto("./");
  await page.locator("#source").fill("fn main() -> int { return true; }");
  await page.locator("#go").click();
  await expect(page.locator("#status")).toContainText("Ошибка компиляции, 1:27:");
  await page.locator("#source").fill("fn main() -> int { return 7; }");
  await page.locator("#go").click();
  await expect(page.locator("#status")).toContainText("main вернула 7");
});

test("ловушка показывается, а напечатанное до неё сохраняется", async ({ page }) => {
  await page.goto("./");
  await page.locator("#example").selectOption("trap");
  await expect(page.locator("#status")).toContainText("деление на ноль");
  await expect(page.locator("#output")).toHaveText("33\n50\n100");
});

test("оптимизация уменьшает модуль, а .wasm можно скачать и он валиден", async ({ page }) => {
  await page.goto("./");
  await page.locator("#source").fill("fn main() -> int { let a = 2 + 3 * 4; if 1 < 2 { return a * a; } return 0; }");
  await page.locator("#go").click();
  await expect(page.locator("#status")).toContainText("main вернула 196");
  await expect(page.locator("#stats")).toContainText("без оптимизации");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#download").click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const bytes = Buffer.concat(chunks);
  expect([...bytes.subarray(0, 4)]).toEqual([0, 0x61, 0x73, 0x6d]);
  const ok = await page.evaluate(async (b) => WebAssembly.validate(new Uint8Array(b)), [...bytes]);
  expect(ok).toBe(true);
});

test("доступность: axe без нарушений в светлой и тёмной теме", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toContainText("main вернула");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const res = await new AxeBuilder({ page }).analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`), scheme).toEqual([]);
  }
});

test("на телефоне нет горизонтальной прокрутки", async ({ page }) => {
  await page.goto("./");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("опубликованная версия известна: version.json отдаёт коммит", async ({ request }) => {
  const r = await request.get("version.json");
  expect(r.ok()).toBe(true);
  expect((await r.json()).sha).toMatch(/^[0-9a-f]{40}$/);
});

test("бесконечный цикл не замораживает страницу: остановка по времени", async ({ page }) => {
  await page.goto("./");
  await page.locator("#source").fill("fn main() -> int { while true { } return 0; }");
  await page.locator("#go").click();
  await expect(page.locator("#status")).toContainText("Остановлено", { timeout: 10_000 });
  // страница жива: можно запустить другую программу
  await page.locator("#source").fill("fn main() -> int { return 5; }");
  await page.locator("#go").click();
  await expect(page.locator("#status")).toContainText("main вернула 5");
});

test("бесконечный вывод обрезается", async ({ page }) => {
  await page.goto("./");
  await page.locator("#source").fill("fn main() -> int { let i = 0; while true { print(i); i = i + 1; } return 0; }");
  await page.locator("#go").click();
  await expect(page.locator("#status")).toContainText("вывод остановлен после 5000");
});
