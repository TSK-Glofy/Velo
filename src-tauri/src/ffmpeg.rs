use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use chrono::Utc;
use tauri::{AppHandle, Emitter};

use crate::config;
use crate::jobs::{self, SharedTaskRegistry};
use crate::preview;
use crate::task_types::{TaskEvent, TaskMetrics, TaskRequest, TaskState};
use tauri::Manager;

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

fn probe_video_duration(ffmpeg_path: &str, input: &str) -> Result<String, String> {
    if let Ok(d) = probe_duration_with_ffprobe(ffmpeg_path, input) {
        return Ok(d);
    }
    probe_duration_with_ffmpeg(ffmpeg_path, input)
}

fn probe_duration_with_ffprobe(ffmpeg_path: &str, input: &str) -> Result<String, String> {
    let ffprobe_path = ffprobe_path_from_ffmpeg(ffmpeg_path);
    let mut cmd = Command::new(&ffprobe_path);
    cmd.args([
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nokey=1:noprint_wrappers=1",
        input,
    ]);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to probe duration (ffprobe): {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("ffprobe failed: {}", err));
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return Err("ffprobe returned empty duration".to_string());
    }
    let secs: f64 = raw
        .parse()
        .map_err(|_| format!("Invalid ffprobe duration format: {}", raw))?;
    if secs <= 0.0 {
        return Err(format!("Invalid ffprobe duration value: {}", raw));
    }
    Ok(format!("{:.3}", secs))
}

fn probe_duration_with_ffmpeg(ffmpeg_path: &str, input: &str) -> Result<String, String> {
    let mut cmd = Command::new(ffmpeg_path);
    cmd.args(["-i", input])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to probe duration (ffmpeg): {}", e))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    for line in stderr.lines() {
        if let Some(idx) = line.find("Duration: ") {
            let rest = &line[(idx + "Duration: ".len())..];
            if let Some(end) = rest.find(',') {
                let duration = rest[..end].trim();
                if !duration.is_empty() && duration != "N/A" {
                    return Ok(duration.to_string());
                }
            }
        }
    }
    Err("Unable to detect video duration".to_string())
}

fn ffprobe_path_from_ffmpeg(ffmpeg_path: &str) -> String {
    let path = Path::new(ffmpeg_path);
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    let ffprobe_name = if ext.is_empty() { "ffprobe".to_string() } else { format!("ffprobe.{}", ext) };
    parent.join(ffprobe_name).to_string_lossy().to_string()
}

/// Normalize FFmpeg progress timestamp to microseconds.
/// Some FFmpeg builds emit `out_time_us`, some emit `out_time_ms`.
fn normalize_progress_time_us(key: &str, raw: i64, total_us: i64) -> Option<i64> {
    match key {
        "out_time_us" => Some(raw),
        "out_time_ms" => {
            if total_us > 0 {
                let total_ms = total_us / 1000;
                // If value is close to total_ms scale, treat it as milliseconds.
                if raw >= 0 && raw <= total_ms.saturating_add(1000) {
                    return Some(raw.saturating_mul(1000));
                }
            }
            // Fallback: treat as microseconds.
            Some(raw)
        }
        _ => None,
    }
}


pub struct BuiltFfmpegTask {
    pub args: Vec<String>,
    pub total_us: i64,
    pub primary_input: Option<String>,
    /// -ss offset of the primary input (µs); progress out_time is relative
    /// to the output, so previews must add this back to seek the source.
    pub preview_offset_us: i64,
}

