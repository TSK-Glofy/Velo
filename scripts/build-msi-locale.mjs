// 分语言打 MSI。WiX 会把 src-tauri/installer/install.json 编译进包里，所以
// en-US 和 zh-CN 必须各打一次，每次先把对应的 install.<locale>.json 复制成
// install.json，打完再还原。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const LOCALES = ["en_US", "zh_CN"];

export function wixLanguageFor(locale) {
  return locale === "zh_CN" ? "zh-CN" : "en-US";
}

export function overrideConfigFor(locale) {
  return { bundle: { windows: { wix: { language: [wixLanguageFor(locale)] } } } };
}

function tauriCliEntry() {
  return createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js");
}

/**
 * 直接用当前这个 node 去跑 Tauri CLI 的 js 入口，不经任何 shell。
 *
 * 这里原本是 spawnSync("npx", [..., JSON.stringify(cfg)], { shell: true })，
 * 而它在 Windows 上是坏的：shell: true 时 Node 并不转义参数，只是用空格把它们
 * 拼成一条命令行交给 cmd.exe，cmd 再把 JSON 里的双引号吃掉 —— Tauri 收到的是
 * {bundle:{windows:...}}，当场报 "key must be a string"。
 *
 * 而 npx 在 Windows 上又只能经 shell 才找得到（npx.cmd 不是可执行文件），
 * 所以解法是绕开 npx：node 本来就认得 CLI 的 .js 入口，于是 shell 可以彻底
 * 不要，JSON 和含空格的路径都原样传进子进程。
 */
export function msiBuildCommand(locale, cliEntry = tauriCliEntry()) {
  return {
    command: process.execPath,
    args: [
      cliEntry,
      "build",
      "--bundles",
      "msi",
      "--config",
      JSON.stringify(overrideConfigFor(locale)),
    ],
    options: { stdio: "inherit" },
  };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const locale = process.argv[2];
  if (!LOCALES.includes(locale)) {
    console.error("用法: node scripts/build-msi-locale.mjs en_US|zh_CN");
    process.exit(1);
  }

  const installerDir = path.join(process.cwd(), "src-tauri", "installer");
  const dest = path.join(installerDir, "install.json");
  fs.copyFileSync(path.join(installerDir, `install.${locale}.json`), dest);

  const { command, args, options } = msiBuildCommand(locale);
  const result = spawnSync(command, args, options);

  // 还原成默认内容（en_US），让被跟踪的 install.json 保持干净。
  fs.copyFileSync(path.join(installerDir, "install.en_US.json"), dest);
  process.exit(result.status ?? 1);
}
