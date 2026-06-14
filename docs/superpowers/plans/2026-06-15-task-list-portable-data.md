# Task List and Portable Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Velo's install-folder data layout, installer-seeded first-run language, Task list window, traceable JSONL job history, retry flow, concurrency limit, and live frame preview.

**Architecture:** Rust owns app data paths, config persistence, job journal replay, scheduling, FFmpeg execution, retry, cancellation, and preview extraction. TypeScript submits task requests and renders a separate Task list window that subscribes to structured task events. The old direct FFmpeg commands stay available until the source pages are rewired, so each phase remains buildable.

**Tech Stack:** Tauri v2, Rust 2021, serde/serde_json, chrono, TypeScript, Vite, Tailwind/DaisyUI, Node test scripts.

---

## Scope And Execution Order

This spec touches three connected subsystems: portable app-owned data, long-running task tracking, and installer language defaults. Execute the tasks in order. Each task ends with tests and a commit so a regression has a small search area.

Before executing code changes, create an isolated branch or worktree using `superpowers:using-git-worktrees`. The current working tree may contain user-owned changes; do not revert unrelated files.

## File Structure

- Create `src-tauri/src/paths.rs`: install-root and app-owned path helpers.
- Modify `src-tauri/src/config.rs`: install-relative config, first-run language seed, background import, concurrency setting.
- Create `src-tauri/src/task_types.rs`: shared task request, summary, detail, state, metrics, event types.
- Create `src-tauri/src/jobs.rs`: journal append/replay, in-memory registry, scheduling commands.
- Modify `src-tauri/src/ffmpeg.rs`: expose command builders and a task-aware FFmpeg runner while keeping old commands until rewiring is complete.
- Create `src-tauri/src/preview.rs`: low-resolution preview command construction and one-at-a-time preview extraction.
- Modify `src-tauri/src/lib.rs`: register new modules, managed state, commands, and startup recovery.
- Modify `src-tauri/Cargo.toml`: add `chrono`.
- Create `src/taskApi.ts`: typed Tauri command wrappers for tasks.
- Create `src/taskFormat.ts`: UI-safe date formatting, status labels, status classes, metric formatting.
- Create `src/taskList.ts`: Task list window renderer.
- Modify `src/main.ts`: route the secondary Task list window and keep the main app flow.
- Modify `src/home.ts`, `src/merge.ts`, `src/frames.ts`: submit background tasks instead of blocking on direct FFmpeg commands.
- Modify `src/settings.ts`: use background Import and max concurrent tasks setting.
- Modify `src/i18n.ts`: add Task list, import, retry, recovery, and concurrency strings.
- Modify `src/styles.css`: Task list layout, status cards, right-pane progress, metric boxes, black preview area.
- Modify `src-tauri/capabilities/default.json`: allow the `task-list` window and opener operations needed by Task list.
- Modify `src-tauri/tauri.conf.json`: configure user-writable NSIS install mode and installer language hooks.
- Create `src-tauri/installer/nsis-hooks.nsh`: write `config/install.json` based on selected setup language.
- Create `src-tauri/installer/wix-install-json.wxs`: install `config/install.json` for MSI packages.
- Create `scripts/build-msi-locale.mjs`: build per-locale MSI packages with the matching installer seed file.
- Add tests under `tests/`: Node tests for frontend formatting/rendering helpers.

## Task 1: Portable Path Helpers

**Files:**
- Create: `src-tauri/src/paths.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write path helper tests**

Add these tests at the bottom of `src-tauri/src/paths.rs` while creating the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn derives_app_root_from_exe_path() {
        let root = app_root_from_exe(Path::new(r"C:\Users\me\Velo\velo.exe")).unwrap();
        assert_eq!(root, Path::new(r"C:\Users\me\Velo"));
    }

    #[test]
    fn builds_install_relative_paths() {
        let root = Path::new(r"D:\Apps\Velo");
        assert_eq!(config_file_from_root(root), root.join("config").join("config.json"));
        assert_eq!(install_defaults_file_from_root(root), root.join("config").join("install.json"));
        assert_eq!(jobs_file_from_root(root), root.join("jobs").join("jobs.jsonl"));
        assert_eq!(job_log_file_from_root(root, "task_1"), root.join("jobs").join("logs").join("task_1.log"));
        assert_eq!(preview_file_from_root(root, "task_1"), root.join("preview").join("task_1.jpg"));
    }

    #[test]
    fn rejects_absolute_app_owned_relative_path() {
        let err = app_owned_path_from_root(Path::new(r"D:\Apps\Velo"), r"C:\temp\a.png").unwrap_err();
        assert!(err.contains("relative"));
    }
}
```

- [ ] **Step 2: Run tests to verify the new module is not wired yet**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml paths
```

Expected: fail because `paths.rs` has not been declared in `lib.rs`, or because helper functions are not implemented yet.

- [ ] **Step 3: Implement path helpers**

Create `src-tauri/src/paths.rs` with these public functions:

```rust
use std::path::{Path, PathBuf};

pub fn app_root() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Unable to locate executable: {e}"))?;
    app_root_from_exe(&exe)
}

pub fn app_root_from_exe(exe: &Path) -> Result<PathBuf, String> {
    exe.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Executable path has no parent directory".to_string())
}

pub fn config_file() -> Result<PathBuf, String> {
    Ok(config_file_from_root(&app_root()?))
}

pub fn install_defaults_file() -> Result<PathBuf, String> {
    Ok(install_defaults_file_from_root(&app_root()?))
}

pub fn jobs_file() -> Result<PathBuf, String> {
    Ok(jobs_file_from_root(&app_root()?))
}

pub fn job_log_file(task_id: &str) -> Result<PathBuf, String> {
    Ok(job_log_file_from_root(&app_root()?, task_id))
}

pub fn preview_file(task_id: &str) -> Result<PathBuf, String> {
    Ok(preview_file_from_root(&app_root()?, task_id))
}

pub fn app_owned_path(relative: &str) -> Result<PathBuf, String> {
    app_owned_path_from_root(&app_root()?, relative)
}

pub fn config_file_from_root(root: &Path) -> PathBuf {
    root.join("config").join("config.json")
}

pub fn install_defaults_file_from_root(root: &Path) -> PathBuf {
    root.join("config").join("install.json")
}

pub fn jobs_file_from_root(root: &Path) -> PathBuf {
    root.join("jobs").join("jobs.jsonl")
}

pub fn job_log_file_from_root(root: &Path, task_id: &str) -> PathBuf {
    root.join("jobs").join("logs").join(format!("{task_id}.log"))
}

pub fn preview_file_from_root(root: &Path, task_id: &str) -> PathBuf {
    root.join("preview").join(format!("{task_id}.jpg"))
}

pub fn background_dir_from_root(root: &Path) -> PathBuf {
    root.join("pic").join("background")
}

pub fn app_owned_path_from_root(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative);
    if rel.is_absolute() {
        return Err("App-owned paths must be relative to the install directory".to_string());
    }
    Ok(root.join(rel))
}
```

Add `mod paths;` to `src-tauri/src/lib.rs`.

- [ ] **Step 4: Run tests to verify path helpers pass**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml paths
```

