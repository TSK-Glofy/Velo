import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  cancelTask,
  getTask,
  listTasks,
  retryTask,
  type TaskState,
  type TaskSummary,
} from "./taskApi";
import { formatMetric, formatTaskDate, statusClass } from "./taskFormat";
import { t } from "./i18n";

let selectedTaskId: string | null = null;
let tasks: TaskSummary[] = [];
let listenersBound = false;

export async function renderTaskList(container: HTMLElement) {
  container.innerHTML = `
    <section class="task-list-shell">
      <aside class="task-list-sidebar">
        <header class="task-list-title">${escapeHtml(t("tasks.title"))}</header>
        <div id="task-cards" class="task-card-list"></div>
      </aside>
      <main id="task-detail" class="task-detail-pane"></main>
    </section>
  `;

  tasks = await listTasks();
  if (selectedTaskId === null || !tasks.some((task) => task.id === selectedTaskId)) {
    selectedTaskId = tasks[0]?.id ?? null;
  }
  renderTaskCards(container);
  renderSelectedTask(container);

  if (!listenersBound) {
    listenersBound = true;
    await listen<TaskSummary>("task-started", (event) => {
      upsertTask(event.payload);
      renderTaskCards(container);
      if (event.payload.id === selectedTaskId) renderSelectedTask(container);
    });
    await listen<TaskSummary>("task-progress", (event) => {
      upsertTask(event.payload);
      renderTaskCards(container);
      if (event.payload.id === selectedTaskId) renderSelectedTask(container);
    });
    await listen<TaskSummary>("task-completed", (event) => {
      upsertTask(event.payload);
      renderTaskCards(container);
      if (event.payload.id === selectedTaskId) renderSelectedTask(container);
    });
    await listen<TaskSummary>("task-failed", (event) => {
      upsertTask(event.payload);
      renderTaskCards(container);
      if (event.payload.id === selectedTaskId) renderSelectedTask(container);
    });
    await listen<{ taskId: string; previewPath: string }>(
      "task-preview-updated",
      (event) => {
        const task = tasks.find((item) => item.id === event.payload.taskId);
        if (task) {
          task.metrics = { ...task.metrics, previewPath: event.payload.previewPath };
        }
        if (event.payload.taskId === selectedTaskId) renderSelectedTask(container);
      },
    );
  }
}

function upsertTask(updated: TaskSummary) {
  const idx = tasks.findIndex((task) => task.id === updated.id);
  if (idx === -1) {
    tasks.unshift(updated);
  } else {
    const previousPreview = tasks[idx].metrics.previewPath;
    tasks[idx] = {
      ...updated,
      metrics: {
        ...updated.metrics,
        previewPath: updated.metrics.previewPath ?? previousPreview ?? null,
      },
    };
  }
}

function renderTaskCards(container: HTMLElement) {
  const list = container.querySelector("#task-cards") as HTMLElement | null;
  if (!list) return;
  if (tasks.length === 0) {
    list.innerHTML = `<div class="text-sm opacity-60">${escapeHtml(t("tasks.empty"))}</div>`;
    return;
  }
  list.innerHTML = tasks
    .map((task) => {
      const baseClass = statusClass(task.state as TaskState);
      const selected = task.id === selectedTaskId ? " task-card-selected" : "";
      return `
        <button type="button" class="${baseClass}${selected}" data-task-id="${escapeAttr(task.id)}">
          <div class="task-card-title">${escapeHtml(task.title)}</div>
          <div class="task-card-meta">${escapeHtml(t(`tasks.state.${task.state}`))} · ${escapeHtml(formatTaskDate(task.createdAt))}</div>
        </button>
      `;
    })
    .join("");
  list.querySelectorAll<HTMLButtonElement>("button[data-task-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedTaskId = btn.dataset.taskId ?? null;
      renderTaskCards(container);
      renderSelectedTask(container);
    });
  });
}

