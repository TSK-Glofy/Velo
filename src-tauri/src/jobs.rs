use crate::task_types::{
    RetryOutputPolicy, TaskDetail, TaskEvent, TaskKind, TaskMetrics, TaskRequest, TaskState,
    TaskSummary,
};
use chrono::Utc;
use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub type SharedTaskRegistry = Arc<Mutex<TaskRegistry>>;

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

pub struct RunningTask {
    pub cancel_requested: bool,
}

pub struct TaskRegistry {
    tasks: HashMap<String, TaskDetail>,
    queue: VecDeque<String>,
    running: HashMap<String, RunningTask>,
    max_concurrent_jobs: u32,
}

impl TaskRegistry {
    pub fn empty(max_concurrent_jobs: u32) -> Self {
        Self {
            tasks: HashMap::new(),
            queue: VecDeque::new(),
            running: HashMap::new(),
            max_concurrent_jobs: max_concurrent_jobs.clamp(1, 4),
        }
    }

    pub fn from_journal(max_concurrent_jobs: u32) -> Result<Self, String> {
        let mut registry = Self::empty(max_concurrent_jobs);
        for detail in replay_tasks()? {
            registry.tasks.insert(detail.summary.id.clone(), detail);
        }
        Ok(registry)
    }

    pub fn task(&self, task_id: &str) -> Option<&TaskDetail> {
        self.tasks.get(task_id)
    }

    pub fn task_mut(&mut self, task_id: &str) -> Option<&mut TaskDetail> {
        self.tasks.get_mut(task_id)
    }

    pub fn list_summaries(&self) -> Vec<TaskSummary> {
        let mut summaries: Vec<TaskSummary> = self
            .tasks
            .values()
            .map(|d| d.summary.clone())
            .collect();
        summaries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        summaries
    }

    pub fn interrupted_summaries(&self) -> Vec<TaskSummary> {
        let mut summaries: Vec<TaskSummary> = self
            .tasks
            .values()
            .filter(|d| d.summary.state == TaskState::Interrupted)
            .map(|d| d.summary.clone())
            .collect();
        summaries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        summaries
    }

    pub fn create_task(&mut self, request: TaskRequest) -> Result<TaskSummary, String> {
        let task_id = generate_task_id();
        let kind = kind_for_request(&request);
        let created_at = Utc::now();
        let summary = TaskSummary {
            id: task_id.clone(),
            kind: kind.clone(),
            state: TaskState::Pending,
            title: title_for_request(&request),
            output: output_for_request(&request),
            created_at,
            started_at: None,
            finished_at: None,
            metrics: TaskMetrics::default(),
            error: None,
        };
        append_event(&TaskEvent::TaskCreated {
            task_id: task_id.clone(),
            kind,
            request: request.clone(),
            created_at,
        })?;
        self.tasks.insert(
            task_id.clone(),
            TaskDetail {
                summary: summary.clone(),
                request,
            },
        );
        self.queue.push_back(task_id);
        Ok(summary)
    }

    pub fn pop_startable_task_ids(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        while self.running.len() < self.max_concurrent_jobs as usize {
            match self.queue.pop_front() {
                Some(id) => {
                    self.running.insert(
                        id.clone(),
                        RunningTask {
                            cancel_requested: false,
                        },
                    );
                    out.push(id);
                }
                None => break,
            }
        }
        out
    }

    pub fn mark_finished(&mut self, task_id: &str) {
        self.running.remove(task_id);
    }

    pub fn request_cancel(&mut self, task_id: &str) -> bool {
        if let Some(running) = self.running.get_mut(task_id) {
            running.cancel_requested = true;
            true
        } else {
            false
        }
    }

