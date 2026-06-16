import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const locale = process.argv[2];
if (!["en_US", "zh_CN"].includes(locale)) {
  console.error("Usage: node scripts/build-msi-locale.mjs en_US|zh_CN");
  process.exit(1);
}

const root = process.cwd();
const installerDir = path.join(root, "src-tauri", "installer");
const source = path.join(installerDir, `install.${locale}.json`);
const dest = path.join(installerDir, "install.json");
const defaultSource = path.join(installerDir, "install.en_US.json");
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

// Restore default content (en_US) so the tracked file stays clean.
fs.copyFileSync(defaultSource, dest);
process.exit(result.status ?? 1);