fn format_output_size(bytes: u64) -> String {
    if bytes >= 1_048_576 {
        format!("{:.1} MB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

pub struct ProgressParser {
    total_us: i64,
    metrics: TaskMetrics,
    saw_progress_marker: bool,
}

impl ProgressParser {
    pub fn new(total_us: i64) -> Self {
        Self {
            total_us,
            metrics: TaskMetrics::default(),
            saw_progress_marker: false,
        }
    }

    pub fn accept_line(&mut self, line: &str) {
        let Some((key, val)) = line.split_once('=') else {
            return;
        };
        let val = val.trim();
        match key {
            "frame" => self.metrics.frame = Some(val.to_string()),
            "speed" => self.metrics.speed = Some(val.to_string()),
            "out_time" => {
                let trimmed = if let Some(dot) = val.rfind('.') {
                    &val[..dot]
                } else {
                    val
                };
                self.metrics.out_time = Some(trimmed.to_string());
            }
            "total_size" => {
                if let Ok(bytes) = val.parse::<u64>() {
                    self.metrics.output_size = Some(format_output_size(bytes));
                } else {
                    self.metrics.output_size = Some(val.to_string());
                }
            }
            "out_time_us" | "out_time_ms" => {
                if self.total_us > 0 {
                    if let Ok(raw) = val.parse::<i64>() {
                        if let Some(current) =
                            normalize_progress_time_us(key, raw, self.total_us)
                        {
                            let pct = (current as f64 / self.total_us as f64 * 100.0)
                                .clamp(0.0, 100.0);
                            self.metrics.percent = pct;
                        }
                    }
                }
            }
            "progress" => {
                self.saw_progress_marker = true;
            }
            _ => {}
        }
    }

    pub fn metrics(&self) -> TaskMetrics {
        self.metrics.clone()
    }

    pub fn take_progress_marker(&mut self) -> bool {
        let v = self.saw_progress_marker;
        self.saw_progress_marker = false;
        v
    }
}

pub fn build_task_command(
    ffmpeg_path: &str,
    request: &TaskRequest,
) -> Result<BuiltFfmpegTask, String> {
    match request {
        TaskRequest::Trim {
            input,
            output,
            start,
            duration,
            resolution,
            framerate,
            codec_mode,
            rotation,
        } => build_trim_command(
            ffmpeg_path,
            input,
            output,
            start,
            duration,
            resolution,
            framerate,
            codec_mode,
            rotation,
        ),
        TaskRequest::Merge { inputs, output } => build_merge_command(inputs, output),
        TaskRequest::Frames {
            input,
            output_dir,
            start,
            duration,
            fps,
            format,
        } => build_frames_command(input, output_dir, start, duration, fps, format),
    }
}

pub fn build_trim_command(
    ffmpeg_path: &str,
    input: &str,
    output: &str,
    start: &str,
    duration: &str,
    resolution: &Option<String>,
    framerate: &Option<String>,
    codec_mode: &Option<String>,
    rotation: &Option<String>,
) -> Result<BuiltFfmpegTask, String> {
    let effective_start = if start.trim().is_empty() {
        "0".to_string()
    } else {
        start.trim().to_string()
    };
    let effective_duration = if duration.trim().is_empty() {
        let probed = probe_video_duration(ffmpeg_path, input)?;
        let detected_us = parse_duration_us(&probed).unwrap_or(0);
        let start_us = parse_duration_us(&effective_start).unwrap_or(0);
        if detected_us > start_us && start_us > 0 {
            format!("{:.3}", (detected_us - start_us) as f64 / 1_000_000.0)
        } else {
            probed
        }
    } else {
        duration.trim().to_string()
    };
    let total_us = parse_duration_us(&effective_duration).unwrap_or(0);
    let preview_offset_us = parse_duration_us(&effective_start).unwrap_or(0);
    let is_copy = codec_mode.as_deref() == Some("copy");

    let mut args: Vec<String> = Vec::new();
    args.extend_from_slice(&["-ss".to_string(), effective_start]);
    args.extend_from_slice(&["-t".to_string(), effective_duration]);
    args.extend_from_slice(&["-i".to_string(), input.to_string()]);

    if is_copy {
        args.extend_from_slice(&["-c".to_string(), "copy".to_string()]);
    } else {
        let mut filters: Vec<String> = Vec::new();
        if let Some(res) = resolution {
            if !res.is_empty() {
                filters.push(format!("scale={}", res.replace('x', ":")));
            }
        }
        if let Some(rot) = rotation {
            match rot.as_str() {
                "right" => filters.push("transpose=1".to_string()),
                "left" => filters.push("transpose=2".to_string()),
                "180" => filters.push("hflip,vflip".to_string()),
                _ => {}
            }
        }
        if !filters.is_empty() {
            args.extend_from_slice(&["-vf".to_string(), filters.join(",")]);
        }
        if let Some(fps) = framerate {
            if !fps.is_empty() {
                args.extend_from_slice(&["-r".to_string(), fps.clone()]);
            }
        }
    }
    args.extend_from_slice(&[
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-y".to_string(),
        output.to_string(),
    ]);

    Ok(BuiltFfmpegTask {
        args,
        total_us,
        primary_input: Some(input.to_string()),
        preview_offset_us,
    })
}

pub fn build_merge_command(inputs: &[String], output: &str) -> Result<BuiltFfmpegTask, String> {
    if inputs.len() < 2 {
        return Err("至少需要两个输入文件".to_string());
    }
    let stamp = Utc::now().timestamp_nanos_opt().unwrap_or(0);
    let list_path = std::env::temp_dir().join(format!("velo_concat_list_{stamp}.txt"));
    let mut list_file = std::fs::File::create(&list_path)
        .map_err(|e| format!("创建文件列表失败: {}", e))?;
    for path in inputs {
        let escaped = path.replace('\'', "'\\''");
        writeln!(list_file, "file '{}'", escaped)
            .map_err(|e| format!("写入文件列表失败: {}", e))?;
    }
    drop(list_file);

    let args = vec![
        "-f".to_string(),
        "concat".to_string(),
        "-safe".to_string(),
        "0".to_string(),
        "-i".to_string(),
        list_path.to_string_lossy().to_string(),
        "-c".to_string(),
        "copy".to_string(),
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-y".to_string(),
        output.to_string(),
    ];

    Ok(BuiltFfmpegTask {
        args,
        total_us: 0,
        primary_input: inputs.first().cloned(),
        preview_offset_us: 0,
    })
}

pub fn build_frames_command(
    input: &str,
    output_dir: &str,
    start: &Option<String>,
    duration: &Option<String>,
    fps: &Option<String>,
    format: &str,
) -> Result<BuiltFfmpegTask, String> {
    let total_us = duration
        .as_ref()
        .and_then(|d| parse_duration_us(d))
        .unwrap_or(0);
    let preview_offset_us = start
        .as_ref()
        .and_then(|s| parse_duration_us(s))
        .unwrap_or(0);

    let mut args: Vec<String> = Vec::new();
    if let Some(ss) = start {
        if !ss.is_empty() {
            args.extend_from_slice(&["-ss".to_string(), ss.clone()]);
        }
    }
    if let Some(t) = duration {
        if !t.is_empty() {
            args.extend_from_slice(&["-t".to_string(), t.clone()]);
        }
    }
    args.extend_from_slice(&["-i".to_string(), input.to_string()]);
    if let Some(r) = fps {
        if !r.is_empty() {
            args.extend_from_slice(&["-vf".to_string(), format!("fps={}", r)]);
        }
    }
    let output_pattern = Path::new(output_dir)
        .join(format!("frame_%05d.{}", format))
        .to_string_lossy()
        .to_string();
    args.extend_from_slice(&[
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-y".to_string(),
        output_pattern,
    ]);

    Ok(BuiltFfmpegTask {
        args,
        total_us,
        primary_input: Some(input.to_string()),
        preview_offset_us,
    })
}

pub fn run_ffmpeg_task(
    app: AppHandle,
    registry: SharedTaskRegistry,
    task_id: String,
) -> Result<(), String> {
    let ffmpeg_path = config::load_config()?
        .ffmpeg_path
        .ok_or("FFmpeg path is not configured")?;

    let request = {
        let r = registry
            .lock()
            .map_err(|_| "Task registry lock failed".to_string())?;
        r.task(&task_id)
            .ok_or_else(|| "Task not found".to_string())?
            .request
            .clone()
    };

    let built = match build_task_command(&ffmpeg_path, &request) {
        Ok(b) => b,
        Err(e) => {
            finish_task_failed(&app, &registry, &task_id, &e);
            return Err(e);
        }
    };

    let started_at = Utc::now();
    let _ = jobs::append_event(&TaskEvent::TaskStarted {
        task_id: task_id.clone(),
        started_at,
    });
    {
        if let Ok(mut r) = registry.lock() {
            if let Some(d) = r.task_mut(&task_id) {
                d.summary.state = TaskState::Running;
                d.summary.started_at = Some(started_at);
                let _ = app.emit("task-started", &d.summary);
            }
        }
    }

    let log_path = match crate::paths::job_log_file(&task_id) {
        Ok(p) => p,
        Err(e) => {
            finish_task_failed(&app, &registry, &task_id, &e);
            return Err(e);
        }
    };
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let log_file = match OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        Ok(f) => Arc::new(Mutex::new(f)),
        Err(e) => {
            let err = format!("Failed to open log file: {e}");
            finish_task_failed(&app, &registry, &task_id, &err);
            return Err(err);
        }
    };

    let mut cmd = Command::new(&ffmpeg_path);
    cmd.args(&built.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let err = format!("启动 FFmpeg 失败: {e}");
            finish_task_failed(&app, &registry, &task_id, &err);
            return Err(err);
        }
    };

    let stderr = child.stderr.take().ok_or("无法读取 FFmpeg 输出")?;
    let log_for_stderr = log_file.clone();
    let stderr_thread = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            if let Ok(mut f) = log_for_stderr.lock() {
                let _ = writeln!(f, "{}", line);
            }
        }
    });

    let stdout = child.stdout.take().ok_or("无法读取 FFmpeg 输出")?;
    let parser = Arc::new(Mutex::new(ProgressParser::new(built.total_us)));
    let log_for_stdout = log_file.clone();
    let app_for_stdout = app.clone();
    let registry_for_stdout = registry.clone();
    let task_id_for_stdout = task_id.clone();
    let parser_for_stdout = parser.clone();
    let preview_state = app.state::<preview::PreviewState>().inner().clone();
    let preview_input = built.primary_input.clone();
    let preview_offset_us = built.preview_offset_us;
    let ffmpeg_for_preview = ffmpeg_path.clone();
    let stdout_thread = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if let Ok(mut f) = log_for_stdout.lock() {
                let _ = writeln!(f, "{}", line);
            }
            let emit_now = {
                let mut p = match parser_for_stdout.lock() {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                p.accept_line(&line);
                p.take_progress_marker()
            };
            if emit_now {
                let metrics = parser_for_stdout
                    .lock()
                    .map(|p| p.metrics())
                    .unwrap_or_default();
                let _ = jobs::append_event(&TaskEvent::TaskProgress {
                    task_id: task_id_for_stdout.clone(),
                    metrics: metrics.clone(),
                    updated_at: Utc::now(),
                });
                if let Ok(mut r) = registry_for_stdout.lock() {
                    if let Some(d) = r.task_mut(&task_id_for_stdout) {
                        d.summary.metrics = metrics.clone();
                        let _ = app_for_stdout.emit("task-progress", &d.summary);
                    }
                }
                if let (Some(input), Some(out_time)) =
                    (preview_input.as_ref(), metrics.out_time.as_ref())
                {
                    // out_time is relative to the trimmed output; add the -ss
                    // offset back so the preview frame comes from the right
                    // spot in the source video.
                    let absolute_us =
                        preview_offset_us + parse_duration_us(out_time).unwrap_or(0);
                    let timestamp = format!("{:.3}", absolute_us as f64 / 1_000_000.0);
                    preview::request_preview(
                        app_for_stdout.clone(),
                        preview_state.clone(),
                        ffmpeg_for_preview.clone(),
                        task_id_for_stdout.clone(),
                        input.clone(),
                        timestamp,
                    );
                }
            }
        }
    });

    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) => {
                let cancelled = registry
                    .lock()
                    .ok()
                    .map(|r| r.cancel_requested(&task_id))
                    .unwrap_or(false);
                if cancelled {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stderr_thread.join();
                    let _ = stdout_thread.join();
                    finish_task_cancelled(&app, &registry, &task_id);
                    return Ok(());
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            Err(e) => {
                let err = format!("等待 FFmpeg 完成失败: {}", e);
                finish_task_failed(&app, &registry, &task_id, &err);
                return Err(err);
            }
        }
    };
    let _ = stderr_thread.join();
    let _ = stdout_thread.join();

    if status.success() {
        finish_task_completed(&app, &registry, &task_id);
        Ok(())
    } else {
        let err = format!("FFmpeg 退出码: {}", status.code().unwrap_or(-1));
        finish_task_failed(&app, &registry, &task_id, &err);
        Err(err)
    }
}