Expected: all `paths` tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/paths.rs src-tauri/src/lib.rs
git commit -m "feat: add install-relative path helpers"
```

## Task 2: Config Uses Install Folder And Installer Language Seed

**Files:**
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

- [ ] **Step 1: Write config tests**

Add test-only helper functions to `config.rs` and these tests at the bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("velo_{name}_{stamp}"))
    }

    #[test]
    fn seeds_language_from_zh_cn_installer_locale() {
        let root = temp_root("zh_seed");
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config").join("install.json"), r#"{"locale":"zh_CN"}"#).unwrap();

        let config = load_config_from_root(&root);

        assert_eq!(config.language.as_deref(), Some("zh"));
        assert!(root.join("config").join("config.json").exists());
    }

    #[test]
    fn seeds_language_from_en_us_installer_locale() {
        let root = temp_root("en_seed");
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config").join("install.json"), r#"{"locale":"en_US"}"#).unwrap();

        let config = load_config_from_root(&root);

        assert_eq!(config.language.as_deref(), Some("en"));
    }

    #[test]
    fn unsupported_installer_locale_falls_back_to_english() {
        let root = temp_root("fallback_seed");
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config").join("install.json"), r#"{"locale":"fr_FR"}"#).unwrap();

        let config = load_config_from_root(&root);

        assert_eq!(config.language.as_deref(), Some("en"));
    }

    #[test]
    fn existing_config_language_wins_over_installer_seed() {
        let root = temp_root("existing_wins");
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config").join("install.json"), r#"{"locale":"zh_CN"}"#).unwrap();
        fs::write(root.join("config").join("config.json"), r#"{"language":"en"}"#).unwrap();

        let config = load_config_from_root(&root);

        assert_eq!(config.language.as_deref(), Some("en"));
    }
}
```

- [ ] **Step 2: Run tests to verify current config fails**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml config
```

Expected: fail because `load_config_from_root` does not exist and config still uses `dirs::config_dir()`.

- [ ] **Step 3: Implement install-folder config**

Update `AppConfig`:

```rust
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct AppConfig {
    pub ffmpeg_path: Option<String>,
    pub background_image: Option<String>,
    pub default_resolution: Option<String>,
    pub window_size: Option<String>,
    pub default_output_dir: Option<String>,
    pub default_copy_mode: Option<bool>,
    pub default_same_dir: Option<bool>,
    pub language: Option<String>,
    pub max_concurrent_jobs: Option<u32>,
}

#[derive(Serialize, Deserialize, Default)]
struct InstallDefaults {
    locale: Option<String>,
}
```

Replace `config_path()` with install-root helpers:

```rust
fn config_path() -> Result<std::path::PathBuf, String> {
    crate::paths::config_file()
}

pub fn load_config() -> AppConfig {
    match crate::paths::app_root() {
        Ok(root) => load_config_from_root(&root),
        Err(_) => AppConfig::default(),
    }
}

pub fn load_config_from_root(root: &std::path::Path) -> AppConfig {
    let path = crate::paths::config_file_from_root(root);
    if let Ok(content) = fs::read_to_string(&path) {
        return serde_json::from_str(&content).unwrap_or_default();
    }

    let mut config = AppConfig::default();
    config.language = Some(read_installer_language_from_root(root));
    let _ = save_config_to_root(root, &config);
    config
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let root = crate::paths::app_root()?;
    save_config_to_root(&root, config)
}

