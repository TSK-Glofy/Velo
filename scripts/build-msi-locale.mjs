import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const locale = process.argv[2];
if (!["en_US", "zh_CN"].includes(locale)) {
  console.error("Usage: node scripts/build-msi-locale.mjs en_US|zh_CN");
  process.exit(1);
}

const root = process.cwd();
const source = path.join(root, "src-tauri", "installer", `install.${locale}.json`);
const dest = path.join(root, "src-tauri", "installer", "install.json");
fs.copyFileSync(source, dest);

const wixLanguage = locale === "zh_CN" ? "zh-CN" : "en-US";
const overrideConfig = {
  bundle: { windows: { wix: { language: [wixLanguage] } } },
};
const result = spawnSync(
  "npx",
  [
    "tauri",
    "build",
    "--bundles",
    "msi",
    "--config",
    JSON.stringify(overrideConfig),
  ],
  { stdio: "inherit", shell: true },
);

fs.rmSync(dest, { force: true });
process.exit(result.status ?? 1);
