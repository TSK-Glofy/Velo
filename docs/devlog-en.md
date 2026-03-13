# Velo Dev Log

---

# v0.2.0 — FFmpeg Path Configuration

## Goal

Implement a first-launch setup flow that guides users to configure their FFmpeg path, laying the groundwork for video trimming features.

## Design Approach

### Overall Architecture

The project has two layers: **Rust backend** (`src-tauri/src/`) and **frontend** (`src/`), communicating via Tauri's `invoke` mechanism — similar to frontend calling backend APIs.

### File Responsibilities

Following the "one file, one responsibility" principle to keep things readable and decoupled:

#### Rust Backend

| File | Responsibility |
|------|---------------|
| `main.rs` | Program entry point, no business logic |
| `lib.rs` | Module and command registration — the "glue layer" |
| `config.rs` | Config management: read/write `~/.velo/config.json`, exposes `get_ffmpeg_path` / `set_ffmpeg_path` commands |

#### Frontend

| File | Responsibility |
|------|---------------|
| `main.ts` | Entry router: checks config → decides which page to show |
| `setup.ts` | Setup page: browse for ffmpeg.exe, save path |
| `home.ts` | Home page: entry point for video trimming (placeholder for now) |

### Why This Design

1. **config.rs is standalone**: Config management is an independent concern. Adding more settings later (e.g., default output directory) only requires changes to this one file
2. **setup.ts and home.ts are separate**: The setup page only appears on first launch; the home page is the daily-use interface. Different lifecycles, no coupling
3. **main.ts only routes**: It doesn't care how pages render — it just decides "who to show". Clean separation of concerns

### Key Technical Decisions

- **Config storage location**: Uses `dirs::config_dir()` for the system config directory (`%APPDATA%` on Windows). Config survives even if the app is moved
- **File picker dialog**: Uses `@tauri-apps/plugin-dialog`'s `open()` to launch the native OS file picker
- **Path validation**: Rust backend verifies the file exists before saving, preventing invalid paths

### New Dependencies

| Dependency | Purpose |
|-----------|---------|
| `dirs` (Rust) | Cross-platform user config directory lookup |
| `tauri-plugin-dialog` (Rust + npm) | Native OS file picker dialog |

---

# v0.3.0 — Video Trimming

## Goal

Implement the core feature: users select a video file, enter a start time and duration, invoke FFmpeg to trim, and see FFmpeg's output in real time within the app window.

## Design Approach

### New Files

Only one new file was added: `ffmpeg.rs`. Two existing files were modified.

`ffmpeg.rs` is independent from `config.rs` and solely responsible for "calling FFmpeg to execute tasks". The benefit: future FFmpeg features (transcoding, merging, audio extraction, etc.) all go into this one file without affecting config management or the UI layer.

### Real-time Output — The Key Design Decision

A normal Tauri `invoke` call is request-response: the frontend sends a request and waits for one result. But FFmpeg trimming can take seconds to minutes, and users need to see live progress.

The solution is **Tauri's event system**:

- Rust spawns the FFmpeg subprocess, then reads its output line-by-line in a separate thread
- Each line is pushed to the frontend via an event (similar to a WebSocket push model)
- The frontend listens for this event and appends each line to the log area in real time

This way, invoke handles "start the task and wait for the final result", while events handle "real-time feedback during execution". Clean separation of concerns.

### FFmpeg Output Quirk

FFmpeg writes its progress information to stderr, not stdout. This is by design. The Rust backend captures both stdout and stderr and pushes both to the frontend through the same event channel.

### Frontend Responsibility Boundary

`home.ts` only handles: rendering the form, collecting user input, calling the backend command, and displaying the log. It has no knowledge of how FFmpeg is invoked or where config is stored.

### User Flow

1. Select input video file (native OS file picker)
2. Enter start time, corresponding to FFmpeg's `-ss` parameter
3. Enter duration, corresponding to FFmpeg's `-t` parameter
4. Select output save path (native OS save dialog)
5. Click "Start Trim" — button becomes disabled
6. Log area scrolls in real time showing FFmpeg output
7. On completion, success or failure message appears, button re-enables

### Parameter Order Consideration

The `-ss` parameter is placed before `-i`, which triggers "input-level seeking". FFmpeg jumps directly to the approximate target position before doing precise seeking. This is significantly faster than placing `-ss` after `-i`, which would scan frame-by-frame from the beginning.

---

# v0.4.0 — UI Overhaul: Sidebar Navigation + Tailwind/DaisyUI

## Goal

