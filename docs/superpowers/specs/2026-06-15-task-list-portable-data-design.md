# Velo Task List and Portable Data Design

Date: 2026/06/15

## Goals

Velo needs two related improvements:

1. Long-running FFmpeg work must be traceable through a Task list window. Users should see progress, task state, retry options, and a live frame preview. If Velo closes unexpectedly, interrupted work should be visible and retryable.
2. Velo should stop storing app-owned configuration in the system config directory. App-owned settings, imported pictures, task journals, logs, and preview cache should live under the Velo installation directory so deleting the install folder removes Velo-owned data.
3. The app's first-run language should follow the language the user chose in the installer.

User-generated output videos and images are not app-owned data. They should stay wherever the user chooses and should not be deleted with Velo.

## Non-Goals

- Do not introduce SQLite in the first version.
- Do not display internal Job IDs in normal UI.
- Do not support migration from the old AppData/config-dir model; there are no current users to preserve.
- Do not make retry create a new visible task history item.
- Do not guarantee that the live preview frame is the exact encoded frame from the active FFmpeg pipeline.
- Do not let installer language overwrite a language preference already saved by the user.

## Portable Data Layout

Velo will use the installation directory as its app data root. The default installer should install to a user-writable directory instead of `Program Files`.

Recommended directory structure:

```text
Velo/
  velo.exe
  config/
    install.json
    config.json
  pic/
    background/
      background.png
  jobs/
    jobs.jsonl
    logs/
      task_xxx.log
  preview/
    task_xxx.jpg
```

Path rules:

- `config/config.json` stores app settings.
- `config/install.json` stores installer-selected first-run defaults.
- `jobs/jobs.jsonl` stores structured task lifecycle events.
- `jobs/logs/` stores one detailed FFmpeg log file per task.
- `preview/` stores temporary low-resolution preview images.
- `pic/background/` stores imported background images.
- Config should store relative paths for app-owned files when possible.
- Runtime code resolves relative app-owned paths from the installation directory.

The current `dirs::config_dir()/velo/config.json` model should be replaced with helpers based on `std::env::current_exe().parent()`.

## Installer-selected Language Default

The installer language is a first-run default, not a permanent override.

Behavior:

1. During installation, the installer writes `config/install.json` under the Velo installation directory.
2. `config/install.json` includes the installer-selected locale, for example:

```json
{"locale":"zh_CN"}
```

3. On first launch, if `config/config.json` does not exist, Velo initializes it using the installer locale.
4. After `config/config.json` exists, Velo reads the language from `config/config.json`.
5. If the user changes language in Velo, the updated user preference in `config/config.json` wins over the installer seed.

Locale mapping:

- Setup installer: use the language selected in the setup UI.
- MSI installer: `en_US` initializes English.
- MSI installer: `zh_CN` initializes Chinese.
- Unknown or unsupported locale values fall back to English.

This keeps setup and MSI behavior consistent while preventing future updates or repairs from resetting user preferences.

## Background Image Import

The settings UI should change the background image action from "Select Image" to "Import".

Behavior:

1. User clicks Import.
2. Velo opens a file picker.
3. User selects an image.
4. Velo copies the image into `pic/background/`.
5. Velo updates `config/config.json` with the copied relative path.
6. Velo applies the imported image from the app-owned path.

This avoids keeping a fragile reference to an external file that may be moved or deleted.

## Task List Window

The new window is named `Task list`.

When a user starts a Trim, Merge, or Frames task:

1. The originating page validates inputs and output conflicts.
2. The frontend submits a task request to Rust.
3. Rust returns immediately with an internal task identifier.
4. Velo opens or focuses the Task list window.
5. The Task list selects the newly created task.
6. The originating page is no longer blocked by the long FFmpeg operation.

The internal task identifier is used in events, journals, and log filenames, but is hidden from normal UI.

## Task List UI

Left side: task cards.

