use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskKind {
    Trim,
    Merge,
    Frames,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskState {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TaskRequest {
    Trim {
        input: String,
        output: String,
        start: String,
        duration: String,
        resolution: Option<String>,
        framerate: Option<String>,
        codec_mode: Option<String>,
        rotation: Option<String>,
    },
    Merge {
        inputs: Vec<String>,
        output: String,
    },
    Frames {
        input: String,
        output_dir: String,
        start: Option<String>,
        duration: Option<String>,
        fps: Option<String>,
        format: String,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskMetrics {
    pub percent: f64,
    pub frame: Option<String>,
    pub out_time: Option<String>,
    pub speed: Option<String>,
    pub output_size: Option<String>,
    pub preview_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub id: String,
    pub kind: TaskKind,
    pub state: TaskState,
    pub title: String,
    pub output: Option<String>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub metrics: TaskMetrics,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    pub summary: TaskSummary,
    pub request: TaskRequest,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RetryOutputPolicy {
    UseOriginal,
    UseNumberedFallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TaskEvent {
    TaskCreated {
        task_id: String,
        kind: TaskKind,
        request: TaskRequest,
        created_at: DateTime<Utc>,
    },
    TaskStarted {
        task_id: String,
        started_at: DateTime<Utc>,
    },
    TaskProgress {
        task_id: String,
        metrics: TaskMetrics,
        updated_at: DateTime<Utc>,
    },
    TaskPreviewUpdated {
        task_id: String,
        preview_path: String,
        updated_at: DateTime<Utc>,
    },
    TaskCompleted {
        task_id: String,
        completed_at: DateTime<Utc>,
    },
    TaskFailed {
        task_id: String,
        error: String,
        failed_at: DateTime<Utc>,
    },
    TaskCancelled {
        task_id: String,
        cancelled_at: DateTime<Utc>,
    },
    TaskInterrupted {
        task_id: String,
        interrupted_at: DateTime<Utc>,
    },
}