Restructure from a single-page layout to a "sidebar + content area" layout. Replace Pico CSS with Tailwind CSS and DaisyUI to support future feature expansion (transcoding, merging, etc.). Consolidate all settings (FFmpeg path, background image) into a dedicated settings page.

## Design Approach

### Why Replace Pico CSS

Pico CSS works well for quickly styling simple pages, but it lacks layout components like sidebars and navigation panels. As features grow, a more flexible styling solution is needed.

Tailwind CSS provides atomic utility classes for precise control over any layout. DaisyUI adds ready-made components (cards, button groups, navigation) on top of Tailwind. Together they offer both flexibility and productivity.

Tailwind tree-shakes at build time, only bundling styles actually used, so the impact on final binary size is negligible.

### Layout Architecture

The interface is split into two zones:

- **Left sidebar**: A fixed 56px-wide icon navigation bar with semi-transparent dark background
- **Right content**: A scrollable content area with semi-transparent light background

This layout follows common patterns in desktop utility apps — the sidebar provides quick navigation while the content area focuses on the current feature.

### New Files

| File | Responsibility |
|------|---------------|
| `sidebar.ts` | Sidebar component: renders icon buttons, manages active state, fires page-switch callbacks |
| `settings.ts` | Settings page: combines FFmpeg path configuration and background image settings |

### File Responsibility Changes

| File | Change |
|------|--------|
| `main.ts` | Upgraded from simple router to layout controller: orchestrates sidebar + content area |
| `home.ts` | Removed background image button (moved to settings), now purely handles video trimming |
| `setup.ts` | Only used for first-launch onboarding, hidden after initial configuration |

### Navigation Mechanism

The sidebar notifies `main.ts` via callback which button the user clicked. `main.ts` then calls the corresponding render function based on the page name. This way, the sidebar doesn't need to know the implementation details of any page — it only reports "what the user clicked".

Adding a new page in the future requires just three steps: add a button to the sidebar, write a new page file, and add a branch in the `main.ts` navigate function.

### First-Launch Special Handling

If the user hasn't configured an FFmpeg path, the sidebar is hidden and the full screen shows the setup guide. Once configuration is complete, the sidebar appears and normal navigation begins. This prevents users from accessing feature pages before essential configuration is done.

### Dependency Changes

| Action | Dependency |
|--------|-----------|
| Added | `tailwindcss`, `@tailwindcss/vite`, `daisyui` |
| Removed | `@picocss/pico` |

---

# v0.4.1 — Default Output Resolution Setting

## Goal

Add a default output resolution option to the settings page. Users can preset a commonly used resolution that is automatically applied when trimming videos.

## Design Approach

### Feature Placement

Resolution setting is a "user preference", so it belongs in the settings page rather than the trim page. During trimming, the saved default is automatically read — no need to specify it every time. Selecting "Original" skips any scaling and preserves the source video resolution.

### Preset Resolution List

Common resolution tiers are provided:

| Resolution | Description |
|-----------|-------------|
| Original | No scaling, keeps source dimensions |
| 1920x1080 | 1080p Full HD |
| 1600x900 | Common laptop screen resolution |
| 1280x720 | 720p HD |
| 854x480 | 480p SD |
| 640x360 | 360p low resolution |

### Implementation

The config layer gains a `default_resolution` field, stored in the same `config.json`. The FFmpeg backend applies scaling via the `-vf scale=width:height` filter. If resolution is empty, no filter arguments are added.

### Interaction Detail

The settings page uses a dropdown select. Changes are saved automatically on selection — no extra "Save" button click required. Fewer steps, smoother experience.

---

# v0.4.2 — Window Size Presets

## Goal

Add a window size selector to the settings page. Users can switch between common sizes, and the window resizes immediately. The chosen size is also restored on next launch.

## Design Approach

### Feature Placement

