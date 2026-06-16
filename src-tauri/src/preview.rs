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

pub fn build_preview_args(out_time: &str, input: &str, output: &str) -> Vec<String> {
    vec![
        "-ss".into(),
        out_time.into(),
        "-i".into(),
        input.into(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        "scale=320:-1".into(),
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
        let args = build_preview_args(&out_time, &input, &output);

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
                "scale=320:-1",
                "-y",
                "preview.jpg",
            ]
        );
    }
}