fn save_config_to_root(root: &std::path::Path, config: &AppConfig) -> Result<(), String> {
    let path = crate::paths::config_file_from_root(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn read_installer_language_from_root(root: &std::path::Path) -> String {
    let path = crate::paths::install_defaults_file_from_root(root);
    let locale = fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<InstallDefaults>(&content).ok())
        .and_then(|defaults| defaults.locale);
    map_installer_locale(locale.as_deref())
}

fn map_installer_locale(locale: Option<&str>) -> String {
    match locale.unwrap_or("").replace('-', "_").as_str() {
        "zh_CN" | "SimpChinese" | "Chinese" => "zh".to_string(),
        "en_US" | "en" | "English" => "en".to_string(),
        _ => "en".to_string(),
    }
}
```

Remove `dirs` from `src-tauri/Cargo.toml` after no code references it.

- [ ] **Step 4: Run config tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml config
```

Expected: all config tests pass.

- [ ] **Step 5: Verify full Rust tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all Rust tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/src/config.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: seed config from install folder"
```

## Task 3: Background Import And Concurrency Settings

**Files:**
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/settings.ts`
- Modify: `src/i18n.ts`

- [ ] **Step 1: Write Rust tests for background import and concurrency bounds**

Add these tests to `config.rs`:

```rust
#[test]
fn copies_background_into_install_folder_and_stores_relative_path() {
    let root = temp_root("bg_import");
    let source_dir = temp_root("bg_source");
    fs::create_dir_all(&source_dir).unwrap();
    let source = source_dir.join("custom.png");
    fs::write(&source, b"png bytes").unwrap();

    let imported = import_background_image_for_root(&root, source.to_string_lossy().to_string()).unwrap();

    assert!(imported.ends_with(r"pic\background\custom.png") || imported.ends_with("pic/background/custom.png"));
    let config = load_config_from_root(&root);
    assert_eq!(config.background_image.as_deref(), Some("pic/background/custom.png"));
    assert_eq!(fs::read(crate::paths::background_dir_from_root(&root).join("custom.png")).unwrap(), b"png bytes");
}

#[test]
fn max_concurrent_jobs_is_clamped_to_supported_range() {
    let root = temp_root("max_jobs");
    set_max_concurrent_jobs_for_root(&root, 0).unwrap();
    assert_eq!(load_config_from_root(&root).max_concurrent_jobs, Some(1));
    set_max_concurrent_jobs_for_root(&root, 99).unwrap();
    assert_eq!(load_config_from_root(&root).max_concurrent_jobs, Some(4));
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml config
```

Expected: fail because import and concurrency helper functions do not exist.

- [ ] **Step 3: Implement Rust commands**

Add helpers and commands to `config.rs`:

```rust
fn normalize_app_relative_path(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn unique_background_filename(dir: &std::path::Path, filename: &str) -> std::path::PathBuf {
    let mut candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let source = std::path::Path::new(filename);
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("background");
    let ext = source.extension().and_then(|s| s.to_str()).unwrap_or("");
    for idx in 1.. {
        let name = if ext.is_empty() {
            format!("{stem}({idx})")
        } else {
            format!("{stem}({idx}).{ext}")
        };
        candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

pub fn import_background_image_for_root(root: &std::path::Path, path: String) -> Result<String, String> {
    let source = std::path::PathBuf::from(&path);
    if !source.exists() {
        return Err("File does not exist".to_string());
    }
    let filename = source.file_name().and_then(|s| s.to_str()).ok_or("Invalid file name")?;
    let bg_dir = crate::paths::background_dir_from_root(root);
    fs::create_dir_all(&bg_dir).map_err(|e| e.to_string())?;
    let dest = unique_background_filename(&bg_dir, filename);
    fs::copy(&source, &dest).map_err(|e| e.to_string())?;

    let rel = dest.strip_prefix(root).map_err(|e| e.to_string())?;
    let rel = normalize_app_relative_path(rel);
    let mut config = load_config_from_root(root);
    config.background_image = Some(rel);
    save_config_to_root(root, &config)?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn import_background_image(path: String) -> Result<String, String> {
    let root = crate::paths::app_root()?;
    import_background_image_for_root(&root, path)
}

#[tauri::command]
pub fn clear_background_image() -> Result<String, String> {
    let mut config = load_config();
    config.background_image = None;
    save_config(&config)?;
    Ok("OK".to_string())
}

pub fn set_max_concurrent_jobs_for_root(root: &std::path::Path, value: u32) -> Result<(), String> {
    let mut config = load_config_from_root(root);
    config.max_concurrent_jobs = Some(value.clamp(1, 4));
    save_config_to_root(root, &config)
}

#[tauri::command]
pub fn get_max_concurrent_jobs() -> u32 {
    load_config().max_concurrent_jobs.unwrap_or(1).clamp(1, 4)
}

#[tauri::command]
pub fn set_max_concurrent_jobs(value: u32) -> Result<String, String> {
    let root = crate::paths::app_root()?;
    set_max_concurrent_jobs_for_root(&root, value)?;
    Ok("OK".to_string())
}
```

Update `get_background_image()` so stored relative paths resolve from install root:

```rust
#[tauri::command]
pub fn get_background_image() -> Option<String> {
    let stored = load_config().background_image?;
    let path = std::path::Path::new(&stored);
    if path.is_absolute() {
        Some(stored)
    } else {
        crate::paths::app_owned_path(&stored)
            .ok()
            .map(|p| p.to_string_lossy().to_string())
    }
}
```

Register `import_background_image`, `clear_background_image`, `get_max_concurrent_jobs`, and `set_max_concurrent_jobs` in `lib.rs`.

- [ ] **Step 4: Update settings UI**

In `src/settings.ts`, replace the background browse command:

```ts
await invoke("import_background_image", { path: selected as string });
```

Replace background clear with:

```ts
await invoke("clear_background_image");
await applyBackground();
```

Load and render max concurrent jobs:

```ts
const currentMaxJobs = await invoke<number>("get_max_concurrent_jobs");
```

Add a select near default options:

```html
<label class="label">${t("settings.maxConcurrentJobs")}</label>
<select id="max-jobs-select" class="select w-full">
  <option value="1" ${currentMaxJobs === 1 ? "selected" : ""}>1</option>
  <option value="2" ${currentMaxJobs === 2 ? "selected" : ""}>2</option>
  <option value="3" ${currentMaxJobs === 3 ? "selected" : ""}>3</option>
  <option value="4" ${currentMaxJobs === 4 ? "selected" : ""}>4</option>
</select>
```

Add the listener:

```ts
const maxJobsSelect = container.querySelector("#max-jobs-select") as HTMLSelectElement;
maxJobsSelect.addEventListener("change", async () => {
  try {
    await invoke("set_max_concurrent_jobs", { value: Number(maxJobsSelect.value) });
    defaultsMsg.textContent = t("settings.saved");
    defaultsMsg.className = "text-sm mt-1 text-success";
  } catch (e) {
    defaultsMsg.textContent = `${t("settings.saveFailed")}${e}`;
    defaultsMsg.className = "text-sm mt-1 text-error";
  }
});
```

In `src/i18n.ts`, change English `settings.bgSelect` to `Import` and add:

```ts
"settings.maxConcurrentJobs": "Max concurrent tasks",
```

Add the matching Chinese key using the project's existing language table:

```ts
"settings.maxConcurrentJobs": "最大同时任务数",
```

- [ ] **Step 5: Run verification**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml config
npm run build
```

Expected: Rust tests pass and TypeScript/Vite build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/src/config.rs src-tauri/src/lib.rs src/settings.ts src/i18n.ts
git commit -m "feat: import app-owned background settings"
```

## Task 4: Task Types And JSONL Journal

**Files:**
- Create: `src-tauri/src/task_types.rs`
- Create: `src-tauri/src/jobs.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

- [ ] **Step 1: Add chrono dependency**

In `src-tauri/Cargo.toml`, add:

```toml
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 2: Write journal replay tests**

Create `src-tauri/src/jobs.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_types::{TaskEvent, TaskKind, TaskRequest, TaskState};
    use chrono::Utc;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("velo_jobs_{name}_{stamp}"))
    }

    #[test]
    fn replay_marks_completed_task_completed() {
        let root = temp_root("completed");
        let task_id = "task_20260615_153022_a7f3".to_string();
        append_event_to_root(&root, &TaskEvent::TaskCreated {
            task_id: task_id.clone(),
            kind: TaskKind::Trim,
            request: TaskRequest::Trim {
                input: "in.mp4".into(),
                output: "out.mp4".into(),
                start: "0".into(),
                duration: "10".into(),
                resolution: None,
                framerate: None,
                codec_mode: Some("reencode".into()),
                rotation: None,
            },
            created_at: Utc::now(),
        }).unwrap();
        append_event_to_root(&root, &TaskEvent::TaskStarted {
            task_id: task_id.clone(),
            started_at: Utc::now(),
        }).unwrap();
        append_event_to_root(&root, &TaskEvent::TaskCompleted {
            task_id: task_id.clone(),
            completed_at: Utc::now(),
        }).unwrap();

        let tasks = replay_tasks_from_root(&root).unwrap();

        assert_eq!(tasks[0].id, task_id);
        assert_eq!(tasks[0].state, TaskState::Completed);
    }

    #[test]
    fn replay_marks_stale_running_task_interrupted() {
        let root = temp_root("interrupted");
        let task_id = "task_20260615_153100_b1".to_string();
        append_event_to_root(&root, &TaskEvent::TaskCreated {
            task_id: task_id.clone(),
            kind: TaskKind::Frames,
            request: TaskRequest::Frames {
                input: "in.mp4".into(),
                output_dir: "frames".into(),
                start: None,
                duration: Some("5".into()),
                fps: None,
                format: "png".into(),
            },
            created_at: Utc::now(),
        }).unwrap();
        append_event_to_root(&root, &TaskEvent::TaskStarted {
            task_id: task_id.clone(),
            started_at: Utc::now(),
        }).unwrap();

        let tasks = replay_tasks_from_root(&root).unwrap();

        assert_eq!(tasks[0].state, TaskState::Interrupted);
    }

    #[test]
    fn log_tail_reads_only_requested_lines() {
        let root = temp_root("tail");
        let log_path = crate::paths::job_log_file_from_root(&root, "task_tail");
        fs::create_dir_all(log_path.parent().unwrap()).unwrap();
        fs::write(&log_path, "a\nb\nc\nd\n").unwrap();

        let tail = read_log_tail_from_root(&root, "task_tail", 2).unwrap();

        assert_eq!(tail, vec!["c".to_string(), "d".to_string()]);
    }
}
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml jobs
```

Expected: fail because task types and journal functions do not exist.

- [ ] **Step 4: Define task types**

Create `src-tauri/src/task_types.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskKind {
    Trim,
    Merge,
    Frames,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskState {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TaskRequest {
    Trim {
        input: String,
        output: String,
        start: String,
        duration: String,
        resolution: Option<String>,
        framerate: Option<String>,
        codec_mode: Option<String>,
        rotation: Option<String>,
    },
    Merge {
        inputs: Vec<String>,
        output: String,
    },
    Frames {
        input: String,
        output_dir: String,
        start: Option<String>,
        duration: Option<String>,
        fps: Option<String>,
        format: String,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskMetrics {
    pub percent: f64,
    pub frame: Option<String>,
    pub out_time: Option<String>,
    pub speed: Option<String>,
    pub output_size: Option<String>,
    pub preview_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub id: String,
    pub kind: TaskKind,
    pub state: TaskState,
    pub title: String,
    pub output: Option<String>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub metrics: TaskMetrics,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    pub summary: TaskSummary,
    pub request: TaskRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TaskEvent {
    TaskCreated {
        task_id: String,
        kind: TaskKind,
        request: TaskRequest,
        created_at: DateTime<Utc>,
    },
    TaskStarted {
        task_id: String,
        started_at: DateTime<Utc>,
    },
    TaskProgress {
        task_id: String,
        metrics: TaskMetrics,
        updated_at: DateTime<Utc>,
    },
    TaskPreviewUpdated {
        task_id: String,
        preview_path: String,
        updated_at: DateTime<Utc>,
    },
    TaskCompleted {
        task_id: String,
        completed_at: DateTime<Utc>,
    },
    TaskFailed {
        task_id: String,
        error: String,
        failed_at: DateTime<Utc>,
    },
    TaskCancelled {
        task_id: String,
        cancelled_at: DateTime<Utc>,
    },
    TaskInterrupted {
        task_id: String,
        interrupted_at: DateTime<Utc>,
    },
}
```

- [ ] **Step 5: Implement journal append/replay**

In `jobs.rs`, implement:

```rust
use crate::task_types::{TaskDetail, TaskEvent, TaskKind, TaskMetrics, TaskRequest, TaskState, TaskSummary};
use chrono::Utc;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

pub fn append_event(event: &TaskEvent) -> Result<(), String> {
    append_event_to_root(&crate::paths::app_root()?, event)
}

pub fn append_event_to_root(root: &Path, event: &TaskEvent) -> Result<(), String> {
    let path = crate::paths::jobs_file_from_root(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    let line = serde_json::to_string(event).map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())
}

pub fn replay_tasks() -> Result<Vec<TaskDetail>, String> {
    replay_tasks_from_root(&crate::paths::app_root()?)
}

pub fn replay_tasks_from_root(root: &Path) -> Result<Vec<TaskDetail>, String> {
    let path = crate::paths::jobs_file_from_root(root);
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(Vec::new());
    };

    let mut tasks: HashMap<String, TaskDetail> = HashMap::new();
    for line in content.lines().filter(|line| !line.trim().is_empty()) {
        let event: TaskEvent = serde_json::from_str(line).map_err(|e| format!("Invalid job journal line: {e}"))?;
        apply_event(&mut tasks, event);
    }

    let mut list: Vec<TaskDetail> = tasks.into_values().collect();
    for detail in &mut list {
        if detail.summary.state == TaskState::Running {
            detail.summary.state = TaskState::Interrupted;
            detail.summary.finished_at = Some(Utc::now());
        }
    }
    list.sort_by(|a, b| b.summary.created_at.cmp(&a.summary.created_at));
    Ok(list)
}
```

Add `apply_event`, `title_for_request`, `output_for_request`, and `read_log_tail_from_root`. Use the task's latest event as the current state.

Register `mod task_types; mod jobs;` in `lib.rs`.

- [ ] **Step 6: Run tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml jobs
```

Expected: all journal tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/src/task_types.rs src-tauri/src/jobs.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add task journal model"
```

## Task 5: Task Registry, Scheduling, Retry, And Cancellation Commands

**Files:**
- Modify: `src-tauri/src/jobs.rs`
- Modify: `src-tauri/src/task_types.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write scheduler and retry tests**

Add tests to `jobs.rs`:

```rust
#[test]
fn scheduler_starts_only_up_to_configured_limit() {
    let mut registry = TaskRegistry::new_for_tests(1);
    let first = registry.insert_pending_for_tests(sample_trim_request("one.mp4", "one-out.mp4"));
    let second = registry.insert_pending_for_tests(sample_trim_request("two.mp4", "two-out.mp4"));

    let ready = registry.pop_startable_task_ids();

    assert_eq!(ready, vec![first]);
    assert_eq!(registry.task(&second).unwrap().summary.state, TaskState::Pending);
}

#[test]
fn retry_keeps_same_task_id_and_request() {
    let mut registry = TaskRegistry::new_for_tests(1);
    let task_id = registry.insert_failed_for_tests(sample_trim_request("one.mp4", "one-out.mp4"), "failed");

    registry.retry_for_tests(&task_id, RetryOutputPolicy::UseOriginal).unwrap();

    let detail = registry.task(&task_id).unwrap();
    assert_eq!(detail.summary.id, task_id);
    assert_eq!(detail.summary.state, TaskState::Pending);
}

#[test]
fn output_fallback_generates_numbered_filename() {
    let root = temp_root("retry_name");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("old_file.mp4"), b"existing").unwrap();
    fs::write(root.join("old_file(1).mp4"), b"existing").unwrap();

    let next = next_available_output_path(root.join("old_file.mp4")).unwrap();

    assert!(next.ends_with("old_file(2).mp4"));
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml jobs
```

Expected: fail because registry and retry helpers do not exist.

- [ ] **Step 3: Implement registry state and command signatures**

Add to `task_types.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RetryOutputPolicy {
    UseOriginal,
    UseNumberedFallback,
}
```

Add to `jobs.rs`:

```rust
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

pub type SharedTaskRegistry = Arc<Mutex<TaskRegistry>>;

pub struct TaskRegistry {
    tasks: HashMap<String, TaskDetail>,
    queue: VecDeque<String>,
    running: HashMap<String, RunningTask>,
    max_concurrent_jobs: u32,
}

pub struct RunningTask {
    pub cancel_requested: bool,
}

impl TaskRegistry {
    pub fn from_journal(max_concurrent_jobs: u32) -> Result<Self, String> {
        let mut registry = Self {
            tasks: HashMap::new(),
            queue: VecDeque::new(),
            running: HashMap::new(),
            max_concurrent_jobs: max_concurrent_jobs.clamp(1, 4),
        };
        for detail in replay_tasks()? {
            registry.tasks.insert(detail.summary.id.clone(), detail);
        }
        Ok(registry)
    }

    pub fn create_task(&mut self, request: TaskRequest) -> Result<TaskSummary, String> {
        let task_id = generate_task_id();
        let kind = kind_for_request(&request);
        let created_at = Utc::now();
        let summary = TaskSummary {
            id: task_id.clone(),
            kind: kind.clone(),
            state: TaskState::Pending,
            title: title_for_request(&request),
            output: output_for_request(&request),
            created_at,
            started_at: None,
            finished_at: None,
            metrics: TaskMetrics::default(),
            error: None,
        };
        append_event(&TaskEvent::TaskCreated {
            task_id: task_id.clone(),
            kind,
            request: request.clone(),
            created_at,
        })?;
        self.tasks.insert(task_id.clone(), TaskDetail { summary: summary.clone(), request });
        self.queue.push_back(task_id);
        Ok(summary)
    }
}
```

Expose Tauri commands:

```rust
#[tauri::command]
pub fn create_task(state: tauri::State<SharedTaskRegistry>, request: TaskRequest) -> Result<TaskSummary, String> {
    let mut registry = state.lock().map_err(|_| "Task registry lock failed".to_string())?;
    registry.create_task(request)
}

#[tauri::command]
pub fn list_tasks(state: tauri::State<SharedTaskRegistry>) -> Result<Vec<TaskSummary>, String> {
    let registry = state.lock().map_err(|_| "Task registry lock failed".to_string())?;
    Ok(registry.list_summaries())
}

#[tauri::command]
pub fn get_task(state: tauri::State<SharedTaskRegistry>, task_id: String) -> Result<TaskDetail, String> {
    let registry = state.lock().map_err(|_| "Task registry lock failed".to_string())?;
    registry.task(&task_id).cloned().ok_or("Task not found".to_string())
}

#[tauri::command]
pub fn get_task_log_tail(task_id: String, lines: usize) -> Result<Vec<String>, String> {
    read_log_tail(&task_id, lines.min(500))
}
```

Add `retry_task`, `cancel_task`, and `open_task_list_window` command stubs that update state but do not yet execute FFmpeg. They will be connected to the runner in Task 6.

In `lib.rs`, manage registry state:

```rust
let registry = jobs::TaskRegistry::from_journal(config::get_max_concurrent_jobs())
    .unwrap_or_else(|_| jobs::TaskRegistry::empty(config::get_max_concurrent_jobs()));

tauri::Builder::default()
    .manage(std::sync::Arc::new(std::sync::Mutex::new(registry)))
```

- [ ] **Step 4: Run tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml jobs
```

Expected: scheduler, retry, naming, and journal tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/jobs.rs src-tauri/src/task_types.rs src-tauri/src/lib.rs
git commit -m "feat: add task registry commands"
```

## Task 6: Task-aware FFmpeg Runner And Structured Progress

**Files:**
- Modify: `src-tauri/src/ffmpeg.rs`
- Modify: `src-tauri/src/jobs.rs`
- Modify: `src-tauri/src/task_types.rs`

- [ ] **Step 1: Write progress parser tests**

Move progress parsing into a testable function and add tests to `ffmpeg.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_progress_metrics_with_percent() {
        let mut parser = ProgressParser::new(10_000_000);
        parser.accept_line("frame=42");
        parser.accept_line("out_time=00:00:05.000000");
        parser.accept_line("speed=1.5x");
        parser.accept_line("total_size=1048576");
        parser.accept_line("out_time_us=5000000");

        let metrics = parser.metrics();

        assert_eq!(metrics.frame.as_deref(), Some("42"));
        assert_eq!(metrics.out_time.as_deref(), Some("00:00:05"));
        assert_eq!(metrics.speed.as_deref(), Some("1.5x"));
        assert_eq!(metrics.output_size.as_deref(), Some("1.0 MB"));
        assert_eq!(metrics.percent.round(), 50.0);
    }
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml ffmpeg
```

Expected: fail because `ProgressParser` does not exist.

- [ ] **Step 3: Add command builders**

Expose builders that do not spawn processes:

```rust
pub struct BuiltFfmpegTask {
    pub args: Vec<String>,
    pub total_us: i64,
    pub primary_input: Option<String>,
    pub output: Option<String>,
    pub success_message: String,
}

pub fn build_task_command(ffmpeg_path: &str, request: &crate::task_types::TaskRequest) -> Result<BuiltFfmpegTask, String> {
    match request {
        crate::task_types::TaskRequest::Trim { input, output, start, duration, resolution, framerate, codec_mode, rotation } => {
            build_trim_command(ffmpeg_path, input, output, start, duration, resolution, framerate, codec_mode, rotation)
        }
        crate::task_types::TaskRequest::Merge { inputs, output } => {
            build_merge_command(inputs, output)
        }
        crate::task_types::TaskRequest::Frames { input, output_dir, start, duration, fps, format } => {
            build_frames_command(input, output_dir, start, duration, fps, format)
        }
    }
}
```

Keep the existing `trim_video`, `merge_videos`, and `extract_frames` commands for now. Internally, they may call the builders.

- [ ] **Step 4: Implement task runner entry point**

Add a function that runs one task and reports events:

```rust
pub fn run_ffmpeg_task(
    app: tauri::AppHandle,
    registry: crate::jobs::SharedTaskRegistry,
    task_id: String,
) -> Result<(), String> {
    let ffmpeg_path = crate::config::load_config()
        .ffmpeg_path
        .ok_or("FFmpeg path is not configured")?;

    let request = {
        let registry = registry.lock().map_err(|_| "Task registry lock failed".to_string())?;
        registry.task(&task_id).ok_or("Task not found".to_string())?.request.clone()
    };

    let built = build_task_command(&ffmpeg_path, &request)?;
    run_ffmpeg_task_command(app, registry, task_id, ffmpeg_path, built)
}
```

In `run_ffmpeg_task_command`, append all stdout/stderr lines to `jobs/logs/<task_id>.log`, emit structured `TaskEvent::TaskProgress`, and emit Tauri `task-progress` with `TaskSummary`.

- [ ] **Step 5: Connect scheduler to runner**

In `jobs.rs`, after `create_task` and `retry_task`, call a scheduler function:

```rust
pub fn schedule_ready_tasks(app: tauri::AppHandle, registry: SharedTaskRegistry) {
    let task_ids = {
        let mut locked = match registry.lock() {
            Ok(v) => v,
            Err(_) => return,
        };
        locked.pop_startable_task_ids()
    };

    for task_id in task_ids {
        let app_clone = app.clone();
        let registry_clone = registry.clone();
        std::thread::spawn(move || {
            let _ = crate::ffmpeg::run_ffmpeg_task(app_clone.clone(), registry_clone.clone(), task_id);
            schedule_ready_tasks(app_clone, registry_clone);
        });
    }
}
```

Update `create_task` and `retry_task` Tauri commands to receive `app: tauri::AppHandle` and call `schedule_ready_tasks(app, state.inner().clone())`.

- [ ] **Step 6: Run Rust tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all Rust tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/src/ffmpeg.rs src-tauri/src/jobs.rs src-tauri/src/task_types.rs
git commit -m "feat: run ffmpeg tasks with structured progress"
```

## Task 7: Live Preview Extraction

**Files:**
- Create: `src-tauri/src/preview.rs`
- Modify: `src-tauri/src/ffmpeg.rs`
- Modify: `src-tauri/src/jobs.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write preview command tests**

Create `src-tauri/src/preview.rs` with tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_low_resolution_preview_args() {
        let args = build_preview_args("00:00:04", "input.mp4", "preview.jpg");

        assert_eq!(args, vec![
            "-ss", "00:00:04",
            "-i", "input.mp4",
            "-frames:v", "1",
            "-vf", "scale=320:-1",
            "-y", "preview.jpg",
        ]);
    }
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml preview
```

Expected: fail because preview module is not declared or implemented.

- [ ] **Step 3: Implement preview module**

Implement:

```rust
use std::collections::HashSet;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct PreviewState {
    running: Arc<Mutex<HashSet<String>>>,
}

pub fn build_preview_args(out_time: &str, input: &str, output: &str) -> Vec<String> {
    vec![
        "-ss".into(), out_time.into(),
        "-i".into(), input.into(),
        "-frames:v".into(), "1".into(),
        "-vf".into(), "scale=320:-1".into(),
        "-y".into(), output.into(),
    ]
}

pub fn request_preview(
    app: tauri::AppHandle,
    preview_state: PreviewState,
    ffmpeg_path: String,
    task_id: String,
    input: String,
    out_time: String,
) {
    {
        let mut running = match preview_state.running.lock() {
            Ok(v) => v,
            Err(_) => return,
        };
        if running.contains(&task_id) {
            return;
        }
        running.insert(task_id.clone());
    }

    std::thread::spawn(move || {
        let preview_path = match crate::paths::preview_file(&task_id) {
            Ok(path) => path,
            Err(_) => return,
        };
        if let Some(parent) = preview_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let output = preview_path.to_string_lossy().to_string();
        let args = build_preview_args(&out_time, &input, &output);
        let _ = Command::new(ffmpeg_path)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output();
        let _ = app.emit("task-preview-updated", serde_json::json!({
            "taskId": task_id,
            "previewPath": output,
        }));
        if let Ok(mut running) = preview_state.running.lock() {
            running.remove(&task_id);
        }
    });
}
```

- [ ] **Step 4: Wire preview into progress handling**

When `ProgressParser` has an `out_time` value and the task has a primary input, call `preview::request_preview(...)` no more than once per emitted progress cycle. The one-at-a-time guard in `PreviewState` skips a tick when extraction is still running.

Manage `PreviewState` in `lib.rs`:

```rust
.manage(preview::PreviewState::default())
```

Pass it into task execution.

- [ ] **Step 5: Run tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml preview
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: preview tests and full Rust tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/src/preview.rs src-tauri/src/ffmpeg.rs src-tauri/src/jobs.rs src-tauri/src/lib.rs
git commit -m "feat: add live task preview extraction"
```

## Task 8: Task List Frontend API And Formatting

**Files:**
- Create: `src/taskApi.ts`
- Create: `src/taskFormat.ts`
- Create: `tests/task-format.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write Node tests for frontend formatting**

Create `tests/task-format.test.mjs`:

```js
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
```

Add script to `package.json`:

```json
"test:node": "node tests/task-format.test.mjs"
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm run test:node
```

Expected: fail because `src/taskFormat.ts` does not exist.

- [ ] **Step 3: Implement task formatting helpers**

Create `src/taskFormat.ts`:

```ts
export type TaskState = "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export function formatTaskDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function displayTaskId(_taskId: string): string {
  return "";
}

export function statusClass(state: TaskState): string {
  return `task-card task-card-${state}`;
}

export function formatMetric(value?: string | number | null): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}
```

Create `src/taskApi.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export type TaskKind = "trim" | "merge" | "frames";
export type TaskState = "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface TaskMetrics {
  percent: number;
  frame?: string | null;
  outTime?: string | null;
  speed?: string | null;
  outputSize?: string | null;
  previewPath?: string | null;
}

export interface TaskSummary {
  id: string;
  kind: TaskKind;
  state: TaskState;
  title: string;
  output?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  metrics: TaskMetrics;
  error?: string | null;
}

export interface TaskDetail {
  summary: TaskSummary;
  request: unknown;
}

export function createTask(request: unknown): Promise<TaskSummary> {
  return invoke<TaskSummary>("create_task", { request });
}

export function listTasks(): Promise<TaskSummary[]> {
  return invoke<TaskSummary[]>("list_tasks");
}

export function getTask(taskId: string): Promise<TaskDetail> {
  return invoke<TaskDetail>("get_task", { taskId });
}

export function retryTask(taskId: string, outputPolicy: "useOriginal" | "useNumberedFallback"): Promise<TaskSummary> {
  return invoke<TaskSummary>("retry_task", { taskId, outputPolicy });
}

export function cancelTask(taskId: string): Promise<void> {
  return invoke<void>("cancel_task", { taskId });
}

export function openTaskListWindow(): Promise<void> {
  return invoke<void>("open_task_list_window");
}
```

- [ ] **Step 4: Run frontend tests and build**

Run:

```powershell
npm run test:node
npm run build
```

Expected: Node tests pass and frontend build succeeds.

- [ ] **Step 5: Commit**

```powershell
git add src/taskApi.ts src/taskFormat.ts tests/task-format.test.mjs package.json package-lock.json
git commit -m "feat: add task frontend API helpers"
```

## Task 9: Task List Window UI

**Files:**
- Create: `src/taskList.ts`
- Modify: `src/main.ts`
- Modify: `src/i18n.ts`
- Modify: `src/styles.css`
- Modify: `src-tauri/src/jobs.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Write lightweight render test**

Create `tests/task-list-render.test.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

assert.match(css, /task-list-shell/);
assert.match(css, /task-detail-progress/);
assert.match(css, /task-preview-frame/);
assert.match(css, /task-card-completed/);
assert.match(css, /task-card-failed/);

console.log("task-list render tests passed");
```

Update `package.json`:

```json
"test:node": "node tests/task-format.test.mjs && node tests/task-list-render.test.mjs"
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm run test:node
```

Expected: fail because Task list CSS classes are not present.

- [ ] **Step 3: Implement Task list renderer**

Create `src/taskList.ts` with this shape:

```ts
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { cancelTask, getTask, listTasks, retryTask, type TaskSummary } from "./taskApi";
import { formatMetric, formatTaskDate, statusClass } from "./taskFormat";
import { t } from "./i18n";

let selectedTaskId: string | null = null;
let tasks: TaskSummary[] = [];

export async function renderTaskList(container: HTMLElement) {
  container.innerHTML = `
    <section class="task-list-shell">
      <aside class="task-list-sidebar">
        <header class="task-list-title">${t("tasks.title")}</header>
        <div id="task-cards" class="task-card-list"></div>
      </aside>
      <main id="task-detail" class="task-detail-pane"></main>
    </section>
  `;

  tasks = await listTasks();
  selectedTaskId = tasks[0]?.id ?? null;
  renderTaskCards(container);
  await renderSelectedTask(container);

  await listen<TaskSummary>("task-progress", async (event) => {
    upsertTask(event.payload);
    renderTaskCards(container);
    if (event.payload.id === selectedTaskId) await renderSelectedTask(container);
  });
  await listen<TaskSummary>("task-completed", async (event) => {
    upsertTask(event.payload);
    renderTaskCards(container);
    if (event.payload.id === selectedTaskId) await renderSelectedTask(container);
  });
}
```

The detail pane must render:

```html
<progress class="progress progress-primary task-detail-progress" value="..." max="100"></progress>
<div class="task-metrics-grid">
  <div class="task-metric"><span>Current frame</span><strong>...</strong></div>
  <div class="task-metric"><span>Video time</span><strong>...</strong></div>
  <div class="task-metric"><span>Speed</span><strong>...</strong></div>
  <div class="task-metric"><span>Output size</span><strong>...</strong></div>
</div>
<div class="task-preview-frame">...</div>
```

Do not render `task.id` anywhere in visible HTML.

- [ ] **Step 4: Route secondary window**

In `main.ts`, before main app setup, detect the Task list window:

```ts
const params = new URLSearchParams(window.location.search);
if (params.get("window") === "task-list") {
  window.addEventListener("DOMContentLoaded", async () => {
    const sidebar = document.querySelector("#sidebar") as HTMLElement;
    const content = document.querySelector("#content") as HTMLElement;
    sidebar.style.display = "none";
    const savedLang = await invoke<string>("get_language");
    setLang(savedLang as Lang);
    await renderTaskList(content);
  });
} else {
  window.addEventListener("DOMContentLoaded", async () => {
    // existing main app startup body
  });
}
```

Import `renderTaskList` at the top.

- [ ] **Step 5: Implement `open_task_list_window`**

In `jobs.rs`:

```rust
#[tauri::command]
pub fn open_task_list_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("task-list") {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "task-list",
        tauri::WebviewUrl::App("index.html?window=task-list".into()),
    )
    .title("Task list")
    .inner_size(1100.0, 720.0)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}
