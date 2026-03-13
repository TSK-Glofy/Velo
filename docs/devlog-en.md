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
