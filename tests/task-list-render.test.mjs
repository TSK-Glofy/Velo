import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

assert.match(css, /task-list-shell/);
assert.match(css, /task-detail-progress/);
assert.match(css, /task-preview-frame/);
assert.match(css, /task-card-completed/);
assert.match(css, /task-card-failed/);

console.log("task-list render tests passed");