Window size is a "user preference", so it belongs in the settings page alongside output resolution. Unlike output resolution (which controls the video's rendered dimensions), this option controls the Velo application window itself. They are independent settings.

### Preset Size List

| Size | Description |
|------|-------------|
| Default | 800x600, the built-in default |
| 1600x900 | Large, suitable for high-res displays |
| 1280x720 | Medium, fits most laptops |
| 1024x768 | Classic 4:3 ratio |
| 800x600 | Compact |

### Implementation

The config layer gains a `window_size` field, stored as `"widthxheight"` (e.g., `"1280x720"`). The frontend uses Tauri's window API (`getCurrentWindow().setSize()`) to resize immediately.

### Two Activation Points

1. **On settings change**: The window resizes instantly when the user selects a new size — WYSIWYG
2. **On app launch**: `main.ts` reads the saved size during initialization and applies it, ensuring the window always opens at the user's last chosen size

### Relationship to Output Resolution

The v0.4.1 "default output resolution" controls the FFmpeg output video dimensions. The v0.4.2 "window size" controls the Velo application window size. They are independent — stored separately, read separately, and do not affect each other.

---

# v0.5.0 — Trim Progress Bar

## Goal

Display a real-time progress bar during video trimming, so users can see exactly how far along the process is — replacing the raw-log-only experience.

## Design Approach

### The Problem with FFmpeg's Default Output

FFmpeg writes its progress info (frame count, fps, current time) to stderr using `\r` (carriage return) to overwrite the same line repeatedly. The previous `BufReader::lines()` approach splits by newline, so it only captured FFmpeg's startup header — not the real-time progress updates.

### Solution: -progress pipe:1

Adding `-progress pipe:1` to the FFmpeg command makes it output progress data as key=value pairs, one per line, to stdout. Each group ends with `progress=continue`. The key field is `out_time_us` — the current processed position in microseconds.

This cleanly separates concerns: stdout carries structured progress data (parseable), stderr carries log information (raw output).

### Calculating the Percentage

The user's input duration is the total length. Convert it to microseconds, then `out_time_us / total_us * 100` gives the percentage. Rust calculates this and pushes it to the frontend via the `ffmpeg-progress` event. The frontend simply updates the progress bar value.

### Time Format Parsing

Users may enter `10` (seconds), `1:30` (min:sec), or `1:02:30` (hr:min:sec). The Rust backend implements a `parse_duration_ms` function that handles all three formats.

### Frontend Progress Bar

Uses DaisyUI's `progress` component, placed above the log area with a percentage label beside it. It resets to 0% when trimming starts and receives 100% from the Rust backend on completion.

---

# v0.5.1 — FFmpeg Status Summary + UI Polish

## Goal

Replace the raw FFmpeg log output with a structured, single-line status summary showing only the key information users care about. Also polish several UI details during the trimming process.

## Design Approach

### Status Summary Instead of Log Accumulation

The old log area appended every line of FFmpeg output, which was verbose and mostly unintelligible to users. The new approach extracts key fields from `-progress` structured data (time, frame, fps, speed, bitrate, size) and composes a single summary line that updates in place.

Users now see one clean status line instead of a wall of scrolling logs.

### Show Progress Section on Demand

The progress bar and status line are meaningless before trimming starts. Wrapped them in a container with Tailwind's `hidden` class, which is removed when "Start Trim" is clicked. After trimming completes, the section stays visible so users can see the final status.

### Loading Spinner Fix

DaisyUI's `loading` class applied directly to a button inherits the button's font size — on a full-width button, the spinner looks oversized. Replaced it with an inline `loading-sm` spinner element before the button text for consistent sizing.

### Windows Compatibility

Added the `CREATE_NO_WINDOW` flag (`0x08000000`) to prevent FFmpeg from spawning a visible console window on Windows. Also restored stderr forwarding to ensure FFmpeg errors are visible to the user.

---

# v0.6.0 — Custom Icon + Title Fix + Build Optimization

## Goal

Change the window title from lowercase "velo" to properly capitalized "Velo", support custom application icons, and eliminate Vite build warnings about dynamic imports.

## Design Approach

### Window Title

The `title` field in `tauri.conf.json` controls the window title bar text. As a product name, proper capitalization is more professional.

### Custom Icon

Tauri reads icon files from `src-tauri/icons/` during packaging and embeds them into the final executable. Required files:

| File | Size | Purpose |
|------|------|---------|
| 32x32.png | 32x32 | Taskbar small icon |
| 128x128.png | 128x128 | General icon |
| 128x128@2x.png | 256x256 | HiDPI icon |
| icon.ico | Multi-size | Windows exe icon |
| icon.icns | Multi-size | macOS icon |

Users only need to prepare a single 1024x1024 PNG source image and run `npm run tauri icon` to auto-generate all sizes.

Note: In development mode (`tauri dev`), the window title bar icon won't update — only the built exe uses the custom icon. This is Windows behavior.

### Eliminating Vite Dynamic Import Warnings

`@tauri-apps/api/window` and `@tauri-apps/api/dpi` were already statically imported in `settings.ts`, but `main.ts` used `await import()` for dynamic imports. Vite warns when the same module has both static and dynamic imports, since the dynamic import won't split it into a separate chunk anyway.

Fix: converted all dynamic imports in `main.ts` and `settings.ts` to top-level static imports for consistency.
