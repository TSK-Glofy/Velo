import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { t } from "./i18n";
import { createTask, openTaskListWindow } from "./taskApi";
import { attachTimeNormalizer, hmsToSeconds, isInvalidTimeInput, secondsToHms } from "./timeFormat";
import { createRangeSelector, type RangeSelector } from "./rangeSelector";

// Module-level cache: preserves user input across page switches
const cache: Record<string, string> = {};

/**
 * Render the frame extraction page
 */
export function renderFrames(container: HTMLElement) {
  container.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">${t("frames.title")}</h1>

    <div class="card bg-base-200/80 shadow-md mb-6">
      <div class="card-body gap-4">
        <div>
          <label class="label">${t("frames.inputFile")}</label>
          <div class="join w-full">
            <input id="frames-input" type="text" class="input join-item flex-1"
              placeholder="${t("frames.selectVideo")}" readonly />
            <button id="frames-input-btn" class="btn join-item">${t("frames.browse")}</button>
          </div>
        </div>

        <div id="frames-range"></div>

        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="label">${t("frames.startTime")}</label>
            <input id="frames-start" type="text" class="input w-full" autocomplete="off" placeholder="00:00:00" />
          </div>
          <div>
            <label class="label">${t("frames.duration")}</label>
            <input id="frames-duration" type="text" class="input w-full" autocomplete="off" placeholder="00:00:05" />
          </div>
          <div>
            <label class="label">${t("frames.extractFps")}</label>
            <select id="frames-fps" class="select w-full">
              <option value="">${t("frames.fpsOriginal")}</option>
              <option value="1">1 fps</option>
              <option value="2">2 fps</option>
              <option value="5">5 fps</option>
              <option value="10">10 fps</option>
              <option value="24">24 fps</option>
              <option value="30">30 fps</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="label">${t("frames.outputFormat")}</label>
            <select id="frames-format" class="select w-full">
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
              <option value="bmp">BMP</option>
            </select>
          </div>
          <div>
            <label class="label">${t("frames.outputFolder")}</label>
            <div class="join w-full">
              <input id="frames-output" type="text" class="input join-item flex-1"
                placeholder="${t("frames.selectOutputFolder")}" readonly />
              <button id="frames-output-btn" class="btn join-item">${t("frames.browse")}</button>
            </div>
          </div>
        </div>

        <button id="frames-btn" class="btn btn-primary w-full">${t("frames.start")}</button>
        <p id="frames-status" class="text-sm mt-2"></p>
        <div id="frames-actions" class="hidden gap-2 mt-3">
          <button id="frames-reveal-btn" class="btn btn-outline flex-1">${t("frames.openFolder")}</button>
        </div>
      </div>
    </div>

    <div id="frames-info" class="hidden">
      <div class="card bg-base-200/80 shadow-md mb-6">
        <div class="card-body">
          <label class="label">${t("frames.progress")}</label>
          <div class="flex items-center gap-3">
            <progress id="frames-progress" class="progress progress-primary flex-1" value="0" max="100"></progress>
            <span id="frames-percent" class="text-sm font-mono w-12 text-right">0%</span>
          </div>
        </div>
      </div>

      <div class="card bg-base-200/80 shadow-md">
        <div class="card-body">
          <label class="label">${t("frames.ffmpegStatus")}</label>
          <p id="frames-ffmpeg-status" class="font-mono text-sm opacity-70">${t("frames.processing")}</p>
        </div>
      </div>
    </div>
  `;

  const inputPath = container.querySelector("#frames-input") as HTMLInputElement;
  const outputPath = container.querySelector("#frames-output") as HTMLInputElement;
  const status = container.querySelector("#frames-status")!;
  const extractBtn = container.querySelector("#frames-btn") as HTMLButtonElement;

  container.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[id], select[id]").forEach((el) => {
    if (cache[el.id]) el.value = cache[el.id];
    el.addEventListener("input", () => { cache[el.id] = el.value; });
    el.addEventListener("change", () => { cache[el.id] = el.value; });
  });

  const startInput = container.querySelector("#frames-start") as HTMLInputElement;
  const durationInput = container.querySelector("#frames-duration") as HTMLInputElement;
  attachTimeNormalizer(startInput, cache);
  attachTimeNormalizer(durationInput, cache);

  // --- drag-to-select range with live frame preview ---
  const rangeHost = container.querySelector("#frames-range") as HTMLElement;
  let rangeSelector: RangeSelector | null = null;

  function syncInputsFromRange(startSec: number, endSec: number) {
    startInput.value = secondsToHms(startSec);
    durationInput.value = secondsToHms(endSec - startSec);
    startInput.classList.remove("input-error");
    durationInput.classList.remove("input-error");
    cache[startInput.id] = startInput.value;
    cache[durationInput.id] = durationInput.value;
  }

  function syncRangeFromInputs() {
    if (!rangeSelector) return;
    const startSec = startInput.value.trim() ? hmsToSeconds(startInput.value) : 0;
    if (startSec === null) return;
    const durSec = durationInput.value.trim() ? hmsToSeconds(durationInput.value) : null;
    rangeSelector.setRange(startSec, durSec === null ? Number.POSITIVE_INFINITY : startSec + durSec);
  }

  function rebuildRangeSelector() {
    rangeSelector?.destroy();
    rangeSelector = null;
    if (!inputPath.value) return;
    rangeSelector = createRangeSelector({
      host: rangeHost,
      inputPath: inputPath.value,
      onRangeChange: syncInputsFromRange,
    });
    syncRangeFromInputs();
  }

  startInput.addEventListener("blur", syncRangeFromInputs);
  durationInput.addEventListener("blur", syncRangeFromInputs);
  if (inputPath.value) {
    rebuildRangeSelector();
  }

  container.querySelector("#frames-input-btn")!.addEventListener("click", async () => {
    const selected = await open({
      filters: [{ name: t("common.videoFiles"), extensions: ["mp4", "mkv", "avi", "mov", "flv", "wmv", "webm", "ts"] }],
    });
    if (selected) {
      inputPath.value = selected as string;
      cache[inputPath.id] = inputPath.value;
      rebuildRangeSelector();
    }
  });

  container.querySelector("#frames-output-btn")!.addEventListener("click", async () => {
    const selected = await open({ directory: true });
    if (selected) {
      outputPath.value = selected as string;
      cache[outputPath.id] = outputPath.value;
    }
  });

  container.querySelector("#frames-reveal-btn")!.addEventListener("click", async () => {
    if (outputPath.value) {
      try {
        await revealItemInDir(outputPath.value);
      } catch (e) {
        status.textContent = `${t("frames.openFolderFailed")}${e}`;
        status.className = "text-sm mt-2 text-error";
      }
    }
  });

  extractBtn.addEventListener("click", async () => {
    const startEl = container.querySelector("#frames-start") as HTMLInputElement;
    const durationEl = container.querySelector("#frames-duration") as HTMLInputElement;
    const startTime = startEl.value;
    const duration = durationEl.value;
    const fps = (container.querySelector("#frames-fps") as HTMLSelectElement).value;
    const format = (container.querySelector("#frames-format") as HTMLSelectElement).value;

    if (!inputPath.value || !outputPath.value) {
      status.textContent = t("frames.needInputAndOutput");
      status.className = "text-sm mt-2 text-warning";
      return;
    }

    for (const el of [startEl, durationEl]) {
      if (isInvalidTimeInput(el)) {
        el.classList.add("input-error");
        status.textContent = t("trim.invalidTime");
        status.className = "text-sm mt-2 text-warning";
        return;
      }
    }

    try {
      const summary = await createTask({
        kind: "frames",
        input: inputPath.value,
        outputDir: outputPath.value,
        start: startTime || null,
        duration: duration || null,
        fps: fps || null,
        format,
      });
      await openTaskListWindow(summary.id);
      status.textContent = "";
    } catch (e) {
      status.textContent = `${t("frames.failed")}${e}`;
      status.className = "text-sm mt-2 text-error";
    }
  });
}
