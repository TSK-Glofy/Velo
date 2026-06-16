use crate::task_types::{
    TaskDetail, TaskEvent, TaskKind, TaskMetrics, TaskRequest, TaskState, TaskSummary,
};
use chrono::Utc;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

pub fn append_event(event: &TaskEvent) -> Result<(), String> {
    append_event_to_root(&crate::paths::app_root()?, event)
}

pub fn append_event_to_root(root: &Path, event: &TaskEvent) -> Result<(), String> {
    let path = crate::paths::jobs_file_from_root(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let line = serde_json::to_string(event).map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())
}

pub fn replay_tasks() -> Result<Vec<TaskDetail>, String> {
    replay_tasks_from_root(&crate::paths::app_root()?)
}

pub fn replay_tasks_from_root(root: &Path) -> Result<Vec<TaskDetail>, String> {
    let path = crate::paths::jobs_file_from_root(root);
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(Vec::new());
    };

    let mut tasks: HashMap<String, TaskDetail> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for line in content.lines().filter(|line| !line.trim().is_empty()) {
        let event: TaskEvent = serde_json::from_str(line)
            .map_err(|e| format!("Invalid job journal line: {e}"))?;
        apply_event(&mut tasks, &mut order, event);
    }

    let mut list: Vec<TaskDetail> = order
        .into_iter()
        .filter_map(|id| tasks.remove(&id))
        .collect();
    for detail in &mut list {
        if detail.summary.state == TaskState::Running {
            detail.summary.state = TaskState::Interrupted;
            detail.summary.finished_at = Some(Utc::now());
        }
    }
    list.sort_by(|a, b| b.summary.created_at.cmp(&a.summary.created_at));
    Ok(list)
}

fn apply_event(
    tasks: &mut HashMap<String, TaskDetail>,
    order: &mut Vec<String>,
    event: TaskEvent,
) {
    match event {
        TaskEvent::TaskCreated {
            task_id,
            kind,
            request,
            created_at,
        } => {
            let summary = TaskSummary {
                id: task_id.clone(),
                kind,
                state: TaskState::Pending,
                title: title_for_request(&request),
                output: output_for_request(&request),
                created_at,
                started_at: None,
                finished_at: None,
                metrics: TaskMetrics::default(),
                error: None,
            };
            order.push(task_id.clone());
            tasks.insert(
                task_id,
                TaskDetail {
                    summary,
                    request,
                },
            );
        }
        TaskEvent::TaskStarted {
            task_id,
            started_at,
        } => {
            if let Some(detail) = tasks.get_mut(&task_id) {
                detail.summary.state = TaskState::Running;
                detail.summary.started_at = Some(started_at);
            }
        }
        TaskEvent::TaskProgress {
            task_id, metrics, ..
        } => {
            if let Some(detail) = tasks.get_mut(&task_id) {
                detail.summary.metrics = metrics;
            }
        }
        TaskEvent::TaskPreviewUpdated {
            task_id,
            preview_path,
            ..
        } => {
            if let Some(detail) = tasks.get_mut(&task_id) {
                detail.summary.metrics.preview_path = Some(preview_path);
            }
        }
        TaskEvent::TaskCompleted {
            task_id,
            completed_at,
        } => {
            if let Some(detail) = tasks.get_mut(&task_id) {
                detail.summary.state = TaskState::Completed;
                detail.summary.finished_at = Some(completed_at);
                detail.summary.metrics.percent = 100.0;
            }
        }
        TaskEvent::TaskFailed {
            task_id,
            error,
            failed_at,
        } => {
            if let Some(detail) = tasks.get_mut(&task_id) {
                detail.summary.state = TaskState::Failed;
                detail.summary.finished_at = Some(failed_at);
                detail.summary.error = Some(error);
            }
        }
        TaskEvent::TaskCancelled {
            task_id,
            cancelled_at,
        } => {
            if let Some(detail) = tasks.get_mut(&task_id) {
                detail.summary.state = TaskState::Cancelled;
                detail.summary.finished_at = Some(cancelled_at);
            }
        }
        TaskEvent::TaskInterrupted {
            task_id,
            interrupted_at,
        } => {
            if let Some(detail) = tasks.get_mut(&task_id) {
                detail.summary.state = TaskState::Interrupted;
                detail.summary.finished_at = Some(interrupted_at);
            }
        }
    }
}

