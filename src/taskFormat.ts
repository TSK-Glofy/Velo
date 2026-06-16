export type TaskState = "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export function formatTaskDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function displayTaskId(_taskId: string): string {
  return "";
}

export function statusClass(state: TaskState): string {
  return `task-card task-card-${state}`;
}

export function formatMetric(value?: string | number | null): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}
