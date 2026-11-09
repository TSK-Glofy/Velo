import assert from "node:assert/strict";
import {
  setPackageJsonVersion, setPackageLockVersion, setCargoTomlVersion,
  setCargoLockVersion, setTauriConfVersion, setSettingsTsVersion,
} from "../scripts/set-version.mjs";

// --- package.json：唯一一个 "version" 键 ---
const pkg = '{\n  "name": "velo",\n  "version": "0.12.0",\n  "type": "module"\n}\n';
assert.equal(
  setPackageJsonVersion(pkg, "0.13.0"),
  '{\n  "name": "velo",\n  "version": "0.13.0",\n  "type": "module"\n}\n',
);

// --- package-lock.json：顶层 + packages[""] 两处都要改，依赖的 version 不许动 ---
const lock = [
  '{', '  "name": "velo",', '  "version": "0.12.0",', '  "lockfileVersion": 3,',
  '  "packages": {', '    "": {', '      "name": "velo",', '      "version": "0.12.0",',
  '      "dependencies": {', '        "daisyui": "^5.5.19"', '      }', '    },',
  '    "node_modules/daisyui": {', '      "version": "5.5.19"', '    }', '  }', '}', '',
].join("\n");
const lockOut = setPackageLockVersion(lock, "0.13.0");
assert.equal(lockOut.match(/"version": "0\.13\.0"/g).length, 2);   // 恰好两处
assert.match(lockOut, /"node_modules\/daisyui": \{\n      "version": "5\.5\.19"/); // 依赖没被碰
assert.ok(!lockOut.includes('"0.12.0"'));

// --- Cargo.toml：只改 [package] 段，依赖段的 version 不许动 ---
const cargoToml = [
  '[package]', 'name = "velo"', 'version = "0.12.0"', 'edition = "2021"', '',
  '[dependencies]', 'chrono = { version = "0.4", features = ["serde"] }', '',
].join("\n");
const tomlOut = setCargoTomlVersion(cargoToml, "0.13.0");
assert.match(tomlOut, /^version = "0\.13\.0"$/m);
assert.match(tomlOut, /chrono = \{ version = "0\.4"/);

// --- Cargo.lock：只改 name = "velo" 那个 [[package]] 块 ---
const cargoLock = [
  '[[package]]', 'name = "chrono"', 'version = "0.4.38"', '',
  '[[package]]', 'name = "velo"', 'version = "0.12.0"', 'dependencies = [', ' "chrono",', ']', '',
].join("\n");
const lockRsOut = setCargoLockVersion(cargoLock, "0.13.0");
assert.match(lockRsOut, /name = "velo"\nversion = "0\.13\.0"/);
assert.match(lockRsOut, /name = "chrono"\nversion = "0\.4\.38"/);

// --- tauri.conf.json ---
const tauriConf = '{\n  "productName": "velo",\n  "version": "0.12.0",\n  "identifier": "x"\n}\n';
assert.match(setTauriConfVersion(tauriConf, "0.13.0"), /"version": "0\.13\.0"/);

// --- settings.ts：同一 class 串出现两次，只能命中带版本号的那条 ---
const settings = [
  '                <h3 class="text-lg font-bold">Velo</h3>',
  '                <p class="text-sm opacity-70">v0.12.0</p>',
  '                <p class="text-sm opacity-70">TSK-Glofy</p>',
].join("\n");
const settingsOut = setSettingsTsVersion(settings, "0.13.0");
assert.match(settingsOut, /">v0\.13\.0</);
assert.match(settingsOut, /">TSK-Glofy</);           // 没被改成版本号

// --- CRLF 输入：锚点照样命中，且其余行的 \r\n 原样保留 ---
const crlf = pkg.replace(/\n/g, "\r\n");
const crlfOut = setPackageJsonVersion(crlf, "0.13.0");
assert.match(crlfOut, /"version": "0\.13\.0"/);
assert.equal(crlfOut.match(/\r\n/g).length, crlf.match(/\r\n/g).length);
assert.ok(!/[^\r]\n/.test(crlfOut));                 // 没有混进裸 \n

const crlfLock = cargoLock.replace(/\n/g, "\r\n");
assert.match(setCargoLockVersion(crlfLock, "0.13.0"), /name = "velo"\r\nversion = "0\.13\.0"/);

// --- 幂等：目标版本与当前相同时，原样返回，不抛错 ---
assert.equal(setPackageJsonVersion(pkg, "0.12.0"), pkg);
assert.equal(setCargoLockVersion(cargoLock, "0.12.0"), cargoLock);
assert.equal(setSettingsTsVersion(settings, "0.12.0"), settings);

// --- 锚点缺失必须抛错，不许静默返回原文 ---
assert.throws(() => setPackageJsonVersion('{\n  "name": "velo"\n}\n', "0.13.0"), /package\.json/);
assert.throws(() => setSettingsTsVersion('<p class="text-sm opacity-70">TSK-Glofy</p>', "0.13.0"), /settings\.ts/);
assert.throws(() => setCargoLockVersion('[[package]]\nname = "chrono"\nversion = "0.4.38"\n', "0.13.0"), /Cargo\.lock/);

// --- 锚点命中多次也必须抛错 ---
assert.throws(
  () => setSettingsTsVersion(settings + "\n" + '                <p class="text-sm opacity-70">v0.12.0</p>', "0.13.0"),
  /settings\.ts/,
);

// --- readVersions 对真实仓库文件：6 个文件、7 处版本号，全部一致 ---
// brief 未要求此用例；加它是因为 readVersions 是 Task 6 反向校验的唯一依靠，
// 而针对真实文件的断言能长期挡住锚点随重构而失配（尤其 settings.ts）。
import { fileURLToPath } from "node:url";
import { readVersions, verifyVersions, VERSION_FILES } from "../scripts/set-version.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const found = readVersions(repoRoot);
assert.deepEqual(
  Object.keys(found).sort(),
  ["package-lock.json", "package.json", "src-tauri/Cargo.lock", "src-tauri/Cargo.toml",
   "src-tauri/tauri.conf.json", "src/settings.ts"],
);
assert.equal(VERSION_FILES.length, 6);
const all = Object.values(found).flat();
assert.equal(all.length, 7);                       // package-lock.json 占两处
assert.ok(all.every((v) => v === all[0]), `版本号不一致: ${JSON.stringify(found)}`);
assert.match(all[0], /^\d+\.\d+\.\d+$/);

// --- verifyVersions：workflow 在 commit 前的反向校验所依赖的闸门 ---
const current = Object.values(readVersions(repoRoot)).flat()[0];
const good = verifyVersions(repoRoot, current);
assert.equal(good.ok, true);
assert.deepEqual(good.mismatches, []);

const bad = verifyVersions(repoRoot, "9.9.9");
assert.equal(bad.ok, false);
assert.equal(bad.mismatches.length, 6);                 // 6 个文件全部对不上
assert.ok(bad.mismatches.every((m) => m.includes("9.9.9")));
assert.ok(bad.mismatches.some((m) => m.startsWith("src/settings.ts")));

console.log("set-version tests passed");
