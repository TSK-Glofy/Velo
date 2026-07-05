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
import { attachTimeNormalizer, isInvalidTimeInput } from "./timeFormat";

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
  return { dir, name, sep };
}

/**
 * Render the video-to-GIF page
 */
export async function renderGif(container: HTMLElement) {
  container.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">${t("gif.title")}</h1>

    <div class="card bg-base-200/80 shadow-md mb-6">
      <div class="card-body gap-4">
        <div>
          <label class="label">${t("gif.inputFile")}</label>
          <div class="join w-full">
            <input id="gif-input" type="text" class="input join-item flex-1"
              placeholder="${t("gif.selectVideo")}" readonly />
            <button id="gif-input-btn" class="btn join-item">${t("gif.browse")}</button>
          </div>
        </div>

        <div class="grid grid-cols-4 gap-4">
          <div>
            <label class="label">${t("gif.startTime")}</label>
            <input id="gif-start" type="text" class="input w-full" autocomplete="off" placeholder="00:00:00" />
          </div>
          <div>
            <label class="label">${t("gif.duration")}</label>
            <input id="gif-duration" type="text" class="input w-full" autocomplete="off" placeholder="00:00:05" />
          </div>
          <div>
            <label class="label">${t("gif.fps")}</label>
            <select id="gif-fps" class="select w-full">
              <option value="5">5 fps</option>
              <option value="10" selected>10 fps</option>
              <option value="15">15 fps</option>
              <option value="20">20 fps</option>
              <option value="25">25 fps</option>
            </select>
          </div>
          <div>
            <label class="label">${t("gif.width")}</label>
            <select id="gif-width" class="select w-full">
              <option value="">${t("gif.widthOriginal")}</option>
              <option value="320">320 px</option>
              <option value="480" selected>480 px</option>
              <option value="640">640 px</option>
              <option value="800">800 px</option>
            </select>
          </div>
        </div>

        <div>
          <label class="label">${t("gif.outputName")}</label>
          <input id="gif-output-name" type="text" class="input w-full" placeholder="video.gif" />
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input id="gif-same-dir" type="checkbox" class="checkbox checkbox-sm" />
          <span>${t("gif.sameDir")}</span>
        </label>

        <button id="gif-btn" class="btn btn-primary mt-2 w-full">${t("gif.start")}</button>
        <p id="gif-status" class="text-sm mt-2"></p>
        <div id="gif-actions" class="hidden gap-2 mt-3">
          <button id="gif-play-btn" class="btn btn-outline flex-1">${t("gif.playGif")}</button>
          <button id="gif-reveal-btn" class="btn btn-outline flex-1">${t("gif.openFolder")}</button>
        </div>
      </div>
    </div>
  `;

  const inputPath = container.querySelector("#gif-input") as HTMLInputElement;
  const startTime = container.querySelector("#gif-start") as HTMLInputElement;
  const duration = container.querySelector("#gif-duration") as HTMLInputElement;
  const fps = container.querySelector("#gif-fps") as HTMLSelectElement;
  const width = container.querySelector("#gif-width") as HTMLSelectElement;
  const outputName = container.querySelector("#gif-output-name") as HTMLInputElement;
  const sameDirCheck = container.querySelector("#gif-same-dir") as HTMLInputElement;
  const gifBtn = container.querySelector("#gif-btn") as HTMLButtonElement;
  const status = container.querySelector("#gif-status")!;

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

  attachTimeNormalizer(startTime, cache);
  attachTimeNormalizer(duration, cache);

  function updatePlaceholder() {
    if (inputPath.value) {
      const { name } = parsePath(inputPath.value);
      outputName.placeholder = `${name}.gif`;
    } else {
      outputName.placeholder = "video.gif";
    }
  }

  outputName.addEventListener("blur", () => {
    const raw = outputName.value.trim();
    if (!raw) return;
    if (!/\.gif$/i.test(raw)) {
      outputName.value = `${raw}.gif`;
      cache[outputName.id] = outputName.value;
    }
  });

  if (!cache["gif-same-dir"]) {
    const defaultSameDir = await configInvoke<boolean>("get_default_same_dir");
    sameDirCheck.checked = defaultSameDir;
  }
  updatePlaceholder();

  /** Compute final output path based on current mode */
  async function getOutputPath(): Promise<string> {
    const raw = outputName.value || outputName.placeholder;
    const filename = /\.gif$/i.test(raw) ? raw : `${raw}.gif`;
    if (sameDirCheck.checked && inputPath.value) {
      const { dir, sep } = parsePath(inputPath.value);
      return `${dir}${sep}${filename}`;
    }
    const defaultDir = await configInvoke<string>("get_default_output_dir");
    const dir = defaultDir || ".";
    const sep = dir.includes("\\") ? "\\" : "/";
    return `${dir}${sep}${filename}`;
  }

  container.querySelector("#gif-play-btn")!.addEventListener("click", async () => {
    try {
      const out = await getOutputPath();
      if (out) {
        await openPath(out);
      }
    } catch (e) {
      status.textContent = `${t("gif.playFailed")}${e}`;
      status.className = "text-sm mt-2 text-error";
    }
  });

  container.querySelector("#gif-reveal-btn")!.addEventListener("click", async () => {
    try {
      const out = await getOutputPath();
      if (out) {
        await revealItemInDir(out);
      }
    } catch (e) {
      status.textContent = `${t("gif.openFolderFailed")}${e}`;
      status.className = "text-sm mt-2 text-error";
    }
  });

  container.querySelector("#gif-input-btn")!.addEventListener("click", async () => {
    const selected = await open({
      filters: [{ name: t("common.videoFiles"), extensions: ["mp4", "mkv", "avi", "mov", "flv", "wmv", "webm", "ts"] }],
    });
    if (selected) {
      inputPath.value = selected as string;
      cache[inputPath.id] = inputPath.value;
      updatePlaceholder();
    }
  });

  gifBtn.addEventListener("click", async () => {
    try {
      const finalOutput = await getOutputPath();

      if (!inputPath.value || !finalOutput) {
        status.textContent = t("gif.fillAllFields");
        status.className = "text-sm mt-2 text-warning";
        return;
      }

      for (const el of [startTime, duration]) {
        if (isInvalidTimeInput(el)) {
          el.classList.add("input-error");
          status.textContent = t("trim.invalidTime");
          status.className = "text-sm mt-2 text-warning";
          return;
        }
      }

      const exists = await invoke<boolean>("check_file_exists", { path: finalOutput });
      if (exists) {
        const displayName = outputName.value || outputName.placeholder;
        const overwrite = await ask(t("gif.fileExistsMsg").replace("{name}", displayName), {
          title: t("gif.fileExists"),
          kind: "warning",
        });
        if (!overwrite) return;
      }

      const summary = await createTask({
        kind: "gif",
        input: inputPath.value,
        output: finalOutput,
        start: startTime.value,
        duration: duration.value,
        fps: fps.value || null,
        width: width.value || null,
      });
      await openTaskListWindow(summary.id);
      status.textContent = "";
    } catch (e) {
      const message = isConfigAccessError(e)
        ? `${configErrorMessage(e)} ${errorDetail(e)}`
        : `${t("gif.failed")}${e}`;
      status.textContent = message;
      status.className = "text-sm mt-2 text-error";
    }
  });
}
