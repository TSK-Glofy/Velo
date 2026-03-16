import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { t } from "./i18n";

// Module-level cache: preserves file list and output path across page switches
const cache: { files: string[]; output: string } = { files: [], output: "" };

/**
 * Render the video merge page
 */
export function renderMerge(container: HTMLElement) {
  container.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">${t("merge.title")}</h1>

    <div class="card bg-base-200/80 shadow-md mb-6">
      <div class="card-body gap-4">
        <div>
          <label class="label">${t("merge.inputFiles")}</label>
          <div id="file-list" class="flex flex-col gap-2 mb-2"></div>
          <button id="add-file-btn" class="btn btn-outline w-full">${t("merge.addFiles")}</button>
        </div>

        <div>
          <label class="label">${t("merge.outputFile")}</label>
          <div class="join w-full">
            <input id="merge-output" type="text" class="input join-item flex-1"
              placeholder="${t("merge.selectSavePath")}" readonly />
            <button id="merge-output-btn" class="btn join-item">${t("merge.browse")}</button>
          </div>
        </div>

        <button id="merge-btn" class="btn btn-primary w-full">${t("merge.start")}</button>
        <p id="merge-status" class="text-sm mt-2"></p>
        <div id="merge-actions" class="hidden gap-2 mt-3">
          <button id="merge-play-btn" class="btn btn-outline flex-1">${t("merge.playVideo")}</button>
          <button id="merge-reveal-btn" class="btn btn-outline flex-1">${t("merge.openFolder")}</button>
        </div>
      </div>
    </div>

    <div id="merge-info" class="hidden">
      <div class="card bg-base-200/80 shadow-md mb-6">
        <div class="card-body">
          <label class="label">${t("merge.progress")}</label>
          <div class="flex items-center gap-3">
            <progress id="merge-progress" class="progress progress-primary flex-1" value="0" max="100"></progress>
            <span id="merge-percent" class="text-sm font-mono w-12 text-right">0%</span>
          </div>
        </div>
      </div>

      <div class="card bg-base-200/80 shadow-md">
        <div class="card-body">
          <label class="label">${t("merge.ffmpegStatus")}</label>
          <p id="merge-ffmpeg-status" class="font-mono text-sm opacity-70">${t("merge.processing")}</p>
        </div>
      </div>
    </div>
  `;

  const fileList = container.querySelector("#file-list")!;
  const outputPath = container.querySelector("#merge-output") as HTMLInputElement;
  const mergeBtn = container.querySelector("#merge-btn") as HTMLButtonElement;
  const status = container.querySelector("#merge-status")!;
  const mergeActions = container.querySelector("#merge-actions")!;
  const mergeInfo = container.querySelector("#merge-info")!;
  const statusLine = container.querySelector("#merge-ffmpeg-status")!;
  const progressBar = container.querySelector("#merge-progress") as HTMLProgressElement;
  const percentText = container.querySelector("#merge-percent")!;

  outputPath.value = cache.output;
  outputPath.addEventListener("input", () => { cache.output = outputPath.value; });

  function renderFileList() {
    fileList.innerHTML = cache.files.map((f, i) => `
      <div class="flex items-center gap-2">
        <span class="badge badge-sm">${i + 1}</span>
        <span class="text-sm flex-1 truncate" title="${f}">${f.split(/[/\\]/).pop()}</span>
        <button class="btn btn-ghost btn-xs move-up" data-idx="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn btn-ghost btn-xs move-down" data-idx="${i}" ${i === cache.files.length - 1 ? "disabled" : ""}>↓</button>
        <button class="btn btn-ghost btn-xs text-error remove-file" data-idx="${i}">×</button>
      </div>
    `).join("");

    fileList.querySelectorAll<HTMLButtonElement>(".move-up").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        if (idx > 0) {
          [cache.files[idx - 1], cache.files[idx]] = [cache.files[idx], cache.files[idx - 1]];
          renderFileList();
        }
      });
    });

    fileList.querySelectorAll<HTMLButtonElement>(".move-down").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        if (idx < cache.files.length - 1) {
          [cache.files[idx], cache.files[idx + 1]] = [cache.files[idx + 1], cache.files[idx]];
          renderFileList();
        }
      });
    });

    fileList.querySelectorAll<HTMLButtonElement>(".remove-file").forEach((btn) => {
      btn.addEventListener("click", () => {
        cache.files.splice(Number(btn.dataset.idx), 1);
        renderFileList();
      });
    });
  }

  renderFileList();

  container.querySelector("#add-file-btn")!.addEventListener("click", async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: t("common.videoFiles"), extensions: ["mp4", "mkv", "avi", "mov", "flv", "wmv", "webm", "ts"] }],
    });
    if (selected) {
      const files = Array.isArray(selected) ? selected : [selected];
      cache.files.push(...files.map(String));
      renderFileList();
    }
  });

  container.querySelector("#merge-output-btn")!.addEventListener("click", async () => {
    const selected = await save({
      filters: [{ name: t("common.videoFiles"), extensions: ["mp4", "mkv", "avi"] }],
    });
    if (selected) {
      outputPath.value = selected as string;
      cache.output = outputPath.value;
    }
  });

  container.querySelector("#merge-play-btn")!.addEventListener("click", async () => {
    if (outputPath.value) {
      try {
        await openPath(outputPath.value);
      } catch (e) {
        status.textContent = `${t("merge.playFailed")}${e}`;
        status.className = "text-sm mt-2 text-error";
      }
    }
  });

  container.querySelector("#merge-reveal-btn")!.addEventListener("click", async () => {
    if (outputPath.value) {
      try {
        await revealItemInDir(outputPath.value);
      } catch (e) {
        status.textContent = `${t("merge.openFolderFailed")}${e}`;
        status.className = "text-sm mt-2 text-error";
      }
    }
  });

  listen<string>("ffmpeg-status", (event) => {
    statusLine.textContent = event.payload;
  });
  listen<number>("ffmpeg-progress", (event) => {
    const pct = Math.round(event.payload);
    progressBar.value = pct;
    percentText.textContent = `${pct}%`;
  });

  mergeBtn.addEventListener("click", async () => {
    if (cache.files.length < 2) {
      status.textContent = t("merge.needTwoFiles");
      status.className = "text-sm mt-2 text-warning";
      return;
    }
    if (!outputPath.value) {
      status.textContent = t("merge.needOutputPath");
      status.className = "text-sm mt-2 text-warning";
      return;
    }

    mergeActions.classList.add("hidden");
    mergeActions.classList.remove("flex");
    mergeInfo.classList.remove("hidden");
    statusLine.textContent = t("merge.processing");
    progressBar.value = 0;
    percentText.textContent = "0%";
    mergeBtn.disabled = true;
    mergeBtn.innerHTML = `<span class="loading loading-spinner loading-sm"></span> ${t("merge.merging")}`;
    status.textContent = "";

    try {
      const result = await invoke<string>("merge_videos", {
        inputs: cache.files,
        output: outputPath.value,
      });
      status.textContent = result;
      status.className = "text-sm mt-2 text-success";
      mergeActions.classList.remove("hidden");
      mergeActions.classList.add("flex");
    } catch (e) {
      status.textContent = `${t("merge.failed")}${e}`;
      status.className = "text-sm mt-2 text-error";
    } finally {
      mergeBtn.disabled = false;
      mergeBtn.textContent = t("merge.start");
    }
  });
}