fn finish_task_cancelled(app: &AppHandle, registry: &SharedTaskRegistry, task_id: &str) {
    let cancelled_at = Utc::now();
    let _ = jobs::append_event(&TaskEvent::TaskCancelled {
        task_id: task_id.to_string(),
        cancelled_at,
    });
    if let Ok(mut r) = registry.lock() {
        if let Some(d) = r.task_mut(task_id) {
            d.summary.state = TaskState::Cancelled;
            d.summary.finished_at = Some(cancelled_at);
            let _ = app.emit("task-cancelled", &d.summary);
        }
        r.mark_finished(task_id);
    }
}

fn finish_task_completed(app: &AppHandle, registry: &SharedTaskRegistry, task_id: &str) {
    let finished_at = Utc::now();
    let _ = jobs::append_event(&TaskEvent::TaskCompleted {
        task_id: task_id.to_string(),
        completed_at: finished_at,
    });
    if let Ok(mut r) = registry.lock() {
        if let Some(d) = r.task_mut(task_id) {
            d.summary.state = TaskState::Completed;
            d.summary.finished_at = Some(finished_at);
            d.summary.metrics.percent = 100.0;
            let _ = app.emit("task-completed", &d.summary);
        }
        r.mark_finished(task_id);
    }
}

fn finish_task_failed(
    app: &AppHandle,
    registry: &SharedTaskRegistry,
    task_id: &str,
    error: &str,
) {
    let finished_at = Utc::now();
    let _ = jobs::append_event(&TaskEvent::TaskFailed {
        task_id: task_id.to_string(),
        error: error.to_string(),
        failed_at: finished_at,
    });
    if let Ok(mut r) = registry.lock() {
        if let Some(d) = r.task_mut(task_id) {
            d.summary.state = TaskState::Failed;
            d.summary.finished_at = Some(finished_at);
            d.summary.error = Some(error.to_string());
            let _ = app.emit("task-failed", &d.summary);
        }
        r.mark_finished(task_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trim_command_records_preview_offset() {
        let built = build_trim_command(
            "ffmpeg",
            "in.mp4",
            "out.mp4",
            "00:01:00",
            "10",
            &None,
            &None,
            &None,
            &None,
        )
        .unwrap();
        assert_eq!(built.preview_offset_us, 60_000_000);
        assert_eq!(built.total_us, 10_000_000);
        assert_eq!(built.args[0..2], ["-ss".to_string(), "00:01:00".to_string()]);
    }

    #[test]
    fn parses_progress_metrics_with_percent() {
        let mut parser = ProgressParser::new(10_000_000);
        parser.accept_line("frame=42");
        parser.accept_line("out_time=00:00:05.000000");
        parser.accept_line("speed=1.5x");
        parser.accept_line("total_size=1048576");
        parser.accept_line("out_time_us=5000000");

        let metrics = parser.metrics();

        assert_eq!(metrics.frame.as_deref(), Some("42"));
        assert_eq!(metrics.out_time.as_deref(), Some("00:00:05"));
        assert_eq!(metrics.speed.as_deref(), Some("1.5x"));
        assert_eq!(metrics.output_size.as_deref(), Some("1.0 MB"));
        assert_eq!(metrics.percent.round(), 50.0);
    }
}
