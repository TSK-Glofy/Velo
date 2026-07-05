import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { configInvoke } from "./configAccess";
import { applyBackground } from "./main";
import { t, getLang } from "./i18n";

/**
 * Render settings page
 */
export async function renderSettings(container: HTMLElement) {
  const currentFfmpeg = await configInvoke<string | null>("get_ffmpeg_path");
  const currentBg = await configInvoke<string | null>("get_background_image");
  const currentRes = await configInvoke<string | null>("get_default_resolution");
  const currentWinSize = await configInvoke<string | null>("get_window_size");
  const currentOutputDir = await configInvoke<string>("get_default_output_dir");
  const currentCopyMode = await configInvoke<boolean>("get_default_copy_mode");
  const currentSameDir = await configInvoke<boolean>("get_default_same_dir");
  const currentMaxJobs = await configInvoke<number>("get_max_concurrent_jobs");
  const currentLang = getLang();

  container.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">${t("settings.title")}</h1>

    <div class="flex gap-6">
      <!-- Left column: settings -->
      <div class="flex-1 min-w-0">
        <div class="card bg-base-200/80 shadow-md mb-6">
          <div class="card-body">
            <h2 class="card-title text-lg">${t("settings.language")}</h2>
            <select id="lang-select" class="select w-full">
              <option value="zh" ${currentLang === "zh" ? "selected" : ""}>中文</option>
              <option value="en" ${currentLang === "en" ? "selected" : ""}>English</option>
            </select>
            <div id="lang-msg" class="text-sm mt-1"></div>
          </div>
        </div>

        <div class="card bg-base-200/80 shadow-md mb-6">
          <div class="card-body">
            <h2 class="card-title text-lg">${t("settings.ffmpegPath")}</h2>
            <div class="join w-full">
              <input id="ffmpeg-path" type="text" class="input join-item flex-1"
                placeholder="${t("settings.ffmpegPlaceholder")}" readonly value="${currentFfmpeg || ""}" />
              <button id="ffmpeg-browse" class="btn join-item">${t("settings.browse")}</button>
            </div>
            <div id="ffmpeg-msg" class="text-sm mt-1"></div>
          </div>
        </div>

        <div class="card bg-base-200/80 shadow-md mb-6">
          <div class="card-body">
            <h2 class="card-title text-lg">${t("settings.defaultResolution")}</h2>
            <select id="resolution-select" class="select w-full">
              <option value="">${t("settings.resolutionOriginal")}</option>
              <option value="1920x1080">1920x1080 (1080p)</option>
              <option value="1600x900">1600x900</option>
              <option value="1280x720">1280x720 (720p)</option>
              <option value="854x480">854x480 (480p)</option>
              <option value="640x360">640x360 (360p)</option>
            </select>
            <div id="res-msg" class="text-sm mt-1"></div>
          </div>
        </div>

        <div class="card bg-base-200/80 shadow-md mb-6">
          <div class="card-body">
            <h2 class="card-title text-lg">${t("settings.defaultOutputDir")}</h2>
            <div class="join w-full">
              <input id="output-dir-path" type="text" class="input join-item flex-1"
                placeholder="${t("settings.outputDirPlaceholder")}" readonly value="${currentOutputDir || ""}" />
              <button id="output-dir-browse" class="btn join-item">${t("settings.browse")}</button>
            </div>
            <div id="output-dir-msg" class="text-sm mt-1"></div>
          </div>
        </div>

        <div class="card bg-base-200/80 shadow-md mb-6">
          <div class="card-body">
            <h2 class="card-title text-lg">${t("settings.defaultOptions")}</h2>
            <label class="flex items-center gap-2 cursor-pointer">
              <input id="default-copy-mode" type="checkbox" class="checkbox" ${currentCopyMode ? "checked" : ""} />
              <span>${t("settings.copyOnly")}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input id="default-same-dir" type="checkbox" class="checkbox" ${currentSameDir ? "checked" : ""} />
              <span>${t("settings.sameDir")}</span>
            </label>
            <div id="defaults-msg" class="text-sm mt-1"></div>
          </div>
        </div>

        <div class="card bg-base-200/80 shadow-md mb-6">
          <div class="card-body">
            <h2 class="card-title text-lg">${t("settings.maxConcurrentJobs")}</h2>
            <select id="max-jobs-select" class="select w-full">
              <option value="1" ${currentMaxJobs === 1 ? "selected" : ""}>1</option>
              <option value="2" ${currentMaxJobs === 2 ? "selected" : ""}>2</option>
              <option value="3" ${currentMaxJobs === 3 ? "selected" : ""}>3</option>
              <option value="4" ${currentMaxJobs === 4 ? "selected" : ""}>4</option>
            </select>
            <div id="max-jobs-msg" class="text-sm mt-1"></div>
          </div>
        </div>

        <div class="card bg-base-200/80 shadow-md mb-6">
          <div class="card-body">
            <h2 class="card-title text-lg">${t("settings.storage")}</h2>
            <p class="text-sm opacity-70 mb-2">${t("settings.storageHint")}</p>
            <button id="clear-cache-open" class="btn btn-outline w-fit">${t("settings.clearCache")}</button>
          </div>
        </div>

        <dialog id="clear-modal" class="modal">
          <div class="modal-box">
            <h3 class="font-bold text-lg mb-3">${t("settings.clearTitle")}</h3>
            <label class="flex items-center gap-2 cursor-pointer mb-2 opacity-80">
              <input id="clear-all" type="checkbox" class="checkbox checkbox-sm" />
              <span class="font-medium">${t("settings.clearSelectAll")}</span>
            </label>
            <div class="divider my-1"></div>
            <label class="flex items-center justify-between gap-2 cursor-pointer py-1">
              <span class="flex items-center gap-2">
                <input data-clear="logs" type="checkbox" class="checkbox" />
                <span>${t("settings.clearLogs")}</span>
              </span>
              <span data-size="logs" class="text-sm opacity-60 tabular-nums">—</span>
            </label>
            <label class="flex items-center justify-between gap-2 cursor-pointer py-1">
              <span class="flex items-center gap-2">
                <input data-clear="previews" type="checkbox" class="checkbox" />
                <span>${t("settings.clearPreviews")}</span>
              </span>
              <span data-size="previews" class="text-sm opacity-60 tabular-nums">—</span>
            </label>
            <label class="flex items-center justify-between gap-2 cursor-pointer py-1">
              <span class="flex items-center gap-2">
                <input data-clear="images" type="checkbox" class="checkbox" />
                <span>${t("settings.clearImages")}</span>
              </span>
              <span data-size="images" class="text-sm opacity-60 tabular-nums">—</span>
            </label>
            <label class="flex items-center justify-between gap-2 cursor-pointer py-1">
              <span class="flex items-center gap-2">
                <input data-clear="history" type="checkbox" class="checkbox" />
                <span>${t("settings.clearHistory")}</span>
              </span>
              <span data-size="history" class="text-sm opacity-60 tabular-nums">—</span>
            </label>
            <div id="clear-msg" class="text-sm mt-2 min-h-5"></div>
            <div class="modal-action">
              <button id="clear-cancel" class="btn btn-ghost">${t("settings.clearCancel")}</button>
              <button id="clear-confirm" class="btn btn-error">${t("settings.clearConfirm")}</button>
            </div>
          </div>
          <form method="dialog" class="modal-backdrop"><button>close</button></form>
        </dialog>

        <div class="card bg-base-200/80 shadow-md mb-6">
          <div class="card-body">
            <h2 class="card-title text-lg">${t("settings.windowSize")}</h2>
            <select id="winsize-select" class="select w-full">
              <option value="">${t("settings.windowSizeDefault")} (1280x720)</option>
              <option value="1600x900">1600x900</option>
              <option value="1920x1080">1920x1080</option>
            </select>
            <div id="winsize-msg" class="text-sm mt-1"></div>
          </div>
        </div>

        <div class="card bg-base-200/80 shadow-md mb-6">
          <div class="card-body">
            <h2 class="card-title text-lg">${t("settings.customBackground")}</h2>
            <p id="bg-current" class="text-sm opacity-70 mb-2">${t("settings.bgCurrent")}${currentBg || t("settings.bgNotSet")}</p>
            <div class="flex gap-2">
              <button id="bg-browse" class="btn">${t("settings.bgSelect")}</button>
              <button id="bg-pick" class="btn btn-outline">${t("settings.bgPick")}</button>
              <button id="bg-clear" class="btn btn-outline">${t("settings.bgClear")}</button>
            </div>
            <div id="bg-msg" class="text-sm mt-1"></div>
          </div>
        </div>

        <dialog id="bg-modal" class="modal">
          <div class="modal-box max-w-2xl">
            <h3 class="font-bold text-lg mb-3">${t("settings.bgPickerTitle")}</h3>
            <div id="bg-grid" class="bg-thumb-grid"></div>
            <div class="modal-action">
              <button id="bg-modal-close" class="btn">${t("settings.bgClose")}</button>
            </div>
          </div>
          <form method="dialog" class="modal-backdrop"><button>close</button></form>
        </dialog>
      </div>

      <!-- Right column: about -->
      <div class="w-64 shrink-0">
        <div class="card bg-base-200/80 shadow-md">
          <div class="card-body">
            <h2 class="card-title text-lg mb-2">${t("settings.about")}</h2>
            <div class="flex items-center gap-4 mb-4">
              <img src="/icon.png" alt="Velo" class="w-16 h-16 rounded-xl shrink-0" />
              <div>
                <h3 class="text-lg font-bold">Velo</h3>
                <p class="text-sm opacity-70">v0.11.0</p>
                <p class="text-sm opacity-70">TSK-Glofy</p>
              </div>
            </div>
            <a id="github-link" class="btn btn-outline btn-sm w-full gap-2" href="#">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              Github
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

  const ffmpegInput = container.querySelector("#ffmpeg-path") as HTMLInputElement;
  const ffmpegMsg = container.querySelector("#ffmpeg-msg")!;
  const bgMsg = container.querySelector("#bg-msg")!;
  const bgCurrent = container.querySelector("#bg-current")!;
  const resSelect = container.querySelector("#resolution-select") as HTMLSelectElement;
  const resMsg = container.querySelector("#res-msg")!;

  if (currentRes) {
    resSelect.value = currentRes;
  }

  const winSizeSelect = container.querySelector("#winsize-select") as HTMLSelectElement;
  const winSizeMsg = container.querySelector("#winsize-msg")!;

  if (currentWinSize) {
    winSizeSelect.value = currentWinSize;
  }

  // Language switch — save and reload entire app to re-render all pages
  const langSelect = container.querySelector("#lang-select") as HTMLSelectElement;
  const langMsg = container.querySelector("#lang-msg")!;

  langSelect.addEventListener("change", async () => {
    try {
      await invoke("set_language", { lang: langSelect.value });
      langMsg.textContent = t("settings.saved");
      langMsg.className = "text-sm mt-1 text-success";
      // Reload the app to apply new language to all pages
      setTimeout(() => window.location.reload(), 300);
    } catch (e) {
      langMsg.textContent = `${t("settings.saveFailed")}${e}`;
      langMsg.className = "text-sm mt-1 text-error";
    }
  });

  winSizeSelect.addEventListener("change", async () => {
    try {
      await invoke("set_window_size", { size: winSizeSelect.value });
      const sizeStr = winSizeSelect.value || "1280x720";
      const [w, h] = sizeStr.split("x").map(Number);
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(w, h));
      winSizeMsg.textContent = t("settings.saved");
      winSizeMsg.className = "text-sm mt-1 text-success";
    } catch (e) {
      winSizeMsg.textContent = `${t("settings.saveFailed")}${e}`;
      winSizeMsg.className = "text-sm mt-1 text-error";
    }
  });

  const outputDirInput = container.querySelector("#output-dir-path") as HTMLInputElement;
  const outputDirMsg = container.querySelector("#output-dir-msg")!;

  container.querySelector("#output-dir-browse")!.addEventListener("click", async () => {
    const selected = await open({ directory: true });
    if (selected) {
      try {
        await invoke("set_default_output_dir", { dir: selected as string });
        outputDirInput.value = selected as string;
        outputDirMsg.textContent = t("settings.saved");
        outputDirMsg.className = "text-sm mt-1 text-success";
      } catch (e) {
        outputDirMsg.textContent = `${t("settings.saveFailed")}${e}`;
        outputDirMsg.className = "text-sm mt-1 text-error";
      }
    }
  });

  const defaultsMsg = container.querySelector("#defaults-msg")!;
  const defaultCopyCheck = container.querySelector("#default-copy-mode") as HTMLInputElement;
  const defaultSameDirCheck = container.querySelector("#default-same-dir") as HTMLInputElement;

  defaultCopyCheck.addEventListener("change", async () => {
    try {
      await invoke("set_default_copy_mode", { enabled: defaultCopyCheck.checked });
      defaultsMsg.textContent = t("settings.saved");
      defaultsMsg.className = "text-sm mt-1 text-success";
    } catch (e) {
      defaultsMsg.textContent = `${t("settings.saveFailed")}${e}`;
      defaultsMsg.className = "text-sm mt-1 text-error";
    }
  });

  defaultSameDirCheck.addEventListener("change", async () => {
    try {
      await invoke("set_default_same_dir", { enabled: defaultSameDirCheck.checked });
      defaultsMsg.textContent = t("settings.saved");
      defaultsMsg.className = "text-sm mt-1 text-success";
    } catch (e) {
      defaultsMsg.textContent = `${t("settings.saveFailed")}${e}`;
      defaultsMsg.className = "text-sm mt-1 text-error";
    }
  });

  resSelect.addEventListener("change", async () => {
    try {
      await invoke("set_default_resolution", { resolution: resSelect.value });
      resMsg.textContent = t("settings.saved");
      resMsg.className = "text-sm mt-1 text-success";
    } catch (e) {
      resMsg.textContent = `${t("settings.saveFailed")}${e}`;
      resMsg.className = "text-sm mt-1 text-error";
    }
  });

  container.querySelector("#ffmpeg-browse")!.addEventListener("click", async () => {
    const selected = await open({
      filters: [{ name: "FFmpeg", extensions: ["exe"] }],
    });
    if (selected) {
      try {
        await invoke("set_ffmpeg_path", { path: selected as string });
        ffmpegInput.value = selected as string;
        ffmpegMsg.textContent = t("settings.saveSuccess");
        ffmpegMsg.className = "text-sm mt-1 text-success";
      } catch (e) {
        ffmpegMsg.textContent = `${t("settings.saveFailed")}${e}`;
        ffmpegMsg.className = "text-sm mt-1 text-error";
      }
    }
  });

  container.querySelector("#bg-browse")!.addEventListener("click", async () => {
    const selected = await open({
      filters: [{ name: t("common.images"), extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
    });
    if (selected) {
      try {
        const dest = await invoke<string>("import_background_image", { path: selected as string });
        await applyBackground();
        bgCurrent.textContent = `${t("settings.bgCurrent")}${dest}`;
        bgMsg.textContent = t("settings.bgUpdated");
        bgMsg.className = "text-sm mt-1 text-success";
      } catch (e) {
        bgMsg.textContent = `${t("settings.failed")}${e}`;
        bgMsg.className = "text-sm mt-1 text-error";
      }
    }
  });

  container.querySelector("#bg-clear")!.addEventListener("click", async () => {
    try {
      await invoke("clear_background_image");
      document.body.style.backgroundImage = "";
      bgCurrent.textContent = `${t("settings.bgCurrent")}${t("settings.bgNotSet")}`;
      bgMsg.textContent = t("settings.bgCleared");
      bgMsg.className = "text-sm mt-1 text-success";
    } catch (e) {
      bgMsg.textContent = `${t("settings.failed")}${e}`;
      bgMsg.className = "text-sm mt-1 text-error";
    }
  });

  const bgModal = container.querySelector("#bg-modal") as HTMLDialogElement;
  const bgGrid = container.querySelector("#bg-grid") as HTMLElement;
  container.querySelector("#bg-modal-close")!.addEventListener("click", () => {
    bgModal.close();
  });
  container.querySelector("#bg-pick")!.addEventListener("click", async () => {
    try {
      const images = await invoke<string[]>("list_background_images");
      if (images.length === 0) {
        bgGrid.innerHTML = `<div class="col-span-3 text-sm opacity-70">${t("settings.bgEmpty")}</div>`;
      } else {
        bgGrid.innerHTML = images
          .map((path) => {
            const safe = path
              .replace(/&/g, "&amp;")
              .replace(/"/g, "&quot;");
            const name = path.split(/[/\\]/).pop() ?? path;
            return `
              <button type="button" class="bg-thumb" data-path="${safe}">
                <img src="${convertFileSrc(path)}" alt="${safe}" loading="lazy" />
                <span class="bg-thumb-name">${name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>
              </button>
            `;
          })
          .join("");
        bgGrid.querySelectorAll<HTMLButtonElement>("button[data-path]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const target = btn.dataset.path;
            if (!target) return;
            try {
              await invoke("set_background_image", { path: target });
              await applyBackground();
              bgCurrent.textContent = `${t("settings.bgCurrent")}${target}`;
              bgMsg.textContent = t("settings.bgUpdated");
              bgMsg.className = "text-sm mt-1 text-success";
              bgModal.close();
            } catch (e) {
              bgMsg.textContent = `${t("settings.failed")}${e}`;
              bgMsg.className = "text-sm mt-1 text-error";
            }
          });
        });
      }
      bgModal.showModal();
    } catch (e) {
      bgMsg.textContent = `${t("settings.failed")}${e}`;
      bgMsg.className = "text-sm mt-1 text-error";
    }
  });

  const maxJobsSelect = container.querySelector("#max-jobs-select") as HTMLSelectElement;
  const maxJobsMsg = container.querySelector("#max-jobs-msg")!;
  maxJobsSelect.addEventListener("change", async () => {
    try {
      await invoke("set_max_concurrent_jobs", { value: Number(maxJobsSelect.value) });
      maxJobsMsg.textContent = t("settings.saved");
      maxJobsMsg.className = "text-sm mt-1 text-success";
    } catch (e) {
      maxJobsMsg.textContent = `${t("settings.saveFailed")}${e}`;
      maxJobsMsg.className = "text-sm mt-1 text-error";
    }
  });

  container.querySelector("#github-link")!.addEventListener("click", (e) => {
    e.preventDefault();
    openUrl("https://github.com/TSK-Glofy/Velo");
  });

  // === 存储与清理 ===
  type CategoryUsage = { bytes: number; files: number };
  type StorageUsage = {
    task_logs: CategoryUsage;
    previews: CategoryUsage;
    imported_images: CategoryUsage;
    task_history: CategoryUsage;
  };

  const formatBytes = (bytes: number): string => {
    if (bytes <= 0) return t("settings.clearEmpty");
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
  };

  const clearModal = container.querySelector("#clear-modal") as HTMLDialogElement;
  const clearMsg = container.querySelector("#clear-msg")!;
  const clearAll = container.querySelector("#clear-all") as HTMLInputElement;
  const clearChecks = Array.from(
    container.querySelectorAll<HTMLInputElement>("input[data-clear]"),
  );
  const sizeEls: Record<string, HTMLElement> = {
    logs: container.querySelector('[data-size="logs"]')!,
    previews: container.querySelector('[data-size="previews"]')!,
    images: container.querySelector('[data-size="images"]')!,
    history: container.querySelector('[data-size="history"]')!,
  };

  async function refreshStorageUsage() {
    try {
      const usage = await invoke<StorageUsage>("get_storage_usage");
      sizeEls.logs.textContent = formatBytes(usage.task_logs.bytes);
      sizeEls.previews.textContent = formatBytes(usage.previews.bytes);
      sizeEls.images.textContent = formatBytes(usage.imported_images.bytes);
      sizeEls.history.textContent = formatBytes(usage.task_history.bytes);
    } catch {
      // 读取失败时保持占位符，不阻断清理操作
    }
  }

  clearAll.addEventListener("change", () => {
    clearChecks.forEach((c) => (c.checked = clearAll.checked));
  });
  clearChecks.forEach((c) =>
    c.addEventListener("change", () => {
      clearAll.checked = clearChecks.every((x) => x.checked);
    }),
  );

  container.querySelector("#clear-cache-open")!.addEventListener("click", async () => {
    clearMsg.textContent = "";
    clearMsg.className = "text-sm mt-2 min-h-5";
    clearAll.checked = false;
    clearChecks.forEach((c) => (c.checked = false));
    await refreshStorageUsage();
    clearModal.showModal();
  });

  container.querySelector("#clear-cancel")!.addEventListener("click", () => {
    clearModal.close();
  });

  container.querySelector("#clear-confirm")!.addEventListener("click", async () => {
    const selected = clearChecks.filter((c) => c.checked).map((c) => c.dataset.clear!);
    if (selected.length === 0) {
      clearMsg.textContent = t("settings.clearNone");
      clearMsg.className = "text-sm mt-2 min-h-5 text-error";
      return;
    }

    const labels: Record<string, string> = {
      logs: t("settings.clearLogs"),
      previews: t("settings.clearPreviews"),
      images: t("settings.clearImages"),
      history: t("settings.clearHistory"),
    };
    const commands: Record<string, string> = {
      logs: "clear_task_logs",
      previews: "clear_previews",
      images: "clear_imported_images",
      history: "clear_task_history",
    };

    let backgroundCleared = false;
    const failures: string[] = [];
    for (const key of selected) {
      try {
        const res = await invoke(commands[key]);
        if (key === "images" && res && (res as { background_cleared?: boolean }).background_cleared) {
          backgroundCleared = true;
        }
      } catch (e) {
        failures.push(`${t("settings.clearItemFailed").replace("{name}", labels[key])}${e}`);
      }
    }

    if (backgroundCleared) {
      document.body.style.backgroundImage = "";
      const bgCurrentEl = container.querySelector("#bg-current");
      if (bgCurrentEl) {
        bgCurrentEl.textContent = `${t("settings.bgCurrent")}${t("settings.bgNotSet")}`;
      }
    }

    await refreshStorageUsage();
    clearAll.checked = false;
    clearChecks.forEach((c) => (c.checked = false));

    if (failures.length === 0) {
      clearMsg.textContent = t("settings.clearDone");
      clearMsg.className = "text-sm mt-2 min-h-5 text-success";
    } else {
      clearMsg.textContent = failures.join("  ");
      clearMsg.className = "text-sm mt-2 min-h-5 text-error";
    }
  });
}
