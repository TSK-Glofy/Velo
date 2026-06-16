import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  cancelTask,
  deleteTask,
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
let renderedStructureKey: string | null = null;
let pendingFocusTaskId: string | null = null;
const previewVersions = new Map<string, number>();

export function focusTaskOnNextRender(taskId: string) {
  pendingFocusTaskId = taskId;
}

function structureKey(task: TaskSummary): string {
  return `${task.id}|${task.state}|${task.error ? "e" : "n"}|${task.output ?? ""}`;
}

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
  if (pendingFocusTaskId && tasks.some((task) => task.id === pendingFocusTaskId)) {
    selectedTaskId = pendingFocusTaskId;
    pendingFocusTaskId = null;
  } else if (selectedTaskId === null || !tasks.some((task) => task.id === selectedTaskId)) {
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
    await listen<TaskSummary>("task-cancelled", (event) => {
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
        previewVersions.set(
          event.payload.taskId,
          (previewVersions.get(event.payload.taskId) ?? 0) + 1,
        );
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
      const canDelete = task.state !== "running" && task.state !== "pending";
      const deleteBtn = canDelete
        ? `<span class="task-card-delete" role="button" tabindex="0" data-delete-id="${escapeAttr(task.id)}" title="${escapeAttr(t("tasks.delete"))}">×</span>`
        : "";
      return `
        <div class="${baseClass}${selected}" role="button" tabindex="0" data-task-id="${escapeAttr(task.id)}">
          <div class="task-card-title">${escapeHtml(task.title)}</div>
          <div class="task-card-meta">${escapeHtml(t(`tasks.state.${task.state}`))} · ${escapeHtml(formatTaskDate(task.createdAt))}</div>
          ${deleteBtn}
        </div>
      `;
    })
    .join("");
  list.querySelectorAll<HTMLElement>("[data-task-id]").forEach((card) => {
    card.addEventListener("click", () => {
      selectedTaskId = card.dataset.taskId ?? null;
      renderTaskCards(container);
      renderSelectedTask(container);
    });
  });
  list.querySelectorAll<HTMLElement>("[data-delete-id]").forEach((del) => {
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = del.dataset.deleteId;
      if (!id) return;
      try {
        await deleteTask(id);
        tasks = tasks.filter((t) => t.id !== id);
        previewVersions.delete(id);
        if (selectedTaskId === id) {
          selectedTaskId = tasks[0]?.id ?? null;
          renderedStructureKey = null;
        }
        renderTaskCards(container);
        renderSelectedTask(container);
      } catch (err) {
        alert(`${t("tasks.deleteFailed")}${err}`);
      }
    });
  });
}

function renderSelectedTask(container: HTMLElement) {
  const detail = container.querySelector("#task-detail") as HTMLElement | null;
  if (!detail) return;
  const task = tasks.find((item) => item.id === selectedTaskId);
  if (!task) {
    if (renderedStructureKey !== null) {
      detail.innerHTML = `<div class="task-detail-empty">${escapeHtml(t("tasks.noSelection"))}</div>`;
      renderedStructureKey = null;
    }
    return;
  }
  const key = structureKey(task);
  if (renderedStructureKey !== key) {
    buildDetailScaffold(detail, task);
    bindDetailActions(detail, task, container);
    renderedStructureKey = key;
  }
  patchDetailValues(detail, task);
}

function buildDetailScaffold(detail: HTMLElement, task: TaskSummary) {
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
    <progress class="progress progress-primary task-detail-progress" value="0" max="100"></progress>
    <div class="task-metrics-grid">
      <div class="task-metric"><span>${escapeHtml(t("tasks.metric.frame"))}</span><strong data-metric="frame">-</strong></div>
      <div class="task-metric"><span>${escapeHtml(t("tasks.metric.time"))}</span><strong data-metric="time">-</strong></div>
      <div class="task-metric"><span>${escapeHtml(t("tasks.metric.speed"))}</span><strong data-metric="speed">-</strong></div>
      <div class="task-metric"><span>${escapeHtml(t("tasks.metric.size"))}</span><strong data-metric="size">-</strong></div>
    </div>
    <div class="task-preview-frame"></div>
    ${errorBlock}
  `;
}

function bindDetailActions(detail: HTMLElement, task: TaskSummary, container: HTMLElement) {
  detail.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
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

function patchDetailValues(detail: HTMLElement, task: TaskSummary) {
  const percent = Math.max(0, Math.min(100, task.metrics.percent ?? 0));
  const progress = detail.querySelector<HTMLProgressElement>(".task-detail-progress");
  if (progress) progress.value = percent;

  const setMetric = (name: string, value: string) => {
    const el = detail.querySelector<HTMLElement>(`strong[data-metric="${name}"]`);
    if (el && el.textContent !== value) el.textContent = value;
  };
  setMetric("frame", formatMetric(task.metrics.frame));
  setMetric("time", formatMetric(task.metrics.outTime));
  setMetric("speed", formatMetric(task.metrics.speed));
  setMetric("size", formatMetric(task.metrics.outputSize));

  const previewFrame = detail.querySelector(".task-preview-frame");
  if (previewFrame) {
    let img = previewFrame.querySelector<HTMLImageElement>("img");
    if (task.metrics.previewPath) {
      const version = previewVersions.get(task.id) ?? 0;
      const nextSrc = `${convertFileSrc(task.metrics.previewPath)}?v=${version}`;
      if (!img) {
        img = document.createElement("img");
        img.alt = "preview";
        img.src = nextSrc;
        previewFrame.appendChild(img);
      } else if (img.getAttribute("src") !== nextSrc) {
        img.src = nextSrc;
      }
    } else if (img) {
      img.remove();
    }
  }
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
