// Командная строка: node src/cli.ts <команда> файл.fox
import { readFileSync, writeFileSync } from "node:fs";

import { CompileError, compile, interpretSource, run } from "./index.ts";

const HELP = `lang-to-wasm — компилятор маленького языка в WebAssembly

Использование: node src/cli.ts <команда> <файл> [параметры]

Команды:
  run <файл>              скомпилировать и выполнить (печатает вывод и результат main)
  interp <файл>           выполнить эталонным интерпретатором (для сверки)
  wat <файл>              показать сгенерированные инструкции
  build <файл> -o out.wasm  записать двоичный модуль

Параметры: --no-opt отключает оптимизатор.`;

function main(argv: string[]): number {
  const [cmd, file, ...rest] = argv;
  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return 0;
  }
  if (!file) {
    console.error(HELP);
    return 2;
  }
  const optimize = !rest.includes("--no-opt");
  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch (e) {
    console.error(`не удалось прочитать ${file}: ${(e as Error).message}`);
    return 2;
  }
  try {
    switch (cmd) {
      case "run":
      case "interp": {
        const r = cmd === "run" ? run(compile(src, { optimize }).bytes) : interpretSource(src);
        for (const v of r.output) console.log(v.toString());
        if (r.trap) {
          console.error(`ловушка: ${r.trap}`);
          return 1;
        }
        console.log(`main вернула ${r.result}`);
        return 0;
      }
      case "wat":
        console.log(compile(src, { optimize }).text);
        return 0;
      case "build": {
        const out = rest[rest.indexOf("-o") + 1];
        if (!rest.includes("-o") || !out) {
          console.error("укажите файл вывода: -o out.wasm");
          return 2;
        }
        const { bytes } = compile(src, { optimize });
        writeFileSync(out, bytes);
        console.log(`записано ${bytes.length} байт в ${out}`);
        return 0;
      }
      default:
        console.error(HELP);
        return 2;
    }
  } catch (e) {
    if (e instanceof CompileError) {
      console.error(`${file}:${e.message}`);
      return 1;
    }
    throw e;
  }
}

process.exitCode = main(process.argv.slice(2));
