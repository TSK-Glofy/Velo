use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
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
    resolution: Option<String>,
) -> Result<String, String> {
    let ffmpeg_path = config::load_config()
        .ffmpeg_path
        .ok_or("未配置 FFmpeg 路径")?;

    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();

    std::thread::spawn(move || {
        let result = run_ffmpeg(&app, &ffmpeg_path, &input, &output, &start, &duration, resolution.as_deref());
        let _ = tx.send(result);
    });

    // 异步等待结果，不阻塞主线程
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(Err("通道关闭".to_string())))
        .await
        .map_err(|e| format!("任务执行失败: {}", e))?
}

/// 将 "HH:MM:SS" 或 "SS" 格式的时间字符串转换为毫秒
fn parse_duration_ms(s: &str) -> Option<i64> {
    let parts: Vec<&str> = s.split(':').collect();
    let seconds: f64 = match parts.len() {
        1 => parts[0].parse().ok()?,
        2 => {
            let m: f64 = parts[0].parse().ok()?;
            let s: f64 = parts[1].parse().ok()?;
            m * 60.0 + s
        }
        3 => {
            let h: f64 = parts[0].parse().ok()?;
            let m: f64 = parts[1].parse().ok()?;
            let s: f64 = parts[2].parse().ok()?;
            h * 3600.0 + m * 60.0 + s
        }
        _ => return None,
    };
    Some((seconds * 1_000_000.0) as i64) // 转为微秒，与 out_time_us 对齐
}

/// 实际执行 ffmpeg 的逻辑，独立函数方便阅读
fn run_ffmpeg(
    app: &AppHandle,
    ffmpeg_path: &str,
    input: &str,
    output: &str,
    start: &str,
    duration: &str,
    resolution: Option<&str>,
) -> Result<String, String> {
    // 计算总时长（微秒），用于进度百分比
    let total_us = parse_duration_ms(duration).unwrap_or(0);

    let mut args = vec!["-ss", start, "-t", duration, "-i", input];
    // 如果指定了分辨率，添加缩放滤镜
    let scale_filter;
    if let Some(res) = resolution {
        if !res.is_empty() {
            scale_filter = format!("scale={}", res.replace('x', ":"));
            args.extend_from_slice(&["-vf", &scale_filter]);
        }
    }
    // -progress pipe:1 让 FFmpeg 将进度信息以 key=value 逐行输出到 stdout
    args.extend_from_slice(&["-progress", "pipe:1", "-y", output]);

    let mut cmd = Command::new(ffmpeg_path);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Windows 上隐藏 FFmpeg 的控制台窗口
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = cmd.spawn()
        .map_err(|e| format!("启动 FFmpeg 失败: {}", e))?;

    // 读取 stderr 用于错误诊断，出错时收集信息
    let stderr = child.stderr.take().ok_or("无法读取 FFmpeg 输出")?;
    let stderr_app = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = stderr_app.emit("ffmpeg-status", &line);
            }
        }
    });

    // 从 stdout 读取 -progress 输出，收集每轮状态并推送给前端
    let stdout = child.stdout.take().ok_or("无法读取 FFmpeg 输出")?;
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut frame = String::new();
        let mut fps = String::new();
        let mut bitrate = String::new();
        let mut speed = String::new();
        let mut out_time = String::new();
        let mut total_size = String::new();

        for line in reader.lines() {
            if let Ok(line) = line {
                if let Some((key, val)) = line.split_once('=') {
                    match key {
                        "frame" => frame = val.trim().to_string(),
                        "fps" => fps = val.trim().to_string(),
                        "bitrate" => bitrate = val.trim().to_string(),
                        "speed" => speed = val.trim().to_string(),
                        "out_time" => {
                            // 格式: 00:00:05.123456，去掉微秒部分更简洁
                            let t = val.trim();
                            out_time = if let Some(dot_pos) = t.rfind('.') {
                                t[..dot_pos].to_string()
                            } else {
                                t.to_string()
                            };
                        }
                        "total_size" => total_size = val.trim().to_string(),
                        "out_time_us" => {
                            // 计算进度百分比
                            if total_us > 0 {
                                if let Ok(current_us) = val.trim().parse::<i64>() {
                                    let percent = ((current_us as f64 / total_us as f64) * 100.0)
                                        .min(100.0)
                                        .max(0.0);
                                    let _ = app_clone.emit("ffmpeg-progress", percent);
                                }
                            }
                        }
                        "progress" => {
                            // 每轮结束时推送状态摘要
                            let size_display = match total_size.parse::<u64>() {
                                Ok(bytes) if bytes >= 1_048_576 => format!("{:.1} MB", bytes as f64 / 1_048_576.0),
                                Ok(bytes) if bytes >= 1024 => format!("{:.0} KB", bytes as f64 / 1024.0),
                                Ok(bytes) => format!("{} B", bytes),
                                Err(_) => total_size.clone(),
                            };
                            let status = format!(
                                "time: {}  |  frame: {}  |  fps: {}  |  speed: {}  |  bitrate: {}  |  size: {}",
                                out_time, frame, fps, speed, bitrate, size_display
                            );
                            let _ = app_clone.emit("ffmpeg-status", &status);
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    let status = child.wait().map_err(|e| format!("等待 FFmpeg 完成失败: {}", e))?;

    if status.success() {
        // 完成时推送 100%
        let _ = app.emit("ffmpeg-progress", 100.0_f64);
        Ok("裁剪完成".to_string())
    } else {
        Err(format!("FFmpeg 退出码: {}", status.code().unwrap_or(-1)))
    }
}
