import { invoke } from "@tauri-apps/api/core";

export type TaskKind = "trim" | "merge" | "frames";
export type TaskState = "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface TaskMetrics {
  percent: number;
  frame?: string | null;
  outTime?: string | null;
  speed?: string | null;
  outputSize?: string | null;
  previewPath?: string | null;
}

export interface TaskSummary {
  id: string;
  kind: TaskKind;
  state: TaskState;
  title: string;
  output?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  metrics: TaskMetrics;
  error?: string | null;
}

export interface TaskDetail {
  summary: TaskSummary;
  request: unknown;
}

export function createTask(request: unknown): Promise<TaskSummary> {
  return invoke<TaskSummary>("create_task", { request });
}

export function listTasks(): Promise<TaskSummary[]> {
  return invoke<TaskSummary[]>("list_tasks");
}

export function getTask(taskId: string): Promise<TaskDetail> {
  return invoke<TaskDetail>("get_task", { taskId });
}

export function retryTask(
  taskId: string,
  outputPolicy: "useOriginal" | "useNumberedFallback",
): Promise<TaskSummary> {
  return invoke<TaskSummary>("retry_task", { taskId, outputPolicy });
}

export function cancelTask(taskId: string): Promise<boolean> {
  return invoke<boolean>("cancel_task", { taskId });
}

export function openTaskListWindow(): Promise<void> {
  window.dispatchEvent(new CustomEvent("velo:open-tasks"));
  return Promise.resolve();
}

export function listInterruptedTasks(): Promise<TaskSummary[]> {
  return invoke<TaskSummary[]>("list_interrupted_tasks");
}

export function retryInterruptedTasks(): Promise<TaskSummary[]> {
  return invoke<TaskSummary[]>("retry_interrupted_tasks");
}

export function getTaskLogTail(taskId: string, lines: number): Promise<string[]> {
  return invoke<string[]>("get_task_log_tail", { taskId, lines });
}
