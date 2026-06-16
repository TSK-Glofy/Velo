import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/taskFormat.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;

const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const mod = await import(moduleUrl);

assert.equal(mod.formatTaskDate("2026-06-15T05:30:22"), "2026/06/15 05:30:22");
assert.equal(mod.displayTaskId("task_20260615_153022_a7f3"), "");
assert.equal(mod.statusClass("completed"), "task-card task-card-completed");
assert.equal(mod.statusClass("failed"), "task-card task-card-failed");
assert.equal(mod.formatMetric(null), "-");

console.log("task-format tests passed");
