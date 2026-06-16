import assert from "node:assert/strict";
import fs from "node:fs";

const files = ["home.ts", "merge.ts", "frames.ts"];
for (const file of files) {
  const source = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert.match(source, /createTask/);
  assert.match(source, /openTaskListWindow/);
}

console.log("source page task API tests passed");