    pub fn retry(
        &mut self,
        task_id: &str,
        policy: RetryOutputPolicy,
    ) -> Result<TaskSummary, String> {
        let detail = self.tasks.get_mut(task_id).ok_or("Task not found")?;
        if policy == RetryOutputPolicy::UseNumberedFallback {
            match &mut detail.request {
                TaskRequest::Trim { output, .. } | TaskRequest::Merge { output, .. } => {
                    let next = next_available_output_path(PathBuf::from(&*output))?;
                    *output = next.to_string_lossy().to_string();
                    detail.summary.output = Some(output.clone());
                }
                TaskRequest::Frames { .. } => {}
            }
        }
        detail.summary.state = TaskState::Pending;
        detail.summary.error = None;
        detail.summary.finished_at = None;
        detail.summary.started_at = None;
        detail.summary.metrics = TaskMetrics::default();
        let summary = detail.summary.clone();
        let request = detail.request.clone();
        let kind = kind_for_request(&request);
        append_event(&TaskEvent::TaskCreated {
            task_id: task_id.to_string(),
            kind,
            request,
            created_at: summary.created_at,
        })?;
        self.queue.push_back(task_id.to_string());
        Ok(summary)
    }

    #[cfg(test)]
    pub fn new_for_tests(max_concurrent_jobs: u32) -> Self {
        Self::empty(max_concurrent_jobs)
    }

    #[cfg(test)]
    pub fn insert_pending_for_tests(&mut self, request: TaskRequest) -> String {
        let task_id = generate_task_id_with_suffix(self.tasks.len() as u32);
        let kind = kind_for_request(&request);
        let summary = TaskSummary {
            id: task_id.clone(),
            kind,
            state: TaskState::Pending,
            title: title_for_request(&request),
            output: output_for_request(&request),
            created_at: Utc::now(),
            started_at: None,
            finished_at: None,
            metrics: TaskMetrics::default(),
            error: None,
        };
        self.tasks.insert(
            task_id.clone(),
            TaskDetail {
                summary,
                request,
            },
        );
        self.queue.push_back(task_id.clone());
        task_id
    }

    #[cfg(test)]
    pub fn insert_interrupted_for_tests(&mut self, request: TaskRequest) -> String {
        let task_id = generate_task_id_with_suffix(self.tasks.len() as u32);
        let kind = kind_for_request(&request);
        let summary = TaskSummary {
            id: task_id.clone(),
            kind,
            state: TaskState::Interrupted,
            title: title_for_request(&request),
            output: output_for_request(&request),
            created_at: Utc::now(),
            started_at: Some(Utc::now()),
            finished_at: Some(Utc::now()),
            metrics: TaskMetrics::default(),
            error: None,
        };
        self.tasks.insert(
            task_id.clone(),
            TaskDetail { summary, request },
        );
        task_id
    }

    #[cfg(test)]
    pub fn insert_failed_for_tests(&mut self, request: TaskRequest, error: &str) -> String {
        let task_id = generate_task_id_with_suffix(self.tasks.len() as u32);
        let kind = kind_for_request(&request);
        let summary = TaskSummary {
            id: task_id.clone(),
            kind,
            state: TaskState::Failed,
            title: title_for_request(&request),
            output: output_for_request(&request),
            created_at: Utc::now(),
            started_at: Some(Utc::now()),
            finished_at: Some(Utc::now()),
            metrics: TaskMetrics::default(),
            error: Some(error.to_string()),
        };
        self.tasks.insert(
            task_id.clone(),
            TaskDetail {
                summary,
                request,
            },
        );
        task_id
    }

    #[cfg(test)]
    pub fn retry_for_tests(
        &mut self,
        task_id: &str,
        policy: RetryOutputPolicy,
    ) -> Result<(), String> {
        let detail = self.tasks.get_mut(task_id).ok_or("Task not found")?;
        if policy == RetryOutputPolicy::UseNumberedFallback {
            match &mut detail.request {
                TaskRequest::Trim { output, .. } | TaskRequest::Merge { output, .. } => {
                    let next = next_available_output_path(PathBuf::from(&*output))?;
                    *output = next.to_string_lossy().to_string();
                    detail.summary.output = Some(output.clone());
                }
                TaskRequest::Frames { .. } => {}
            }
        }
        detail.summary.state = TaskState::Pending;
        detail.summary.error = None;
        detail.summary.finished_at = None;
        detail.summary.started_at = None;
        detail.summary.metrics = TaskMetrics::default();
        self.queue.push_back(task_id.to_string());
        Ok(())
    }
}

