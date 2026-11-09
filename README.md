# Velo

A lightweight FFmpeg GUI built with Tauri + TypeScript + Rust.

Velo provides a clean interface for common FFmpeg operations — trimming, merging, frame extraction and GIF conversion. No command line needed.

## Features

- **Video Trimming** — Pick a video, set start time and duration, choose framerate, rotation, output format and codec, get a trimmed clip
- **Video Merge** — Concatenate several videos in order into a single file
- **Frame Extraction** — Export a time range as PNG / JPG / BMP stills at a chosen rate, or every frame
- **Video to GIF** — Two-pass palette encoding (palettegen/paletteuse) with adjustable frame rate and output width
- **Drag-to-select Range + Live Preview** — A timeline with two handles on the Trim / GIF / Frames pages; the frame preview follows as you drag, and the time fields stay in two-way sync
- **Flexible Time Input** — Fields accept `90`, `1:30` or `00:01:30` with sub-second precision and normalize to `HH:MM:SS`; invalid input is flagged before a task is created
- **Task Queue** — Every operation becomes a task with live progress, frame/time/speed/size metrics and an FFmpeg log tail; run up to 4 at once (configurable, 1 by default), cancel, retry, or open and reveal the output
- **Crash Recovery** — Tasks interrupted by a crash or shutdown are detected on the next launch and can be retried in one click
- **Bilingual UI** — Chinese and English, switchable at runtime; the installers ship in both languages too
- **Custom Resolution** — Preset output resolution (1080p, 720p, 480p, etc.) or keep original
- **Custom Background** — Personalize the app with your own background image
- **Storage Cleanup** — Inspect and clear task logs, preview frames, imported images and task history from Settings
- **Portable Layout** — Config, logs and previews live next to the executable, so the whole folder can be moved or carried on a USB drive
- **First-launch Setup** — Guided configuration for FFmpeg path on first run

## Screenshots

*Coming soon*

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Rust](https://rustup.rs/)
- [FFmpeg](https://ffmpeg.org/download.html) — download and place anywhere, Velo will ask for the path on first launch

### Development

```bash
npm install
npm run tauri dev
```

### Tests

```bash
npm run test:node
```

```bash
cd src-tauri && cargo test
```

### Build

```bash
npm run tauri build
```

The executable will be in `src-tauri/target/release/velo.exe`.

Installers are built per locale, because the WiX installer compiles its localized
strings into the package:

```bash
npm run build:msi:en
```

```bash
npm run build:msi:zh
```

```bash
npm run build:nsis
```

### Releasing

Releases are cut by the **Release** workflow in GitHub Actions (manual trigger only —
ordinary commits never touch CI). It takes a bare version number and a mode:
`build-only` to rehearse the build without touching the repository, `draft` to publish
a draft Release, `publish` to go public. The workflow syncs the version across all six
files that carry it, builds the three installers, tags the commit and uploads the
packages with the English half of `docs/release-notes/v<version>.md` as the body.

## Project Structure

```
src/                    # Frontend (TypeScript)
  main.ts              # Entry point, routing, window sizing, background, task events
  sidebar.ts           # Sidebar navigation component
  home.ts              # Video trimming page
  merge.ts             # Video merge page
  frames.ts            # Frame extraction page
  gif.ts               # Video to GIF page
  taskList.ts          # Task list page (progress, logs, retry/cancel)
  taskApi.ts           # Typed wrappers for the task commands
  taskFormat.ts        # Task state / metric formatting helpers
  rangeSelector.ts     # Dual-handle timeline with live frame preview
  timeFormat.ts        # Time string parsing and normalization
  settings.ts          # Settings page (FFmpeg path, background, resolution, cleanup)
  setup.ts             # First-launch onboarding
  configAccess.ts      # Config command wrappers and error mapping
  i18n.ts              # Chinese / English strings
  styles.css           # Tailwind + custom styles

src-tauri/src/          # Backend (Rust)
  main.rs              # Program entry
  lib.rs               # Module and command registration
  config.rs            # Config management (read/write JSON)
  paths.rs             # Paths relative to the executable (portable layout)
  ffmpeg.rs            # FFmpeg process execution
  jobs.rs              # Task queue, progress parsing, retry / cancel
  task_types.rs        # Task kinds and their payloads
  preview.rs           # Duration probing and scrub-frame generation
  maintenance.rs       # Cache and storage cleanup

scripts/                # Release tooling (version sync, release notes, per-locale MSI)
tests/                  # Node test suites for the scripts and frontend logic
.github/workflows/      # Manual release workflow
docs/                   # Dev logs (Chinese & English), release notes, design docs
```

## Tech Stack

- **Frontend**: TypeScript, Tailwind CSS, DaisyUI
- **Backend**: Rust, Tauri v2
- **Build**: Vite
- **Packaging**: WiX (MSI, en-US + zh-CN) and NSIS (setup.exe)

## Star History

<a href="https://www.star-history.com/?repos=TSK-Glofy%2FVelo&type=date&releases=&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=TSK-Glofy/Velo&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=TSK-Glofy/Velo&type=date&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=TSK-Glofy/Velo&type=date&legend=bottom-right" />
 </picture>
</a>

## License

See [LICENSE](LICENSE) for details.