```

Add imports:

```rust
use tauri::{Emitter, Manager};
```

In `default.json`, add the new window label:

```json
"windows": ["main", "task-list"]
```

- [ ] **Step 6: Add CSS**

Add CSS with stable dimensions:

```css
.task-list-shell {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  height: 100vh;
  background: #101014;
  color: #f4f4f5;
}

.task-list-sidebar {
  border-right: 1px solid rgba(255, 255, 255, 0.12);
  padding: 16px;
  overflow: auto;
}

.task-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.task-card {
  width: 100%;
  min-height: 82px;
  border-radius: 8px;
  padding: 10px;
  border-left: 5px solid #64748b;
  background: rgba(255, 255, 255, 0.08);
  text-align: left;
}

.task-card-pending { border-left-color: #eab308; }
.task-card-running { border-left-color: #3b82f6; }
.task-card-completed { border-left-color: #22c55e; }
.task-card-failed { border-left-color: #ef4444; }
.task-card-cancelled { border-left-color: #94a3b8; }
.task-card-interrupted { border-left-color: #f97316; }

.task-detail-pane {
  display: grid;
  grid-template-rows: auto auto minmax(240px, 1fr) auto;
  gap: 16px;
  padding: 18px;
  min-width: 0;
}

.task-detail-progress {
  width: 100%;
  height: 18px;
}

.task-metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.task-metric {
  min-height: 74px;
  border-radius: 8px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.task-preview-frame {
  min-height: 280px;
  border-radius: 8px;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.task-preview-frame img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
```

- [ ] **Step 7: Run verification**

Run:

```powershell
npm run test:node
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: Node tests, frontend build, and Rust tests pass.

- [ ] **Step 8: Commit**

```powershell
git add src/taskList.ts src/main.ts src/i18n.ts src/styles.css src-tauri/src/jobs.rs src-tauri/src/lib.rs src-tauri/capabilities/default.json tests/task-list-render.test.mjs package.json package-lock.json
git commit -m "feat: add task list window"
```

## Task 10: Rewire Trim, Merge, And Frames Pages To Submit Tasks

**Files:**
- Modify: `src/home.ts`
- Modify: `src/merge.ts`
- Modify: `src/frames.ts`
- Modify: `src/i18n.ts`

- [ ] **Step 1: Add a source-page smoke test**

Create `tests/source-pages-task-api.test.mjs`:

```js
import assert from "node:assert/strict";
import fs from "node:fs";

const files = ["home.ts", "merge.ts", "frames.ts"];
for (const file of files) {
  const source = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert.match(source, /createTask/);
  assert.match(source, /openTaskListWindow/);
}

console.log("source page task API tests passed");
```

Update `package.json`:

```json
"test:node": "node tests/task-format.test.mjs && node tests/task-list-render.test.mjs && node tests/source-pages-task-api.test.mjs"
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
npm run test:node
```

Expected: fail because source pages still call direct FFmpeg commands.

- [ ] **Step 3: Rewire Trim**

In `home.ts`, replace the `trim_video` invoke block with:

```ts
const resolution = await invoke<string | null>("get_default_resolution");
const summary = await createTask({
  kind: "trim",
  input: inputPath.value,
  output: finalOutput,
  start: startTime.value,
  duration: duration.value,
  resolution: resolution || null,
  framerate: framerate.value || null,
  codecMode: copyMode.checked ? "copy" : "reencode",
  rotation: rotation.value || null,
});
await openTaskListWindow();
status.textContent = t("tasks.created");
status.className = "text-sm mt-2 text-success";
```

Remove per-page `listen("ffmpeg-status")` and `listen("ffmpeg-progress")` blocks after the Task list owns long-running status.

- [ ] **Step 4: Rewire Merge**

In `merge.ts`, replace `merge_videos` with:

```ts
await createTask({
  kind: "merge",
  inputs: cache.files,
  output: outputPath.value,
});
await openTaskListWindow();
status.textContent = t("tasks.created");
status.className = "text-sm mt-2 text-success";
```

- [ ] **Step 5: Rewire Frames**

In `frames.ts`, replace `extract_frames` with:

```ts
await createTask({
  kind: "frames",
  input: inputPath.value,
  outputDir: outputPath.value,
  start: startTime || null,
  duration: duration || null,
  fps: fps || null,
  format,
});
await openTaskListWindow();
status.textContent = t("tasks.created");
status.className = "text-sm mt-2 text-success";
```

- [ ] **Step 6: Keep output overwrite behavior**

Trim already asks before overwrite. Add the same initial overwrite check to Merge if the selected output exists:

```ts
const exists = await invoke<boolean>("check_file_exists", { path: outputPath.value });
if (exists) {
  const overwrite = await ask(t("tasks.outputExistsMessage"), {
    title: t("tasks.outputExistsTitle"),
    kind: "warning",
  });
  if (!overwrite) return;
}
```

Frames output is a directory workflow; keep its existing validation and leave per-frame conflicts to FFmpeg behavior for this first version.

- [ ] **Step 7: Run verification**

Run:

```powershell
npm run test:node
npm run build
```

Expected: Node tests pass and frontend build succeeds.

- [ ] **Step 8: Commit**

```powershell
git add src/home.ts src/merge.ts src/frames.ts src/i18n.ts tests/source-pages-task-api.test.mjs package.json package-lock.json
git commit -m "feat: submit video work as background tasks"
```

## Task 11: Retry Dialog, Recovery Dialog, And User-visible States

**Files:**
- Modify: `src/taskList.ts`
- Modify: `src/taskApi.ts`
- Modify: `src/main.ts`
- Modify: `src/i18n.ts`
- Modify: `src-tauri/src/jobs.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write recovery command tests**

Add Rust tests to `jobs.rs`:

```rust
#[test]
fn interrupted_tasks_are_reported_for_startup_recovery() {
    let mut registry = TaskRegistry::new_for_tests(1);
    let id = registry.insert_interrupted_for_tests(sample_trim_request("in.mp4", "out.mp4"));

    let interrupted = registry.interrupted_summaries();

    assert_eq!(interrupted.len(), 1);
    assert_eq!(interrupted[0].id, id);
}
```

- [ ] **Step 2: Implement recovery commands**

Add commands:

```rust
#[tauri::command]
pub fn list_interrupted_tasks(state: tauri::State<SharedTaskRegistry>) -> Result<Vec<TaskSummary>, String> {
    let registry = state.lock().map_err(|_| "Task registry lock failed".to_string())?;
    Ok(registry.interrupted_summaries())
}

#[tauri::command]
pub fn retry_interrupted_tasks(app: tauri::AppHandle, state: tauri::State<SharedTaskRegistry>) -> Result<Vec<TaskSummary>, String> {
    let registry_state = state.inner().clone();
    let task_ids = {
        let registry = registry_state.lock().map_err(|_| "Task registry lock failed".to_string())?;
        registry.interrupted_summaries().into_iter().map(|task| task.id).collect::<Vec<_>>()
    };
    let mut summaries = Vec::new();
    for task_id in task_ids {
        summaries.push(retry_task_inner(app.clone(), registry_state.clone(), task_id, RetryOutputPolicy::UseOriginal)?);
    }
    Ok(summaries)
}
```

Add `retry_task_inner` and call it from both `retry_task` and `retry_interrupted_tasks` so retry logic has one code path.

- [ ] **Step 3: Add startup dialog**

In `main.ts`, after main app startup and before normal navigation finishes, call:

```ts
const interrupted = await invoke<TaskSummary[]>("list_interrupted_tasks");
if (interrupted.length > 0) {
  const retry = await ask(t("tasks.recoveryMessage"), {
    title: t("tasks.recoveryTitle"),
    kind: "warning",
  });
  if (retry) {
    await invoke("retry_interrupted_tasks");
    await openTaskListWindow();
  }
}
```

This dialog only asks whether to retry; it does not display log lines.

- [ ] **Step 4: Add retry output policy in Task list**

In `taskList.ts`, when `Retry` is clicked:

```ts
const detail = await getTask(task.id);
const output = detail.summary.output;
let outputPolicy: "useOriginal" | "useNumberedFallback" = "useOriginal";
if (output) {
  const overwrite = await ask(t("tasks.retryOverwriteMessage"), {
    title: t("tasks.retryOverwriteTitle"),
    kind: "warning",
  });
  outputPolicy = overwrite ? "useOriginal" : "useNumberedFallback";
}
await retryTask(task.id, outputPolicy);
```

The detail pane keeps the same visible card selected after retry.

- [ ] **Step 5: Run verification**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml jobs
npm run build
```

Expected: recovery tests pass and frontend build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add src/taskList.ts src/taskApi.ts src/main.ts src/i18n.ts src-tauri/src/jobs.rs src-tauri/src/lib.rs
git commit -m "feat: recover and retry interrupted tasks"
```

## Task 12: Installer User-writable Default And Installer Language Seed

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/installer/nsis-hooks.nsh`
- Create: `src-tauri/installer/wix-install-json.wxs`
- Create: `src-tauri/installer/install.en_US.json`
- Create: `src-tauri/installer/install.zh_CN.json`
- Create: `scripts/build-msi-locale.mjs`

- [ ] **Step 1: Configure NSIS current-user install mode and hook**

Update `tauri.conf.json`:

```json
"nsis": {
  "installMode": "currentUser",
  "languages": ["English", "SimpChinese"],
  "displayLanguageSelector": true,
  "installerHooks": "installer/nsis-hooks.nsh"
}
```

- [ ] **Step 2: Add NSIS language hook**

Create `src-tauri/installer/nsis-hooks.nsh`:

```nsh
!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\config"
  ${If} $LANGUAGE == ${LANG_SIMPCHINESE}
    FileOpen $0 "$INSTDIR\config\install.json" w
    FileWrite $0 '{"locale":"zh_CN"}'
    FileClose $0
  ${Else}
    FileOpen $0 "$INSTDIR\config\install.json" w
    FileWrite $0 '{"locale":"en_US"}'
    FileClose $0
  ${EndIf}
!macroend
```

- [ ] **Step 3: Add MSI seed files**

Create:

`src-tauri/installer/install.en_US.json`:

```json
{"locale":"en_US"}
```

`src-tauri/installer/install.zh_CN.json`:

```json
{"locale":"zh_CN"}
```

- [ ] **Step 4: Add WiX fragment**

Create `src-tauri/installer/wix-install-json.wxs`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Fragment>
    <DirectoryRef Id="INSTALLDIR">
      <Directory Id="VeloConfigDir" Name="config">
        <Component Id="VeloInstallDefaults" Guid="*">
          <File Id="VeloInstallDefaultsFile" Source="installer\install.json" KeyPath="yes" Name="install.json" />
        </Component>
      </Directory>
    </DirectoryRef>
  </Fragment>
  <Fragment>
    <ComponentGroup Id="VeloInstallDefaultsGroup">
      <ComponentRef Id="VeloInstallDefaults" />
    </ComponentGroup>
  </Fragment>
</Wix>
```

Update `tauri.conf.json` WiX config:

```json
"wix": {
  "language": ["en-US", "zh-CN"],
  "fragmentPaths": ["installer/wix-install-json.wxs"],
  "componentGroupRefs": ["VeloInstallDefaultsGroup"]
}
```

During execution, build once and inspect the generated `.wxs` under `src-tauri/target` if WiX reports that `INSTALLDIR` is not found. If the generated template uses a different install directory id, update only `DirectoryRef Id` in `wix-install-json.wxs` to the generated id and rerun the MSI build.

- [ ] **Step 5: Add per-locale MSI build script**

Create `scripts/build-msi-locale.mjs`:

```js
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
const result = spawnSync("npx", ["tauri", "build", "--bundles", "msi", "--config", JSON.stringify({
  bundle: { windows: { wix: { language: [wixLanguage] } } },
})], { stdio: "inherit", shell: true });

fs.rmSync(dest, { force: true });
process.exit(result.status ?? 1);
```

Add package scripts:

```json
"build:msi:en": "node scripts/build-msi-locale.mjs en_US",
"build:msi:zh": "node scripts/build-msi-locale.mjs zh_CN"
```

- [ ] **Step 6: Verify packaging configuration**

Run:

```powershell
npm run build
npm run build:msi:en
npm run build:msi:zh
```

Expected: frontend build succeeds and both MSI build commands create installers. If WiX fails on the directory id, apply the `DirectoryRef` adjustment from Step 4 and rerun both MSI scripts.

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/tauri.conf.json src-tauri/installer/nsis-hooks.nsh src-tauri/installer/wix-install-json.wxs src-tauri/installer/install.en_US.json src-tauri/installer/install.zh_CN.json scripts/build-msi-locale.mjs package.json package-lock.json
git commit -m "feat: seed first-run language from installers"
```

## Task 13: Final Integration Verification

**Files:**
- Modify only files needed for fixes discovered by verification.

- [ ] **Step 1: Run full automated verification**

Run:

```powershell
npm run test:node
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all commands pass.

- [ ] **Step 2: Run Tauri development app**

Run:

```powershell
npm run tauri dev
```

Manual checks:

- First launch without `config/config.json` and with `config/install.json` containing `{"locale":"zh_CN"}` renders Chinese.
- First launch without `config/config.json` and with `config/install.json` containing `{"locale":"en_US"}` renders English.
- Changing language in Settings persists after restart.
- Import background copies into `pic/background/` and `config/config.json` stores a relative path.
- Starting Trim opens or focuses Task list.
- Task list hides internal task id.
- Left task card is blue while running, green when completed, red when failed, orange/red when interrupted.
- Right pane shows top progress bar, four equal metric boxes, and black preview area.
- Preview refreshes during long tasks and does not spawn overlapping preview work.
- Retry on an existing output asks overwrite; yes reuses original output, no creates `old_file(1).mp4`.
- Closing Velo during a running task and reopening shows the interrupted-task recovery dialog.

- [ ] **Step 3: Commit final fixes**

If verification required fixes:

```powershell
git add <only-fixed-files>
git commit -m "fix: polish task list integration"
```

If no fixes were required, do not create an empty commit.