function renderSelectedTask(container: HTMLElement) {
  const detail = container.querySelector("#task-detail") as HTMLElement | null;
  if (!detail) return;
  const task = tasks.find((item) => item.id === selectedTaskId);
  if (!task) {
    detail.innerHTML = `<div class="task-detail-empty">${escapeHtml(t("tasks.noSelection"))}</div>`;
    return;
  }
  const percent = Math.max(0, Math.min(100, task.metrics.percent ?? 0));
  const preview = task.metrics.previewPath
    ? `<img src="${escapeAttr(convertFileSrc(task.metrics.previewPath))}" alt="preview" />`
    : "";
  const canRetry =
    task.state === "failed" ||
    task.state === "cancelled" ||
    task.state === "interrupted";
  const canCancel = task.state === "pending" || task.state === "running";
  const canOpenOutput = task.state === "completed" && task.output;
  const errorBlock = task.error
    ? `<div class="task-detail-error">${escapeHtml(task.error)}</div>`
    : "";

  detail.innerHTML = `
    <div class="task-detail-header">
      <div class="task-detail-title">${escapeHtml(task.title)}</div>
      <div class="task-detail-actions">
        ${canOpenOutput ? `<button type="button" class="btn btn-sm" data-action="open">${escapeHtml(t("tasks.openOutput"))}</button>` : ""}
        ${canOpenOutput ? `<button type="button" class="btn btn-sm" data-action="reveal">${escapeHtml(t("tasks.revealOutput"))}</button>` : ""}
        ${canCancel ? `<button type="button" class="btn btn-sm btn-warning" data-action="cancel">${escapeHtml(t("tasks.cancel"))}</button>` : ""}
        ${canRetry ? `<button type="button" class="btn btn-sm btn-primary" data-action="retry">${escapeHtml(t("tasks.retry"))}</button>` : ""}
      </div>
    </div>
    <progress class="progress progress-primary task-detail-progress" value="${percent.toFixed(1)}" max="100"></progress>
    <div class="task-metrics-grid">
      <div class="task-metric"><span>${escapeHtml(t("tasks.metric.frame"))}</span><strong>${escapeHtml(formatMetric(task.metrics.frame))}</strong></div>
      <div class="task-metric"><span>${escapeHtml(t("tasks.metric.time"))}</span><strong>${escapeHtml(formatMetric(task.metrics.outTime))}</strong></div>
      <div class="task-metric"><span>${escapeHtml(t("tasks.metric.speed"))}</span><strong>${escapeHtml(formatMetric(task.metrics.speed))}</strong></div>
      <div class="task-metric"><span>${escapeHtml(t("tasks.metric.size"))}</span><strong>${escapeHtml(formatMetric(task.metrics.outputSize))}</strong></div>
    </div>
    <div class="task-preview-frame">${preview}</div>
    ${errorBlock}
  `;

  detail.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      if (!task) return;
      try {
        if (action === "retry") {
          let policy: "useOriginal" | "useNumberedFallback" = "useOriginal";
          if (task.output) {
            const exists = await invoke<boolean>("check_file_exists", { path: task.output });
            if (exists) {
              const overwrite = await ask(t("tasks.retryOverwriteMessage"), {
                title: t("tasks.retryOverwriteTitle"),
                kind: "warning",
              });
              policy = overwrite ? "useOriginal" : "useNumberedFallback";
            }
          }
          await retryTask(task.id, policy);
          const refreshed = await getTask(task.id);
          upsertTask(refreshed.summary);
          renderTaskCards(container);
          renderSelectedTask(container);
        } else if (action === "cancel") {
          await cancelTask(task.id);
        } else if (action === "open" && task.output) {
          await openPath(task.output);
        } else if (action === "reveal" && task.output) {
          await revealItemInDir(task.output);
        }
      } catch (err) {
        const msg = action === "retry" ? t("tasks.retryFailed") : t("tasks.cancelFailed");
        alert(`${msg}${err}`);
      }
    });
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
