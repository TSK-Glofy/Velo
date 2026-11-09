// 同步仓库里全部 6 处版本号。
//
// 设计上的两条硬约束：
// 1. 绝不规范化行尾。仓库 core.autocrlf=true，CI 检出可能是 CRLF；每个变换只替换
//    锚点捕获到的那一小段，匹配到的空白和行尾字符原样回写，所以「改一个版本号」
//    永远只产生一行 diff。
// 2. 三个 JSON 文件一律不做 JSON.parse/stringify 往返 —— 那会重排格式，
//    package-lock.json 会变成整文件 diff。
//
// 每个锚点正好 3 个捕获组：(前缀)(版本号)(后缀)。替换时重新拼回第 1、3 组。
// 锚点命中次数必须正好是 1，零次或多次都抛错 —— 这是「不允许版本号不一致的
// 状态被提交」的第一道防线。

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const A = {
  pkgVersion: {
    re: /("version":\s*")([^"]*)(")/g,
    desc: '顶层 "version" 键',
  },
  lockRoot: {
    re: /^(  "version":\s*")([^"]*)(")/gm,
    desc: '顶层（两空格缩进）"version"',
  },
  lockRootPkg: {
    re: /("":\s*\{\s*"name":\s*"velo",\s*"version":\s*")([^"]*)(")/g,
    desc: 'packages[""] 的 "version"',
  },
  cargoTomlPkg: {
    re: /(\[package\](?:(?!^\[)[\s\S])*?version\s*=\s*")([^"]*)(")/gm,
    desc: '[package] 段内的 version（依赖项的 version 不在范围内）',
  },
  cargoLockVelo: {
    re: /(\[\[package\]\]\s*name\s*=\s*"velo"\s*version\s*=\s*")([^"]*)(")/g,
    desc: '[[package]] 中 name = "velo" 那一块的 version',
  },
  tauriConf: {
    re: /^(  "version":\s*")([^"]*)(")/gm,
    desc: '顶层（两空格缩进）"version"',
  },
  settingsAbout: {
    re: /(<p class="text-sm opacity-70">v)(\d+\.\d+\.\d+)(<\/p>)/g,
    desc: '关于卡片里的 v<版本号>（同 class 的 TSK-Glofy 那行不在范围内）',
  },
};

function replaceOnce(text, anchor, fileLabel, version) {
  const found = text.match(anchor.re);
  const n = found ? found.length : 0;
  if (n !== 1) {
    throw new Error(
      `${fileLabel}: 锚点「${anchor.desc}」命中 ${n} 次，预期正好 1 次 —— 版本号同步中止`,
    );
  }
  return text.replace(anchor.re, (_m, p1, _p2, p3) => p1 + version + p3);
}

export function setPackageJsonVersion(text, version) {
  return replaceOnce(text, A.pkgVersion, "package.json", version);
}

export function setPackageLockVersion(text, version) {
  const once = replaceOnce(text, A.lockRoot, "package-lock.json", version);
  return replaceOnce(once, A.lockRootPkg, "package-lock.json", version);
}

export function setCargoTomlVersion(text, version) {
  return replaceOnce(text, A.cargoTomlPkg, "src-tauri/Cargo.toml", version);
}

export function setCargoLockVersion(text, version) {
  return replaceOnce(text, A.cargoLockVelo, "src-tauri/Cargo.lock", version);
}

export function setTauriConfVersion(text, version) {
  return replaceOnce(text, A.tauriConf, "src-tauri/tauri.conf.json", version);
}

export function setSettingsTsVersion(text, version) {
  return replaceOnce(text, A.settingsAbout, "src/settings.ts", version);
}

export const VERSION_FILES = [
  { path: "package.json", transform: setPackageJsonVersion, anchors: [A.pkgVersion] },
  { path: "package-lock.json", transform: setPackageLockVersion, anchors: [A.lockRoot, A.lockRootPkg] },
  { path: "src-tauri/Cargo.toml", transform: setCargoTomlVersion, anchors: [A.cargoTomlPkg] },
  { path: "src-tauri/Cargo.lock", transform: setCargoLockVersion, anchors: [A.cargoLockVelo] },
  { path: "src-tauri/tauri.conf.json", transform: setTauriConfVersion, anchors: [A.tauriConf] },
  { path: "src/settings.ts", transform: setSettingsTsVersion, anchors: [A.settingsAbout] },
];

/** 读出每个文件里当前的版本号（同一文件可能多处，故为数组），用于反向校验。 */
export function readVersions(rootDir) {
  const out = {};
  for (const entry of VERSION_FILES) {
    const text = fs.readFileSync(path.join(rootDir, entry.path), "utf8");
    out[entry.path] = entry.anchors.flatMap((a) => [...text.matchAll(a.re)].map((m) => m[2]));
  }
  return out;
}

/**
 * 反向校验：读回 6 个文件里的版本号，逐一与期望值比对。
 *
 * 这是「不允许版本号不一致的状态被提交」的最后一道闸门。各 transform 自己的
 * 「锚点必须命中一次」是第一道；但如果将来有人重构了 settings.ts 的结构、
 * 顺手把锚点契约也改坏了，只有这里还能在 commit 之前拦住。
 */
export function verifyVersions(rootDir, expected) {
  const versions = readVersions(rootDir);
  const mismatches = [];
  for (const [file, found] of Object.entries(versions)) {
    if (found.length === 0 || found.some((v) => v !== expected)) {
      mismatches.push(`${file}: 读到 ${JSON.stringify(found)}，期望 ${expected}`);
    }
  }
  return { ok: mismatches.length === 0, versions, mismatches };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const verifyOnly = args[0] === "--verify";
  const version = verifyOnly ? args[1] : args[0];
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    console.error("用法: node scripts/set-version.mjs [--verify] <semver>    例如 0.13.0（不带 v 前缀）");
    process.exit(1);
  }
  const root = process.cwd();

  if (verifyOnly) {
    const { ok, versions, mismatches } = verifyVersions(root, version);
    if (!ok) {
      console.error(`版本号与 ${version} 不一致，发布中止：`);
      for (const line of mismatches) console.error(`  - ${line}`);
      process.exit(1);
    }
    console.log(`6 处版本号均为 ${version}：`);
    for (const [file, found] of Object.entries(versions)) {
      console.log(`  ${file}: ${found.join(", ")}`);
    }
    process.exit(0);
  }

  for (const entry of VERSION_FILES) {
    const file = path.join(root, entry.path);
    const before = fs.readFileSync(file, "utf8");
    const was = [...new Set(entry.anchors.flatMap((a) => [...before.matchAll(a.re)].map((m) => m[2])))];
    const after = entry.transform(before, version);
    if (after !== before) fs.writeFileSync(file, after, "utf8");
    console.log(`${entry.path}: ${was.join(", ")} -> ${version}`);
  }
}
