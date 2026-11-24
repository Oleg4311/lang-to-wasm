# Политика безопасности

## Как сообщить об уязвимости

Пожалуйста, **не создавайте публичный issue**. Сообщите приватно через GitHub: вкладка **Security** → **Report a vulnerability**
([создать сообщение](https://github.com/Oleg4311/lang-to-wasm/security/advisories/new)).

Укажите, что именно не так, как это воспроизвести и какая версия затронута. Я постараюсь ответить в течение недели, но это проект одного человека, поэтому сроки не гарантирую.

## Поддерживаемые версии

Исправления выходят для последней версии: ветка `main` и последний релиз.

## Что считается уязвимостью

Компилятор принимает недоверенный исходный текст, а страница выполняет результат в браузере, поэтому интересны: зависание или неограниченный расход памяти самого компилятора на специально составленном тексте (глубокая вложенность, огромные литералы), генерация некорректного или расходящегося с интерпретатором модуля, при которой скомпилированная программа ведёт себя не так, как написано (проверки границ, переполнения, порядок вычислений), внедрение разметки или скриптов через сообщения об ошибках и вывод программы на странице, небезопасные переходы по ссылкам на странице.

## Что вне области

Бесконечные циклы в самой компилируемой программе (язык допускает `while true`, а страница не ограничивает время выполнения), нехватка возможностей языка, описанная в README, известные проблемы в зависимостях разработки (их закрывает Dependabot), отчёты без способа воспроизведения.

---

## English

Please report vulnerabilities privately via GitHub Security Advisories (**Security** → **Report a vulnerability**) and do not open a public issue. Include what is wrong, how to reproduce it and which version is affected. This is a one-person project, so response times are best-effort. Only the latest release and `main` receive fixes. In scope: compiler hangs or unbounded memory on crafted source (deep nesting, huge literals), generating a module that behaves differently from the interpreter (bounds, overflow, evaluation order), markup or script injection through error messages or program output on the demo page, unsafe links. Out of scope: infinite loops in the compiled program itself (the language allows `while true` and the page has no time limit), documented missing language features, known dev-dependency issues.
