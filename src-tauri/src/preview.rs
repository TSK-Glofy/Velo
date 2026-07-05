use std::collections::HashSet;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};

#[derive(Clone, Default)]
pub struct PreviewState {
    running: Arc<Mutex<HashSet<String>>>,
}

/// `timestamp` is an absolute position in the source video (seconds or HH:MM:SS).
pub fn build_preview_args(timestamp: &str, input: &str, output: &str) -> Vec<String> {
    vec![
        "-ss".into(),
        timestamp.into(),
        "-i".into(),
        input.into(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        "scale=640:-1".into(),
        "-y".into(),
        output.into(),
    ]
}

pub fn request_preview(
    app: AppHandle,
    preview_state: PreviewState,
    ffmpeg_path: String,
    task_id: String,
    input: String,
    timestamp: String,
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
            Err(_) => {
                if let Ok(mut running) = preview_state.running.lock() {
                    running.remove(&task_id);
                }
                return;
            }
        };
        if let Some(parent) = preview_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let output = preview_path.to_string_lossy().to_string();
        let args = build_preview_args(&timestamp, &input, &output);

        let mut cmd = Command::new(&ffmpeg_path);
        cmd.args(&args).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        let _ = cmd.output();

        let _ = app.emit(
            "task-preview-updated",
            serde_json::json!({
                "taskId": task_id,
                "previewPath": output,
            }),
        );

        if let Ok(mut running) = preview_state.running.lock() {
            running.remove(&task_id);
        }
    });
}

fn ffmpeg_path_from_config() -> Result<String, String> {
    crate::config::load_config()?
        .ffmpeg_path
        .ok_or_else(|| "FFmpeg path is not configured".to_string())
}

/// Probe the source length in seconds, for the scrub slider range.
#[tauri::command]
pub fn get_video_duration(input: String) -> Result<f64, String> {
    let ffmpeg_path = ffmpeg_path_from_config()?;
    let raw = crate::ffmpeg::probe_video_duration(&ffmpeg_path, &input)?;
    if let Ok(secs) = raw.parse::<f64>() {
        return Ok(secs);
    }
    crate::ffmpeg::parse_duration_us(&raw)
        .map(|us| us as f64 / 1_000_000.0)
        .ok_or_else(|| format!("Unable to parse duration: {raw}"))
}

/// Extract a single frame at `seconds` for scrub preview when the webview
/// cannot decode the source itself. Blocking; the frontend debounces calls.
#[tauri::command]
pub fn generate_scrub_frame(input: String, seconds: f64) -> Result<String, String> {
    let ffmpeg_path = ffmpeg_path_from_config()?;
    let frame_path = crate::paths::scrub_file(&input)?;
    if let Some(parent) = frame_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let output = frame_path.to_string_lossy().to_string();
    let timestamp = format!("{:.3}", seconds.max(0.0));
    let args = build_preview_args(&timestamp, &input, &output);

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(&args).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let status = cmd
        .status()
        .map_err(|e| format!("Failed to start FFmpeg: {e}"))?;
    if !status.success() {
        return Err(format!("FFmpeg exited with code {}", status.code().unwrap_or(-1)));
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_low_resolution_preview_args() {
        let args = build_preview_args("00:00:04", "input.mp4", "preview.jpg");
        assert_eq!(
            args,
            vec![
                "-ss",
                "00:00:04",
                "-i",
                "input.mp4",
                "-frames:v",
                "1",
                "-vf",
                "scale=640:-1",
                "-y",
                "preview.jpg",
            ]
        );
    }
}