fn kind_for_request(request: &TaskRequest) -> TaskKind {
    match request {
        TaskRequest::Trim { .. } => TaskKind::Trim,
        TaskRequest::Merge { .. } => TaskKind::Merge,
        TaskRequest::Frames { .. } => TaskKind::Frames,
    }
}

fn generate_task_id() -> String {
    let now = Utc::now();
    let stamp = now.format("%Y%m%d_%H%M%S");
    let suffix = now.timestamp_subsec_nanos() & 0xFFFF;
    format!("task_{}_{:04x}", stamp, suffix)
}

#[cfg(test)]
fn generate_task_id_with_suffix(seq: u32) -> String {
    let now = Utc::now();
    let stamp = now.format("%Y%m%d_%H%M%S");
    let suffix = (now.timestamp_subsec_nanos() ^ seq) & 0xFFFF;
    format!("task_{}_{:04x}{:04x}", stamp, suffix, seq)
}

pub fn next_available_output_path(path: PathBuf) -> Result<PathBuf, String> {
    if !path.exists() {
        return Ok(path);
    }
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?
        .to_string();
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string());
    for idx in 1..u32::MAX {
        let name = match &ext {
            Some(e) => format!("{stem}({idx}).{e}"),
            None => format!("{stem}({idx})"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Unable to find an available output filename".to_string())
}

pub fn schedule_ready_tasks(app: tauri::AppHandle, registry: SharedTaskRegistry) {
    let task_ids = {
        let mut locked = match registry.lock() {
            Ok(v) => v,
            Err(_) => return,
        };
        locked.pop_startable_task_ids()
    };

    for task_id in task_ids {
        let app_clone = app.clone();
        let registry_clone = registry.clone();
        std::thread::spawn(move || {
            let _ = crate::ffmpeg::run_ffmpeg_task(
                app_clone.clone(),
                registry_clone.clone(),
                task_id,
            );
            schedule_ready_tasks(app_clone, registry_clone);
        });
    }
}

#[tauri::command]
pub fn create_task(
    app: tauri::AppHandle,
    state: tauri::State<SharedTaskRegistry>,
    request: TaskRequest,
) -> Result<TaskSummary, String> {
    let summary = {
        let mut registry = state
            .lock()
            .map_err(|_| "Task registry lock failed".to_string())?;
        registry.create_task(request)?
    };
    schedule_ready_tasks(app, state.inner().clone());
    Ok(summary)
}

#[tauri::command]
pub fn list_tasks(state: tauri::State<SharedTaskRegistry>) -> Result<Vec<TaskSummary>, String> {
    let registry = state
        .lock()
        .map_err(|_| "Task registry lock failed".to_string())?;
    Ok(registry.list_summaries())
}

#[tauri::command]
pub fn get_task(
    state: tauri::State<SharedTaskRegistry>,
    task_id: String,
) -> Result<TaskDetail, String> {
    let registry = state
        .lock()
        .map_err(|_| "Task registry lock failed".to_string())?;
    registry
        .task(&task_id)
        .cloned()
        .ok_or_else(|| "Task not found".to_string())
}

#[tauri::command]
pub fn get_task_log_tail(task_id: String, lines: usize) -> Result<Vec<String>, String> {
    read_log_tail(&task_id, lines.min(500))
}

fn retry_task_inner(
    app: tauri::AppHandle,
    registry: SharedTaskRegistry,
    task_id: String,
    output_policy: RetryOutputPolicy,
) -> Result<TaskSummary, String> {
    let summary = {
        let mut locked = registry
            .lock()
            .map_err(|_| "Task registry lock failed".to_string())?;
        locked.retry(&task_id, output_policy)?
    };
    schedule_ready_tasks(app, registry);
    Ok(summary)
}

#[tauri::command]
pub fn retry_task(
    app: tauri::AppHandle,
    state: tauri::State<SharedTaskRegistry>,
    task_id: String,
    output_policy: RetryOutputPolicy,
) -> Result<TaskSummary, String> {
    retry_task_inner(app, state.inner().clone(), task_id, output_policy)
}

#[tauri::command]
pub fn list_interrupted_tasks(
    state: tauri::State<SharedTaskRegistry>,
) -> Result<Vec<TaskSummary>, String> {
    let registry = state
        .lock()
        .map_err(|_| "Task registry lock failed".to_string())?;
    Ok(registry.interrupted_summaries())
}

#[tauri::command]
pub fn retry_interrupted_tasks(
    app: tauri::AppHandle,
    state: tauri::State<SharedTaskRegistry>,
) -> Result<Vec<TaskSummary>, String> {
    let registry_state = state.inner().clone();
    let task_ids: Vec<String> = {
        let locked = registry_state
            .lock()
            .map_err(|_| "Task registry lock failed".to_string())?;
        locked
            .interrupted_summaries()
            .into_iter()
            .map(|task| task.id)
            .collect()
    };
    let mut summaries = Vec::new();
    for task_id in task_ids {
        summaries.push(retry_task_inner(
            app.clone(),
            registry_state.clone(),
            task_id,
            RetryOutputPolicy::UseOriginal,
        )?);
    }
    Ok(summaries)
}

#[tauri::command]
pub fn cancel_task(
    state: tauri::State<SharedTaskRegistry>,
    task_id: String,
) -> Result<bool, String> {
    let mut registry = state
        .lock()
        .map_err(|_| "Task registry lock failed".to_string())?;
    Ok(registry.request_cancel(&task_id))
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

    fn sample_trim_request(input: &str, output: &str) -> TaskRequest {
        TaskRequest::Trim {
            input: input.into(),
            output: output.into(),
            start: "0".into(),
            duration: "10".into(),
            resolution: None,
            framerate: None,
            codec_mode: Some("reencode".into()),
            rotation: None,
        }
    }

    #[test]
    fn scheduler_starts_only_up_to_configured_limit() {
        let mut registry = TaskRegistry::new_for_tests(1);
        let first =
            registry.insert_pending_for_tests(sample_trim_request("one.mp4", "one-out.mp4"));
        let second =
            registry.insert_pending_for_tests(sample_trim_request("two.mp4", "two-out.mp4"));

        let ready = registry.pop_startable_task_ids();

        assert_eq!(ready, vec![first]);
        assert_eq!(
            registry.task(&second).unwrap().summary.state,
            TaskState::Pending
        );
    }

    #[test]
    fn retry_keeps_same_task_id_and_request() {
        let mut registry = TaskRegistry::new_for_tests(1);
        let task_id = registry.insert_failed_for_tests(
            sample_trim_request("one.mp4", "one-out.mp4"),
            "failed",
        );

        registry
            .retry_for_tests(&task_id, RetryOutputPolicy::UseOriginal)
            .unwrap();

        let detail = registry.task(&task_id).unwrap();
        assert_eq!(detail.summary.id, task_id);
        assert_eq!(detail.summary.state, TaskState::Pending);
    }

    #[test]
    fn interrupted_tasks_are_reported_for_startup_recovery() {
        let mut registry = TaskRegistry::new_for_tests(1);
        let id = registry
            .insert_interrupted_for_tests(sample_trim_request("in.mp4", "out.mp4"));

        let interrupted = registry.interrupted_summaries();

        assert_eq!(interrupted.len(), 1);
        assert_eq!(interrupted[0].id, id);
    }

    #[test]
    fn output_fallback_generates_numbered_filename() {
        let root = temp_root("retry_name");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("old_file.mp4"), b"existing").unwrap();
        fs::write(root.join("old_file(1).mp4"), b"existing").unwrap();

        let next = next_available_output_path(root.join("old_file.mp4")).unwrap();

        assert!(next.ends_with("old_file(2).mp4"));
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
