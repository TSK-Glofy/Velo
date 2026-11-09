import assert from "node:assert/strict";
import { msiBuildCommand, overrideConfigFor, wixLanguageFor, LOCALES } from "../scripts/build-msi-locale.mjs";

assert.deepEqual(LOCALES, ["en_US", "zh_CN"]);
assert.equal(wixLanguageFor("en_US"), "en-US");
assert.equal(wixLanguageFor("zh_CN"), "zh-CN");

assert.deepEqual(overrideConfigFor("zh_CN"), {
  bundle: { windows: { wix: { language: ["zh-CN"] } } },
});
assert.deepEqual(overrideConfigFor("en_US"), {
  bundle: { windows: { wix: { language: ["en-US"] } } },
});

// --- 核心回归：绝不经由 shell 传 JSON ---
//
// 原来的写法是 spawnSync("npx", [..., JSON.stringify(cfg)], { shell: true })。
// Windows 上 shell: true 时 Node 只是把参数用空格拼成一条命令行交给 cmd.exe，
// 而 cmd 会吃掉 JSON 里的双引号 —— Tauri 收到的是 {bundle:{windows:...}}，
// 直接报 "key must be a string"。本地和 CI 都会挂，而且是立刻挂。
for (const locale of LOCALES) {
  const cmd = msiBuildCommand(locale);

  assert.ok(!cmd.options.shell, `${locale}: 不许开 shell`);
  assert.equal(cmd.command, process.execPath, `${locale}: 应当用当前 node 直接跑 CLI`);
  assert.match(cmd.args[0], /tauri\.js$/, `${locale}: 第一个参数应当是 tauri CLI 的 js 入口`);
  assert.ok(cmd.args.includes("--bundles"), `${locale}: 缺 --bundles`);
  assert.ok(cmd.args.includes("msi"), `${locale}: 缺 msi`);

  const i = cmd.args.indexOf("--config");
  assert.ok(i > 0, `${locale}: 缺 --config`);

  // 整段 JSON 必须是 argv 里独立的一个元素，而且引号完整、能解析回来
  const payload = cmd.args[i + 1];
  assert.match(payload, /^\{"bundle":/, `${locale}: JSON 的引号被吃掉了`);
  assert.deepEqual(JSON.parse(payload), overrideConfigFor(locale), `${locale}: JSON 解析不回原对象`);
}

console.log("build-msi-locale tests passed");
