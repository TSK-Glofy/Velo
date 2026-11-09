import assert from "node:assert/strict";
import { extractEnglish } from "../scripts/release-notes.mjs";

// --- 仓库里 v0.12.0.md 的真实形状 ---
const bilingual = [
  "# Velo v0.12.0", "", "## 中文", "", "### 🐛 修复", "",
  "- **中文条目**：中文正文。", "", "---", "", "## English", "",
  "### 🐛 Fixes", "", "- **English item**: english body.", "",
].join("\n");

assert.equal(
  extractEnglish(bilingual),
  ["## 🐛 Fixes", "", "- **English item**: english body."].join("\n"),
);

// H1、中文半边、--- 分隔线都不得出现在结果里
const out = extractEnglish(bilingual);
assert.ok(!out.includes("# Velo"));
assert.ok(!out.includes("中文"));
assert.ok(!out.includes("---"));

// --- 多章节：### 全部提升为 ##，顺序不变 ---
const multi = [
  "# Velo v0.13.0", "", "## 中文", "", "### ✨ 新功能", "- 甲", "", "## English", "",
  "### ✨ New Features", "", "**Feature name**", "", "- does a thing (default 10)", "",
  "### 🐛 Fixes", "", "- **Symptom**: explanation.", "",
].join("\n");
const multiOut = extractEnglish(multi);
assert.match(multiOut, /^## ✨ New Features$/m);
assert.match(multiOut, /^## 🐛 Fixes$/m);
assert.ok(!/^### /m.test(multiOut));
assert.ok(multiOut.indexOf("New Features") < multiOut.indexOf("Fixes"));
assert.match(multiOut, /\*\*Feature name\*\*/);           // 加粗功能名保留

// --- English 半边后面还有别的同级章节：不许吞进来 ---
const trailing = [
  "## English", "", "### 🐛 Fixes", "- only this", "", "## 日本語", "", "### 修正", "- not this", "",
].join("\n");
const trailingOut = extractEnglish(trailing);
assert.match(trailingOut, /only this/);
assert.ok(!trailingOut.includes("not this"));
assert.ok(!trailingOut.includes("日本語"));

// --- CRLF 输入照样工作 ---
assert.match(extractEnglish(bilingual.replace(/\n/g, "\r\n")), /English item/);

// --- 缺 ## English：抛错 ---
assert.throws(() => extractEnglish("# Velo v0.13.0\n\n## 中文\n\n### 🐛 修复\n- 甲\n"), /English/);

// --- 有 ## English 但半边是空的：抛错，不能发空正文 ---
assert.throws(() => extractEnglish("## 中文\n- 甲\n\n## English\n\n"), /empty|空/i);

console.log("release-notes tests passed");
