// Выполнение в отдельном потоке: бесконечный цикл в программе не замораживает страницу, а вывод ограничен.
import { interpretSource, run } from "./js/index.js";

const key = (r) => JSON.stringify(r, (_, v) => (typeof v === "bigint" ? `${v}n` : v));

self.onmessage = (e) => {
  const { bytes, source } = e.data;
  const result = run(bytes, { maxOutput: 5000 });
  // сверка с интерпретатором, только если программа завершилась сама
  let same = null;
  if (result.trap !== "output") {
    const ref = interpretSource(source, { fuel: 20_000_000 });
    same = ref.trap === "fuel" ? null : key(ref) === key(result);
  }
  self.postMessage({ result, same });
};
