use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Emitter};

use crate::config;

/// 执行视频裁剪，实时将 ffmpeg 输出通过事件推送给前端
#[tauri::command]
pub async fn trim_video(
    app: AppHandle,
    input: String,
    output: String,
    start: String,
    duration: String,
    resolution: Option<String>,
    framerate: Option<String>,
) -> Result<String, String> {
    let ffmpeg_path = config::load_config()
        .ffmpeg_path
        .ok_or("未配置 FFmpeg 路径")?;

    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();

    std::thread::spawn(move || {
        let total_us = parse_duration_us(&duration).unwrap_or(0);

        let mut args = vec!["-ss".to_string(), start, "-t".to_string(), duration, "-i".to_string(), input];
        if let Some(res) = resolution {
            if !res.is_empty() {
                let filter = format!("scale={}", res.replace('x', ":"));
                args.extend_from_slice(&["-vf".to_string(), filter]);
            }
        }
        if let Some(fps) = framerate {
            if !fps.is_empty() {
                args.extend_from_slice(&["-r".to_string(), fps]);
            }
        }
        args.extend_from_slice(&["-progress".to_string(), "pipe:1".to_string(), "-y".to_string(), output]);

        let result = run_ffmpeg_cmd(&app, &ffmpeg_path, &args, total_us, "裁剪完成");
        let _ = tx.send(result);
    });

    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(Err("通道关闭".to_string())))
        .await
        .map_err(|e| format!("任务执行失败: {}", e))?
}

/// 执行视频合并：使用 FFmpeg concat demuxer
#[tauri::command]
pub async fn merge_videos(
    app: AppHandle,
    inputs: Vec<String>,
    output: String,
) -> Result<String, String> {
    let ffmpeg_path = config::load_config()
        .ffmpeg_path
        .ok_or("未配置 FFmpeg 路径")?;

    if inputs.len() < 2 {
        return Err("至少需要两个输入文件".to_string());
    }

    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();

    std::thread::spawn(move || {
        // 创建临时文件列表供 concat demuxer 使用
        let list_path = std::env::temp_dir().join("velo_concat_list.txt");
        let mut list_file = std::fs::File::create(&list_path)
            .map_err(|e| format!("创建文件列表失败: {}", e)).unwrap();
        for path in &inputs {
            // concat demuxer 要求用单引号包裹路径，内部单引号需要转义
            let escaped = path.replace('\'', "'\\''");
            writeln!(list_file, "file '{}'", escaped)
                .map_err(|e| format!("写入文件列表失败: {}", e)).unwrap();
        }
        drop(list_file);

        let list_path_str = list_path.to_string_lossy().to_string();
        let args = vec![
            "-f".to_string(), "concat".to_string(),
            "-safe".to_string(), "0".to_string(),
            "-i".to_string(), list_path_str,
            "-c".to_string(), "copy".to_string(),
            "-progress".to_string(), "pipe:1".to_string(),
            "-y".to_string(), output,
        ];

        let result = run_ffmpeg_cmd(&app, &ffmpeg_path, &args, 0, "合并完成");

        // 清理临时文件
        let _ = std::fs::remove_file(&list_path);
        let _ = tx.send(result);
    });

    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(Err("通道关闭".to_string())))
        .await
        .map_err(|e| format!("任务执行失败: {}", e))?
}

/// 执行逐帧提取：将视频帧导出为图片序列
#[tauri::command]
pub async fn extract_frames(
    app: AppHandle,
    input: String,
    output_dir: String,
    start: Option<String>,
    duration: Option<String>,
    fps: Option<String>,
    format: String,
) -> Result<String, String> {
    let ffmpeg_path = config::load_config()
        .ffmpeg_path
        .ok_or("未配置 FFmpeg 路径")?;

    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();

    std::thread::spawn(move || {
        let total_us = duration.as_ref()
            .and_then(|d| parse_duration_us(d))
            .unwrap_or(0);

        let mut args: Vec<String> = Vec::new();

        if let Some(ref ss) = start {
            if !ss.is_empty() {
                args.extend_from_slice(&["-ss".to_string(), ss.clone()]);
            }
        }
        if let Some(ref t) = duration {
            if !t.is_empty() {
                args.extend_from_slice(&["-t".to_string(), t.clone()]);
            }
        }

        args.extend_from_slice(&["-i".to_string(), input]);

        if let Some(ref r) = fps {
            if !r.is_empty() {
                args.extend_from_slice(&["-vf".to_string(), format!("fps={}", r)]);
            }
        }

        let output_pattern = std::path::Path::new(&output_dir)
            .join(format!("frame_%05d.{}", format))
            .to_string_lossy()
            .to_string();

        args.extend_from_slice(&[
            "-progress".to_string(), "pipe:1".to_string(),
            "-y".to_string(), output_pattern,
        ]);

        let result = run_ffmpeg_cmd(&app, &ffmpeg_path, &args, total_us, "提取完成");
        let _ = tx.send(result);
    });

    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(Err("通道关闭".to_string())))
        .await
        .map_err(|e| format!("任务执行失败: {}", e))?
}

/// 将 "HH:MM:SS" 或 "SS" 格式的时间字符串转换为微秒
fn parse_duration_us(s: &str) -> Option<i64> {
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
    Some((seconds * 1_000_000.0) as i64)
}

/// 通用 FFmpeg 执行器：启动进程、解析 -progress 输出、推送事件
fn run_ffmpeg_cmd(
    app: &AppHandle,
    ffmpeg_path: &str,
    args: &[String],
    total_us: i64,
    success_msg: &str,
) -> Result<String, String> {
    let mut cmd = Command::new(ffmpeg_path);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = cmd.spawn()
        .map_err(|e| format!("启动 FFmpeg 失败: {}", e))?;

    // stderr → 转发给前端
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

    // stdout → 解析 -progress key=value 输出
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
                            let t = val.trim();
                            out_time = if let Some(dot_pos) = t.rfind('.') {
                                t[..dot_pos].to_string()
                            } else {
                                t.to_string()
                            };
                        }
                        "total_size" => total_size = val.trim().to_string(),
                        "out_time_us" => {
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
        let _ = app.emit("ffmpeg-progress", 100.0_f64);
        Ok(success_msg.to_string())
    } else {
        Err(format!("FFmpeg 退出码: {}", status.code().unwrap_or(-1)))
    }
}
