import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/rangeSelector.ts", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

// Regression: dragging a handle downwards used to start a native text selection,
// which fired pointercancel, dropped the pointer capture and latched `dragging`
// forever — every later hover then glued a handle to the cursor.

// 1. the selection gesture must never start
assert.match(src, /pointerdown[\s\S]{0,400}?ev\.preventDefault\(\)/);
assert.match(css, /\.rs-track\s*\{[^}]*user-select:\s*none/);

// 2. every way the gesture can end must clear the drag state
for (const evt of ["pointerup", "pointercancel", "lostpointercapture"]) {
  assert.ok(src.includes(`addEventListener("${evt}"`), `missing ${evt} handler`);
}

// 3. a move with no button held must not keep dragging
assert.match(src, /ev\.buttons === 0/);

// 4. releasing a capture we no longer hold would throw
assert.match(src, /hasPointerCapture\(ev\.pointerId\)/);

console.log("range selector drag tests passed");
