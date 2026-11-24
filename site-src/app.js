import { CompileError, compile } from "./js/index.js";
import { EXAMPLES } from "./examples.js";

const $ = (id) => document.getElementById(id);
const select = $("example");
const source = $("source");

for (const name of Object.keys(EXAMPLES)) {
  const o = document.createElement("option");
  o.value = name;
  o.textContent = name;
  select.append(o);
}
source.value = EXAMPLES.fib;
select.addEventListener("change", () => {
  source.value = EXAMPLES[select.value];
  execute();
});

let downloadUrl = null;

function setStatus(text, kind) {
  const s = $("status");
  s.textContent = text;
  s.className = kind ?? "";
}

let worker = null;
let runId = 0;
const TIME_LIMIT_MS = 3000;

function runInWorker(bytes, source) {
  return new Promise((resolve) => {
    worker?.terminate();
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    const w = worker;
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ timeout: true });
    }, TIME_LIMIT_MS);
    w.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data);
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      resolve({ failure: e.message });
    };
    w.postMessage({ bytes, source });
  });
}

async function execute() {
  const id = ++runId;
  const optimize = $("opt").checked;
  $("output").textContent = "";
  $("wat").textContent = "";
  $("stats").textContent = "";
  $("download").hidden = true;
  let compiled;
  let plain;
  try {
    compiled = compile(source.value, { optimize });
    plain = compile(source.value, { optimize: false }).bytes.length;
  } catch (e) {
    setStatus(e instanceof CompileError ? `Ошибка компиляции, ${e.message}` : `Внутренняя ошибка: ${e instanceof Error ? e.message : e}`, "bad");
    return;
  }
  $("wat").textContent = compiled.text;
  setStatus("Выполняется…");
  const r = await runInWorker(compiled.bytes, source.value);
  if (id !== runId) return; // пока считалось, запустили другую программу
  if (r.timeout) {
    setStatus(`Остановлено: программа работает дольше ${TIME_LIMIT_MS / 1000} с (возможно, бесконечный цикл)`, "bad");
  } else if (r.failure) {
    setStatus(`Внутренняя ошибка выполнения: ${r.failure}`, "bad");
  } else {
    const { result, same } = r;
    const shown = result.output.map(String);
    $("output").textContent = shown.join("\n") + (result.trap === "output" ? "\n…" : "");
    const names = { div0: "деление на ноль", overflow: "переполнение при делении", stack: "переполнение стека", output: "вывод остановлен после 5000 чисел" };
    if (result.trap) setStatus(`Ловушка: ${names[result.trap] ?? result.trap}`, "bad");
    else setStatus(`main вернула ${result.result}${same === false ? " (внимание: интерпретатор дал другой результат)" : ""}`, same === false ? "bad" : "ok");
    $("stats").textContent =
      `Размер модуля: ${compiled.bytes.length} байт` + (optimize ? ` (без оптимизации ${plain})` : "") + `. Совпадает с интерпретатором: ${same === null ? "не проверялось" : same ? "да" : "нет"}.`;
  }
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([compiled.bytes], { type: "application/wasm" }));
  const a = $("download");
  a.href = downloadUrl;
  a.hidden = false;
}

$("go").addEventListener("click", execute);
$("opt").addEventListener("change", execute);
execute();
