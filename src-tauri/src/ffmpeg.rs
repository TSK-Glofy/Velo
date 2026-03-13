use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

use crate::config;

/// 执行视频裁剪，实时将 ffmpeg 输出通过事件推送给前端
/// 整个 ffmpeg 调用在独立线程中运行，不阻塞窗口
#[tauri::command]
pub async fn trim_video(
    app: AppHandle,
    input: String,
    output: String,
    start: String,
    duration: String,
) -> Result<String, String> {
    let ffmpeg_path = config::load_config()
        .ffmpeg_path
        .ok_or("未配置 FFmpeg 路径")?;

    // 使用 Tauri 自带的异步运行时，在独立线程中执行阻塞操作
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();

    std::thread::spawn(move || {
        let result = run_ffmpeg(&app, &ffmpeg_path, &input, &output, &start, &duration);
        let _ = tx.send(result);
    });

    // 异步等待结果，不阻塞主线程
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(Err("通道关闭".to_string())))
        .await
        .map_err(|e| format!("任务执行失败: {}", e))?
}

/// 实际执行 ffmpeg 的逻辑，独立函数方便阅读
fn run_ffmpeg(
    app: &AppHandle,
    ffmpeg_path: &str,
    input: &str,
    output: &str,
    start: &str,
    duration: &str,
) -> Result<String, String> {
    let mut child = Command::new(ffmpeg_path)
        .args(["-ss", start, "-t", duration, "-i", input, "-y", output])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 FFmpeg 失败: {}", e))?;

    // 在新线程中逐行读取 stderr，实时推送给前端
    let stderr = child.stderr.take().ok_or("无法读取 FFmpeg 输出")?;
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_clone.emit("ffmpeg-log", &line);
            }
        }
    });

    // 同样捕获 stdout
    let stdout = child.stdout.take().ok_or("无法读取 FFmpeg 输出")?;
    let app_clone2 = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_clone2.emit("ffmpeg-log", &line);
            }
        }
    });

    let status = child.wait().map_err(|e| format!("等待 FFmpeg 完成失败: {}", e))?;

    if status.success() {
        Ok("裁剪完成".to_string())
    } else {
        Err(format!("FFmpeg 退出码: {}", status.code().unwrap_or(-1)))
    }
}
