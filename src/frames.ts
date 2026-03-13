import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

// 模块级缓存：页面切换时保留用户输入
const cache: Record<string, string> = {};

/**
 * 渲染逐帧提取页面
 */
export function renderFrames(container: HTMLElement) {
  container.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">逐帧提取</h1>

    <div class="card bg-base-200/80 shadow-md mb-6">
      <div class="card-body">
        <label class="label">输入文件</label>
        <div class="join w-full">
          <input id="frames-input" type="text" class="input join-item flex-1"
            placeholder="选择视频文件" readonly />
          <button id="frames-input-btn" class="btn join-item">浏览</button>
        </div>

        <div class="grid grid-cols-3 gap-4 mt-4">
          <div>
            <label class="label" for="frames-start">起始时间 (-ss)</label>
            <input id="frames-start" type="text" class="input w-full" placeholder="00:00:00" />
          </div>
          <div>
            <label class="label" for="frames-duration">持续时间 (-t)</label>
            <input id="frames-duration" type="text" class="input w-full" placeholder="00:00:05" />
          </div>
          <div>
            <label class="label" for="frames-fps">提取帧率</label>
            <select id="frames-fps" class="select w-full">
              <option value="">原始（全部帧）</option>
              <option value="1">1 fps</option>
              <option value="2">2 fps</option>
              <option value="5">5 fps</option>
              <option value="10">10 fps</option>
              <option value="24">24 fps</option>
              <option value="30">30 fps</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label class="label" for="frames-format">输出格式</label>
            <select id="frames-format" class="select w-full">
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
              <option value="bmp">BMP</option>
            </select>
          </div>
          <div>
            <label class="label">输出文件夹</label>
            <div class="join w-full">
              <input id="frames-output" type="text" class="input join-item flex-1"
                placeholder="选择输出文件夹" readonly />
              <button id="frames-output-btn" class="btn join-item">浏览</button>
            </div>
          </div>
        </div>

        <button id="frames-btn" class="btn btn-primary mt-6 w-full">开始提取</button>
        <p id="frames-status" class="text-sm mt-2"></p>
        <div id="frames-actions" class="hidden gap-2 mt-3">
          <button id="frames-reveal-btn" class="btn btn-outline flex-1">打开输出文件夹</button>
        </div>
      </div>
    </div>

    <div id="frames-info" class="hidden">
      <div class="card bg-base-200/80 shadow-md mb-6">
        <div class="card-body">
          <label class="label">进度</label>
          <div class="flex items-center gap-3">
            <progress id="frames-progress" class="progress progress-primary flex-1" value="0" max="100"></progress>
            <span id="frames-percent" class="text-sm font-mono w-12 text-right">0%</span>
          </div>
        </div>
      </div>

      <div class="card bg-base-200/80 shadow-md">
        <div class="card-body">
          <label class="label">FFmpeg 状态</label>
          <p id="frames-ffmpeg-status" class="font-mono text-sm opacity-70">处理中...</p>
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

  // 自动恢复缓存
  container.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[id], select[id]").forEach((el) => {
    if (cache[el.id]) el.value = cache[el.id];
    el.addEventListener("input", () => { cache[el.id] = el.value; });
    el.addEventListener("change", () => { cache[el.id] = el.value; });
  });

  // 选择输入文件
  container.querySelector("#frames-input-btn")!.addEventListener("click", async () => {
    const selected = await open({
      filters: [{ name: "视频文件", extensions: ["mp4", "mkv", "avi", "mov", "flv", "wmv", "webm", "ts"] }],
    });
    if (selected) {
      inputPath.value = selected as string;
      cache[inputPath.id] = inputPath.value;
    }
  });

  // 选择输出文件夹
  container.querySelector("#frames-output-btn")!.addEventListener("click", async () => {
    const selected = await open({ directory: true });
    if (selected) {
      outputPath.value = selected as string;
      cache[outputPath.id] = outputPath.value;
    }
  });

  // 打开输出文件夹
  container.querySelector("#frames-reveal-btn")!.addEventListener("click", async () => {
    if (outputPath.value) {
      try {
        await revealItemInDir(outputPath.value);
      } catch (e) {
        status.textContent = `打开文件夹失败: ${e}`;
        status.className = "text-sm mt-2 text-error";
      }
    }
  });

  // 监听事件
  listen<string>("ffmpeg-status", (event) => {
    statusLine.textContent = event.payload;
  });
  listen<number>("ffmpeg-progress", (event) => {
    const pct = Math.round(event.payload);
    progressBar.value = pct;
    percentText.textContent = `${pct}%`;
  });

  // 开始提取
  extractBtn.addEventListener("click", async () => {
    const startTime = (container.querySelector("#frames-start") as HTMLInputElement).value;
    const duration = (container.querySelector("#frames-duration") as HTMLInputElement).value;
    const fps = (container.querySelector("#frames-fps") as HTMLSelectElement).value;
    const format = (container.querySelector("#frames-format") as HTMLSelectElement).value;

    if (!inputPath.value || !outputPath.value) {
      status.textContent = "请选择输入文件和输出文件夹";
      status.className = "text-sm mt-2 text-warning";
      return;
    }

    actions.classList.add("hidden");
    actions.classList.remove("flex");
    info.classList.remove("hidden");
    statusLine.textContent = "处理中...";
    progressBar.value = 0;
    percentText.textContent = "0%";
    extractBtn.disabled = true;
    extractBtn.innerHTML = `<span class="loading loading-spinner loading-sm"></span> 提取中...`;
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
      status.textContent = `失败: ${e}`;
      status.className = "text-sm mt-2 text-error";
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = "开始提取";
    }
  });
}