- Cards show task type, source/output name, status, and relevant timestamp.
- Running tasks are blue.
- Pending tasks are yellow.
- Completed tasks are green.
- Failed tasks are red.
- Interrupted tasks use an orange/red warning style.
- Cards do not show progress bars.

Right side: selected task detail.

- Header: task type, file name, output path, status, started time.
- Top section: large horizontal progress bar.
- Next row: four equal metric boxes:
  - `Current frame`
  - `Video time`
  - `Speed`
  - `Output size`
- Main lower section: black live preview area.
- Bottom actions:
  - `Open Output`
  - `Reveal Log`
  - `Cancel` for running or pending tasks
  - `Retry` for failed, cancelled, or interrupted tasks

Dates and times shown to users use:

```text
YYYY/MM/DD HH:mm:ss
```

Examples:

```text
Started 2026/06/15 15:30:22
Finished 2026/06/15 15:18:04
Failed 2026/06/15 14:55:31
```

## Task States

Supported states:

- `pending`: waiting for an execution slot.
- `running`: FFmpeg child process is active.
- `completed`: task finished successfully.
- `failed`: task failed due to FFmpeg error, launch error, IO error, or another internal error.
- `cancelled`: user cancelled the task.
- `interrupted`: task was running when Velo previously exited unexpectedly.

## Concurrency

Users can configure the maximum number of concurrent tasks.

Rules:

- Default maximum concurrent tasks should be conservative, likely `1`.
- Settings may allow a bounded range such as `1-4`.
- The Rust task registry starts pending tasks while `running_count < max_concurrent_jobs`.
- Completed, failed, cancelled, or interrupted tasks free a slot.

## Job Journal and Logs

Use JSONL for structured task events and separate per-task logs for detailed FFmpeg output.

Example:

```text
jobs/
  jobs.jsonl
  logs/
    task_20260615_153022_a7f3.log
```

`jobs.jsonl` stores thin structured events:

```json
{"type":"task_created","taskId":"task_20260615_153022_a7f3","kind":"trim","request":{},"createdAt":"2026-06-15T05:30:22Z"}
{"type":"task_started","taskId":"task_20260615_153022_a7f3","startedAt":"2026-06-15T05:30:23Z"}
{"type":"task_progress","taskId":"task_20260615_153022_a7f3","percent":64,"frame":32844,"outTime":"00:11:24","speed":"1.82x","outputSize":"1.4 GB"}
{"type":"task_failed","taskId":"task_20260615_153022_a7f3","exitCode":1,"error":"FFmpeg exited with code 1","failedAt":"2026-06-15T05:45:31Z"}
```

Detailed FFmpeg stderr/stdout lines are appended to the matching log file.

Loading behavior:

- Task list reconstructs task state by replaying `jobs.jsonl`.
- The task list view should not read every detailed log on startup.
- The detail view may load recent log tail on demand when needed.

## Retry Behavior

Retry keeps the same visible task history item and same internal task ID.

Rules:

- Retry appends new lifecycle events to the same `jobs.jsonl` task history.
- Retry appends to the same per-task log file.
- Retry reuses the original request by default.
- If the original output path does not exist, retry proceeds directly.
- If the original output path exists, ask the user whether to overwrite.
- If the user chooses overwrite, retry uses the original output path.
- If the user chooses not to overwrite, Velo auto-generates a new output filename such as `old_file(1).mp4`, `old_file(2).mp4`, then retries with that path.

The normal UI should show the latest state of the task rather than a separate retry item.

## Crash and Interrupted Task Recovery

On startup, Velo replays `jobs.jsonl`.

If a task's latest persisted state is `running`, but there is no active child process in the current runtime, mark it as `interrupted`.

Startup behavior:

- Show a dialog saying Velo did not exit normally and some tasks were interrupted.
- Do not show the last 200 log lines in the startup dialog.
- Dialog actions:
  - `Retry all`
  - `Open Task list`
  - `Not now`
- Retried interrupted tasks keep their original task IDs and append to their original logs.

## Live Frame Preview

The Task list detail pane shows a live preview frame in the black lower preview area.

