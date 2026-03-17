# Velo

A lightweight FFmpeg GUI built with Tauri + TypeScript + Rust.

Velo provides a clean interface for common FFmpeg operations, starting with video trimming. No command line needed.

## Features

- **Video Trimming** — Select a video, set start time and duration, get a trimmed clip
- **Real-time FFmpeg Output** — See FFmpeg's progress log live in the app
- **Custom Resolution** — Preset output resolution (1080p, 720p, 480p, etc.) or keep original
- **Custom Background** — Personalize the app with your own background image
- **First-launch Setup** — Guided configuration for FFmpeg path on first run

## Screenshots

*Coming soon*

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/)
- [FFmpeg](https://ffmpeg.org/download.html) — download and place anywhere, Velo will ask for the path on first launch

### Development

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

The executable will be in `src-tauri/target/release/velo.exe`.

## Project Structure

```
src/                    # Frontend (TypeScript)
  main.ts              # Entry point, routing, background loading
  sidebar.ts           # Sidebar navigation component
  home.ts              # Video trimming page
  settings.ts          # Settings page (FFmpeg path, background, resolution)
  setup.ts             # First-launch onboarding
  styles.css           # Tailwind + custom styles

src-tauri/src/          # Backend (Rust)
  main.rs              # Program entry
  lib.rs               # Module registration
  config.rs            # Config management (read/write JSON)
  ffmpeg.rs            # FFmpeg process execution

docs/                   # Dev logs (Chinese & English)
```

## Tech Stack

- **Frontend**: TypeScript, Tailwind CSS, DaisyUI
- **Backend**: Rust, Tauri v2
- **Build**: Vite

## Star History

<a href="https://www.star-history.com/?repos=TSK-Glofy%2FVelo&type=date&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=TSK-Glofy/Velo&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=TSK-Glofy/Velo&type=date&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=TSK-Glofy/Velo&type=date&legend=bottom-right" />
 </picture>
</a>

## License

See [LICENSE](LICENSE) for details.