fn file_stem_or_name(path: &str) -> String {
    let p = Path::new(path);
    p.file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.to_string())
}

pub fn title_for_request(request: &TaskRequest) -> String {
    match request {
        TaskRequest::Trim { input, .. } => file_stem_or_name(input),
        TaskRequest::Merge { inputs, .. } => {
            if let Some(first) = inputs.first() {
                format!("{} (+{})", file_stem_or_name(first), inputs.len().saturating_sub(1))
            } else {
                "merge".to_string()
            }
        }
        TaskRequest::Frames { input, .. } => file_stem_or_name(input),
    }
}

pub fn output_for_request(request: &TaskRequest) -> Option<String> {
    match request {
        TaskRequest::Trim { output, .. } => Some(output.clone()),
        TaskRequest::Merge { output, .. } => Some(output.clone()),
        TaskRequest::Frames { output_dir, .. } => Some(output_dir.clone()),
    }
}

pub fn read_log_tail(task_id: &str, lines: usize) -> Result<Vec<String>, String> {
    read_log_tail_from_root(&crate::paths::app_root()?, task_id, lines)
}

pub fn read_log_tail_from_root(
    root: &Path,
    task_id: &str,
    lines: usize,
) -> Result<Vec<String>, String> {
    let path = crate::paths::job_log_file_from_root(root, task_id);
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(Vec::new());
    };
    let all: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let start = all.len().saturating_sub(lines);
    Ok(all[start..].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_types::{TaskEvent, TaskKind, TaskRequest, TaskState};
    use chrono::Utc;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("velo_jobs_{name}_{stamp}"))
    }

    #[test]
    fn replay_marks_completed_task_completed() {
        let root = temp_root("completed");
        let task_id = "task_20260615_153022_a7f3".to_string();
        append_event_to_root(
            &root,
            &TaskEvent::TaskCreated {
                task_id: task_id.clone(),
                kind: TaskKind::Trim,
                request: TaskRequest::Trim {
                    input: "in.mp4".into(),
                    output: "out.mp4".into(),
                    start: "0".into(),
                    duration: "10".into(),
                    resolution: None,
                    framerate: None,
                    codec_mode: Some("reencode".into()),
                    rotation: None,
                },
                created_at: Utc::now(),
            },
        )
        .unwrap();
        append_event_to_root(
            &root,
            &TaskEvent::TaskStarted {
                task_id: task_id.clone(),
                started_at: Utc::now(),
            },
        )
        .unwrap();
        append_event_to_root(
            &root,
            &TaskEvent::TaskCompleted {
                task_id: task_id.clone(),
                completed_at: Utc::now(),
            },
        )
        .unwrap();

        let tasks = replay_tasks_from_root(&root).unwrap();

        assert_eq!(tasks[0].summary.id, task_id);
        assert_eq!(tasks[0].summary.state, TaskState::Completed);
    }

    #[test]
    fn replay_marks_stale_running_task_interrupted() {
        let root = temp_root("interrupted");
        let task_id = "task_20260615_153100_b1".to_string();
        append_event_to_root(
            &root,
            &TaskEvent::TaskCreated {
                task_id: task_id.clone(),
                kind: TaskKind::Frames,
                request: TaskRequest::Frames {
                    input: "in.mp4".into(),
                    output_dir: "frames".into(),
                    start: None,
                    duration: Some("5".into()),
                    fps: None,
                    format: "png".into(),
                },
                created_at: Utc::now(),
            },
        )
        .unwrap();
        append_event_to_root(
            &root,
            &TaskEvent::TaskStarted {
                task_id: task_id.clone(),
                started_at: Utc::now(),
            },
        )
        .unwrap();

        let tasks = replay_tasks_from_root(&root).unwrap();

        assert_eq!(tasks[0].summary.state, TaskState::Interrupted);
    }

    #[test]
    fn log_tail_reads_only_requested_lines() {
        let root = temp_root("tail");
        let log_path = crate::paths::job_log_file_from_root(&root, "task_tail");
        fs::create_dir_all(log_path.parent().unwrap()).unwrap();
        fs::write(&log_path, "a\nb\nc\nd\n").unwrap();

        let tail = read_log_tail_from_root(&root, "task_tail", 2).unwrap();

        assert_eq!(tail, vec!["c".to_string(), "d".to_string()]);
    }
}