First-version preview strategy:

- Preview is enabled by default.
- Attempt to refresh once per second.
- Use the current FFmpeg `out_time` to extract a low-resolution image from the source video.
- If the previous preview extraction is still running, skip the next tick instead of launching another preview process.
- Preview images are stored under `preview/`.
- The preview image is an approximate visual indicator of current progress, not a guarantee of the exact encoded frame in the active FFmpeg pipeline.

Recommended preview command shape:

```text
ffmpeg -ss <out_time> -i <input> -frames:v 1 -vf scale=320:-1 <preview_path>
```

Task-specific notes:

- Trim/re-encode: use the trim source and current `out_time`.
- Copy-only: preview can still use the source but may update only briefly because the task is fast.
- Merge: first version may show preview for the currently inferred source segment if available; otherwise it can fall back to metrics without preview.
- Extract frames: use the latest generated frame file as the preview when available.

## Backend Components

Suggested Rust modules:

- `paths`: install directory and app-owned path helpers.
- `config`: reads/writes `config/config.json` and applies `config/install.json` only during first-run initialization.
- `jobs`: task models, registry, journal replay, journal append.
- `ffmpeg`: command building and process execution.
- `preview`: low-resolution preview extraction.

The existing `ffmpeg.rs` should be split or wrapped so that task execution reports structured metrics rather than only global string events.

## Frontend Components

Suggested TypeScript modules:

- `taskList.ts`: renders Task list window UI.
- `taskEvents.ts`: subscribes to structured task events and filters by task.
- `taskApi.ts`: wraps Tauri commands for creating, retrying, cancelling, listing, and opening tasks.
- settings updates for max concurrent jobs and background image import.

Existing Trim/Merge/Frames pages should submit tasks and then rely on Task list for long-running status.

## Tauri Commands and Events

Candidate commands:

- `create_task(request) -> TaskSummary`
- `list_tasks() -> Vec<TaskSummary>`
- `get_task(task_id) -> TaskDetail`
- `retry_task(task_id, output_policy) -> TaskSummary`
- `cancel_task(task_id) -> Result`
- `get_task_log_tail(task_id, lines) -> Vec<String>`
- `get_max_concurrent_jobs() -> u32`
- `set_max_concurrent_jobs(value) -> Result`
- `import_background_image(path) -> ImportedImage`

Candidate events:

- `task-created`
- `task-started`
- `task-progress`
- `task-preview-updated`
- `task-completed`
- `task-failed`
- `task-cancelled`
- `task-interrupted`

Every task event includes the internal `taskId`. The UI uses it internally but does not display it to normal users.

## Error Handling

- If install directory is not writable, show a clear startup error explaining that Velo must be installed in a user-writable folder.
- If background image import fails, keep the old background setting.
- If journal append fails, fail the task startup rather than running untraceable work.
- If preview extraction fails, keep the task running and show a non-blocking preview unavailable state.
- If log writing fails, surface the error because traceability is a core requirement.

## Testing Strategy

- Unit-test path helpers for install-relative paths and relative path resolution.
- Unit-test config read/write using a temporary install directory.
- Unit-test installer language seeding for `en_US`, `zh_CN`, unknown locale fallback, and existing config preservation.
- Unit-test background import copies files and updates config.
- Unit-test journal replay for completed, failed, cancelled, and interrupted states.
- Unit-test retry output naming: original path, overwrite, and `old_file(1).ext` fallback.
- Unit-test max concurrency scheduling.
- Unit-test FFmpeg progress parsing into structured metrics.
- Add a UI-level test or lightweight DOM test for Task list state colors and hidden task IDs.

## Open Implementation Notes

- The installer must be configured so the default install location is user-writable.
- Setup and MSI packaging must both write the selected installer locale to `config/install.json` before first launch.
- The exact Tauri multi-window routing for `Task list` should follow Tauri v2 patterns already used by this project.
- The final visual implementation should follow the approved mockup: left state cards, top progress bar, four metric boxes, and bottom black preview area.
