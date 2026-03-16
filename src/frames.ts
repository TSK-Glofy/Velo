import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { t } from "./i18n";

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
  const actions = container.querySelector("#frames-actions")!;
  const info = container.querySelector("#frames-info")!;
  const statusLine = container.querySelector("#frames-ffmpeg-status")!;
  const progressBar = container.querySelector("#frames-progress") as HTMLProgressElement;
  const percentText = container.querySelector("#frames-percent")!;
  const extractBtn = container.querySelector("#frames-btn") as HTMLButtonElement;

  container.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[id], select[id]").forEach((el) => {
    if (cache[el.id]) el.value = cache[el.id];
    el.addEventListener("input", () => { cache[el.id] = el.value; });
    el.addEventListener("change", () => { cache[el.id] = el.value; });
  });

  container.querySelector("#frames-input-btn")!.addEventListener("click", async () => {
    const selected = await open({
      filters: [{ name: t("common.videoFiles"), extensions: ["mp4", "mkv", "avi", "mov", "flv", "wmv", "webm", "ts"] }],
    });
    if (selected) {
      inputPath.value = selected as string;
      cache[inputPath.id] = inputPath.value;
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

  listen<string>("ffmpeg-status", (event) => {
    statusLine.textContent = event.payload;
  });
  listen<number>("ffmpeg-progress", (event) => {
    const pct = Math.round(event.payload);
    progressBar.value = pct;
    percentText.textContent = `${pct}%`;
  });

  extractBtn.addEventListener("click", async () => {
    const startTime = (container.querySelector("#frames-start") as HTMLInputElement).value;
    const duration = (container.querySelector("#frames-duration") as HTMLInputElement).value;
    const fps = (container.querySelector("#frames-fps") as HTMLSelectElement).value;
    const format = (container.querySelector("#frames-format") as HTMLSelectElement).value;

    if (!inputPath.value || !outputPath.value) {
      status.textContent = t("frames.needInputAndOutput");
      status.className = "text-sm mt-2 text-warning";
      return;
    }

    actions.classList.add("hidden");
    actions.classList.remove("flex");
    info.classList.remove("hidden");
    statusLine.textContent = t("frames.processing");
    progressBar.value = 0;
    percentText.textContent = "0%";
    extractBtn.disabled = true;
    extractBtn.innerHTML = `<span class="loading loading-spinner loading-sm"></span> ${t("frames.extracting")}`;
    status.textContent = "";

    try {
      const result = await invoke<string>("extract_frames", {
        input: inputPath.value,
        outputDir: outputPath.value,
        start: startTime || null,
        duration: duration || null,
        fps: fps || null,
        format,
      });
      status.textContent = result;
      status.className = "text-sm mt-2 text-success";
      actions.classList.remove("hidden");
      actions.classList.add("flex");
    } catch (e) {
      status.textContent = `${t("frames.failed")}${e}`;
      status.className = "text-sm mt-2 text-error";
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = t("frames.start");
    }
  });
}
