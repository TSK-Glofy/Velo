import { invoke } from "@tauri-apps/api/core";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  configErrorMessage,
  configInvoke,
  errorDetail,
  isConfigAccessError,
} from "./configAccess";
import { t } from "./i18n";
import { createTask, openTaskListWindow } from "./taskApi";

// Module-level cache: preserves user input across page switches
const cache: Record<string, string> = {};

/** Extract directory, filename (without extension), and extension from a full path */
function parsePath(fullPath: string) {
  const sep = fullPath.includes("\\") ? "\\" : "/";
  const lastSep = fullPath.lastIndexOf(sep);
  const dir = lastSep >= 0 ? fullPath.substring(0, lastSep) : "";
  const filename = lastSep >= 0 ? fullPath.substring(lastSep + 1) : fullPath;
  const dotIdx = filename.lastIndexOf(".");
  const name = dotIdx >= 0 ? filename.substring(0, dotIdx) : filename;
  const ext = dotIdx >= 0 ? filename.substring(dotIdx) : "";
  return { dir, name, ext, sep };
}

/**
 * Render the video trim page
 */
export async function renderHome(container: HTMLElement) {
  container.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">${t("trim.title")}</h1>

    <div class="card bg-base-200/80 shadow-md mb-6">
      <div class="card-body gap-4">
        <div>
          <label class="label">${t("trim.inputFile")}</label>
          <div class="join w-full">
            <input id="input-path" type="text" class="input join-item flex-1"
              placeholder="${t("trim.selectVideo")}" readonly />
            <button id="input-btn" class="btn join-item">${t("trim.browse")}</button>
          </div>
        </div>

        <div class="grid grid-cols-4 gap-4">
          <div>
            <label class="label">${t("trim.startTime")}</label>
            <input id="start-time" type="text" class="input w-full" autocomplete="off" placeholder="00:00:00" />
          </div>
          <div>
            <label class="label">${t("trim.duration")}</label>
            <input id="duration" type="text" class="input w-full" autocomplete="off" placeholder="00:00:10" />
          </div>
          <div>
            <label class="label">${t("trim.framerate")}</label>
            <select id="framerate" class="select w-full">
              <option value="">${t("trim.framerateOriginal")}</option>
              <option value="15">15</option>
              <option value="24">24</option>
              <option value="30">30</option>
              <option value="60">60</option>
              <option value="120">120</option>
            </select>
          </div>
          <div>
            <label class="label">${t("trim.rotation")}</label>
            <select id="rotation" class="select w-full">
              <option value="">${t("trim.rotationNone")}</option>
              <option value="left">${t("trim.rotationLeft")}</option>
              <option value="right">${t("trim.rotationRight")}</option>
              <option value="180">${t("trim.rotation180")}</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="label">${t("trim.outputName")}</label>
            <input id="output-name" type="text" class="input w-full"
              placeholder="video-new.mp4" />
          </div>
          <div>
            <label class="label">${t("trim.outputFormat")}</label>
            <select id="output-format" class="select w-full">
              <option value="">${t("trim.formatSame")}</option>
              <option value="mp4">MP4 (.mp4)</option>
              <option value="mkv">MKV (.mkv)</option>
              <option value="avi">AVI (.avi)</option>
              <option value="mov">MOV (.mov)</option>
              <option value="webm">WebM (.webm)</option>
              <option value="flv">FLV (.flv)</option>
              <option value="ts">MPEG-TS (.ts)</option>
            </select>
          </div>
          <div>
            <label class="label">${t("trim.codec")}</label>
            <label class="flex items-center gap-2 h-12 cursor-pointer">
              <input id="copy-mode" type="checkbox" class="checkbox" />
              <span class="text-sm">${t("trim.copyOnly")}</span>
            </label>
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input id="same-dir" type="checkbox" class="checkbox checkbox-sm" />
          <span>${t("trim.sameDir")}</span>
        </label>

        <button id="trim-btn" class="btn btn-primary mt-2 w-full">${t("trim.start")}</button>
        <p id="trim-status" class="text-sm mt-2"></p>
        <div id="trim-actions" class="hidden gap-2 mt-3">
          <button id="play-btn" class="btn btn-outline flex-1">${t("trim.playVideo")}</button>
          <button id="reveal-btn" class="btn btn-outline flex-1">${t("trim.openFolder")}</button>
        </div>
      </div>
    </div>

    <div id="trim-info" class="hidden">
      <div class="card bg-base-200/80 shadow-md mb-6">
        <div class="card-body">
          <label class="label">${t("trim.progress")}</label>
          <div class="flex items-center gap-3">
            <progress id="trim-progress" class="progress progress-primary flex-1" value="0" max="100"></progress>
            <span id="trim-percent" class="text-sm font-mono w-12 text-right">0%</span>
          </div>
        </div>
      </div>

      <div class="card bg-base-200/80 shadow-md">
        <div class="card-body">
          <label class="label">${t("trim.ffmpegStatus")}</label>
          <p id="ffmpeg-status" class="font-mono text-sm opacity-70">${t("trim.processing")}</p>
        </div>
      </div>
    </div>
  `;

  const inputPath = container.querySelector("#input-path") as HTMLInputElement;
  const outputName = container.querySelector("#output-name") as HTMLInputElement;
  const sameDirCheck = container.querySelector("#same-dir") as HTMLInputElement;
  const startTime = container.querySelector("#start-time") as HTMLInputElement;
  const duration = container.querySelector("#duration") as HTMLInputElement;
  const framerate = container.querySelector("#framerate") as HTMLSelectElement;
  const outputFormat = container.querySelector("#output-format") as HTMLSelectElement;
  const copyMode = container.querySelector("#copy-mode") as HTMLInputElement;
  const rotation = container.querySelector("#rotation") as HTMLSelectElement;
  const trimBtn = container.querySelector("#trim-btn") as HTMLButtonElement;
  const status = container.querySelector("#trim-status")!;
  const playBtn = container.querySelector("#play-btn")!;
  const revealBtn = container.querySelector("#reveal-btn")!;

  // Auto-restore cached input/select values
  container.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[id], select[id]").forEach((el) => {
    if (cache[el.id]) {
      if (el.type === "checkbox") {
        (el as HTMLInputElement).checked = cache[el.id] === "true";
      } else {
        el.value = cache[el.id];
      }
    }
    el.addEventListener("input", () => {
      cache[el.id] = el.type === "checkbox" ? String((el as HTMLInputElement).checked) : el.value;
    });
    el.addEventListener("change", () => {
      cache[el.id] = el.type === "checkbox" ? String((el as HTMLInputElement).checked) : el.value;
    });
  });

  /** Determine output extension based on format selection */
  function getOutputExt(): string {
    if (outputFormat.value) {
      return `.${outputFormat.value}`;
    }
    if (inputPath.value) {
      return parsePath(inputPath.value).ext;
    }
    return ".mp4";
  }

  function updatePlaceholder() {
    const ext = getOutputExt();
    if (inputPath.value) {
      const { name } = parsePath(inputPath.value);
      outputName.placeholder = `${name}-new${ext}`;
    } else {
      outputName.placeholder = `video-new${ext}`;
    }
  }

  function toggleCopyMode() {
    if (copyMode.checked) {
      outputFormat.disabled = true;
      outputFormat.value = "";
      cache[outputFormat.id] = "";
      outputFormat.classList.add("opacity-50");
    } else {
      outputFormat.disabled = false;
      outputFormat.classList.remove("opacity-50");
    }
  }

  copyMode.addEventListener("change", () => {
    toggleCopyMode();
    updatePlaceholder();
  });
  outputFormat.addEventListener("change", () => {
    updatePlaceholder();
  });

  // Load defaults from settings (cache takes priority)
  if (!cache["copy-mode"]) {
    const defaultCopy = await configInvoke<boolean>("get_default_copy_mode");
    copyMode.checked = defaultCopy;
  }
  if (!cache["same-dir"]) {
    const defaultSameDir = await configInvoke<boolean>("get_default_same_dir");
    sameDirCheck.checked = defaultSameDir;
  }

  toggleCopyMode();
  updatePlaceholder();

  /** Compute final output path based on current mode */
  async function getOutputPath(): Promise<string> {
    const raw = outputName.value || outputName.placeholder;
    const ext = getOutputExt();
    const hasExt = /\.[A-Za-z0-9]{1,5}$/.test(raw);
    const filename = hasExt ? raw : `${raw}${ext}`;
    if (sameDirCheck.checked && inputPath.value) {
      const { dir, sep } = parsePath(inputPath.value);
      return `${dir}${sep}${filename}`;
    }
    const defaultDir = await configInvoke<string>("get_default_output_dir");
    const dir = defaultDir || ".";
    const sep = dir.includes("\\") ? "\\" : "/";
    return `${dir}${sep}${filename}`;
  }

  playBtn.addEventListener("click", async () => {
    try {
      const out = await getOutputPath();
      if (out) {
        await openPath(out);
      }
    } catch (e) {
      const message = isConfigAccessError(e)
        ? `${configErrorMessage(e)} ${errorDetail(e)}`
        : `${t("trim.playFailed")}${e}`;
      status.textContent = message;
      status.className = "text-sm mt-2 text-error";
    }
  });

  revealBtn.addEventListener("click", async () => {
    try {
      const out = await getOutputPath();
      if (out) {
        await revealItemInDir(out);
      }
    } catch (e) {
      const message = isConfigAccessError(e)
        ? `${configErrorMessage(e)} ${errorDetail(e)}`
        : `${t("trim.openFolderFailed")}${e}`;
      status.textContent = message;
      status.className = "text-sm mt-2 text-error";
    }
  });

  container.querySelector("#input-btn")!.addEventListener("click", async () => {
    const selected = await open({
      filters: [{ name: t("common.videoFiles"), extensions: ["mp4", "mkv", "avi", "mov", "flv", "wmv", "webm"] }],
    });
    if (selected) {
      inputPath.value = selected as string;
      cache[inputPath.id] = inputPath.value;
      updatePlaceholder();
    }
  });

  trimBtn.addEventListener("click", async () => {
    try {
      const finalOutput = await getOutputPath();

      if (!inputPath.value || !finalOutput) {
        status.textContent = t("trim.fillAllFields");
        status.className = "text-sm mt-2 text-warning";
        return;
      }

      const exists = await invoke<boolean>("check_file_exists", { path: finalOutput });
      if (exists) {
        const displayName = outputName.value || outputName.placeholder;
        const overwrite = await ask(t("trim.fileExistsMsg").replace("{name}", displayName), {
          title: t("trim.fileExists"),
          kind: "warning",
        });
        if (!overwrite) return;
      }

      const resolution = await configInvoke<string | null>("get_default_resolution");
      await createTask({
        kind: "trim",
        input: inputPath.value,
        output: finalOutput,
        start: startTime.value,
        duration: duration.value,
        resolution: resolution || null,
        framerate: framerate.value || null,
        codecMode: copyMode.checked ? "copy" : "reencode",
        rotation: rotation.value || null,
      });
      await openTaskListWindow();
      status.textContent = t("tasks.created");
      status.className = "text-sm mt-2 text-success";
    } catch (e) {
      const message = isConfigAccessError(e)
        ? `${configErrorMessage(e)} ${errorDetail(e)}`
        : `${t("trim.failed")}${e}`;
      status.textContent = message;
      status.className = "text-sm mt-2 text-error";
    }
  });
}
