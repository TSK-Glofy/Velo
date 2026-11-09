// 从 docs/release-notes/v<ver>.md 抽出要发到 GitHub Release 的正文。
//
// 仓库里的 release notes 是中英双语的，而 Release 页面只放英文半边 —— 此前每次
// 发版都是手工挑出英文、把 ### 提成 ##、扔掉 H1，这个脚本就是把那一步自动化。
//
// 输出是 stdout（交给 gh release --notes-file），不是仓库里的文件，所以这里把
// CRLF 归一成 LF 是安全的：Global Constraints 那条「绝不规范化行尾」约束的是
// 被改写回仓库的文件，不是发布正文。

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 取 `## English` 之后、下一个同级 `## ` 之前的内容，把 `### ` 提升为 `## `。
 * 找不到该章节、或抽出来是空的，都抛错 —— 宁可挡住，也不要发空正文的 Release。
 */
export function extractEnglish(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+English\s*$/.test(line));
  if (start === -1) {
    throw new Error('release notes 里找不到 "## English" 章节 —— Release 正文无从生成');
  }

  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    // `^##\s` 不会命中 `###`（第三个字符是 # 而非空白），所以只在同级章节处停下。
    if (/^##\s/.test(lines[i])) break;
    body.push(lines[i]);
  }

  const text = body.map((line) => line.replace(/^###\s/, "## ")).join("\n").trim();
  if (!text) {
    throw new Error('release notes 的 "## English" 章节是空的 (empty) —— 不能发布正文空白的 Release');
  }
  return text;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const version = process.argv[2];
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    console.error("用法: node scripts/release-notes.mjs <semver>    例如 0.13.0（不带 v 前缀）");
    process.exit(1);
  }
  const file = path.join(process.cwd(), "docs", "release-notes", `v${version}.md`);
  if (!fs.existsSync(file)) {
    console.error(`找不到 ${file} —— 发版前请先写好这一版的 release notes`);
    process.exit(1);
  }
  try {
    process.stdout.write(extractEnglish(fs.readFileSync(file, "utf8")) + "\n");
  } catch (err) {
    console.error(`${file}: ${err.message}`);
    process.exit(1);
  }
}
