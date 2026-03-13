import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

// 模块级缓存：页面切换时保留用户输入，关闭程序自动释放
const cache: Record<string, string> = {};

/**
 * 渲染主页：视频裁剪界面
 */
export function renderHome(container: HTMLElement) {
  container.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">视频裁剪</h1>

    <div class="card bg-base-200/80 shadow-md mb-6">
      <div class="card-body">
        <label class="label">输入文件</label>
        <div class="join w-full">
          <input id="input-path" type="text" class="input join-item flex-1"
            placeholder="选择视频文件" readonly />
          <button id="input-btn" class="btn join-item">浏览</button>
        </div>

        <div class="grid grid-cols-3 gap-4 mt-4">
          <div>
            <label class="label" for="start-time">起始时间 (-ss)</label>
            <input id="start-time" type="text" class="input w-full" placeholder="00:00:00" />
          </div>
          <div>
            <label class="label" for="duration">持续时间 (-t)</label>
            <input id="duration" type="text" class="input w-full" placeholder="00:00:10" />
          </div>
          <div>
            <label class="label" for="framerate">帧率 (-r)</label>
            <select id="framerate" class="select w-full">
              <option value="">原始</option>
              <option value="15">15</option>
              <option value="24">24</option>
              <option value="30">30</option>
              <option value="60">60</option>
              <option value="120">120</option>
            </select>
          </div>
        </div>

        <label class="label mt-4">输出文件</label>
        <div class="join w-full">
          <input id="output-path" type="text" class="input join-item flex-1"
            placeholder="选择保存路径" readonly />
          <button id="output-btn" class="btn join-item">浏览</button>
        </div>

        <button id="trim-btn" class="btn btn-primary mt-6 w-full">开始裁剪</button>
        <p id="trim-status" class="text-sm mt-2"></p>
        <div id="trim-actions" class="hidden gap-2 mt-3">
          <button id="play-btn" class="btn btn-outline flex-1">播放视频</button>
          <button id="reveal-btn" class="btn btn-outline flex-1">打开输出文件夹</button>
        </div>
      </div>
    </div>

    <div id="trim-info" class="hidden">
      <div class="card bg-base-200/80 shadow-md mb-6">
        <div class="card-body">
          <label class="label">进度</label>
          <div class="flex items-center gap-3">
            <progress id="trim-progress" class="progress progress-primary flex-1" value="0" max="100"></progress>
            <span id="trim-percent" class="text-sm font-mono w-12 text-right">0%</span>
          </div>
        </div>
      </div>

      <div class="card bg-base-200/80 shadow-md">
        <div class="card-body">
          <label class="label">FFmpeg 状态</label>
          <p id="ffmpeg-status" class="font-mono text-sm opacity-70">处理中...</p>
        </div>
      </div>
    </div>
  `;

  const inputPath = container.querySelector("#input-path") as HTMLInputElement;
  const outputPath = container.querySelector("#output-path") as HTMLInputElement;
  const startTime = container.querySelector("#start-time") as HTMLInputElement;
  const duration = container.querySelector("#duration") as HTMLInputElement;
  const framerate = container.querySelector("#framerate") as HTMLSelectElement;
  const trimBtn = container.querySelector("#trim-btn") as HTMLButtonElement;
  const status = container.querySelector("#trim-status")!;
  const trimInfo = container.querySelector("#trim-info")!;
  const statusLine = container.querySelector("#ffmpeg-status")!;
  const progressBar = container.querySelector("#trim-progress") as HTMLProgressElement;
  const percentText = container.querySelector("#trim-percent")!;
  const trimActions = container.querySelector("#trim-actions")!;
  const playBtn = container.querySelector("#play-btn")!;
  const revealBtn = container.querySelector("#reveal-btn")!;

  // 自动恢复所有 input/select 的缓存值，并监听变化同步缓存
  container.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[id], select[id]").forEach((el) => {
    if (cache[el.id]) el.value = cache[el.id];
    el.addEventListener("input", () => { cache[el.id] = el.value; });
    el.addEventListener("change", () => { cache[el.id] = el.value; });
  });

  // 播放输出视频
  playBtn.addEventListener("click", async () => {
    if (outputPath.value) {
      try {
        await openPath(outputPath.value);
      } catch (e) {
        status.textContent = `播放失败: ${e}`;
        status.className = "text-sm mt-2 text-error";
      }
    }
  });

  // 在文件管理器中显示输出文件
  revealBtn.addEventListener("click", async () => {
    if (outputPath.value) {
      try {
        await revealItemInDir(outputPath.value);
      } catch (e) {
        status.textContent = `打开文件夹失败: ${e}`;
        status.className = "text-sm mt-2 text-error";
      }
    }
  });

  // 选择输入视频文件
  container.querySelector("#input-btn")!.addEventListener("click", async () => {
    const selected = await open({
      filters: [{ name: "视频文件", extensions: ["mp4", "mkv", "avi", "mov", "flv", "wmv", "webm"] }],
    });
    if (selected) {
      inputPath.value = selected as string;
      cache[inputPath.id] = inputPath.value;
    }
  });

  // 选择输出保存路径
  container.querySelector("#output-btn")!.addEventListener("click", async () => {
    const selected = await save({
      filters: [{ name: "视频文件", extensions: ["mp4", "mkv", "avi"] }],
    });
    if (selected) {
      outputPath.value = selected as string;
      cache[outputPath.id] = outputPath.value;
    }
  });

  // 监听 ffmpeg 状态摘要（实时覆盖，只显示最新一行）
  listen<string>("ffmpeg-status", (event) => {
    statusLine.textContent = event.payload;
  });

  // 监听进度百分比事件
  listen<number>("ffmpeg-progress", (event) => {
    const pct = Math.round(event.payload);
    progressBar.value = pct;
    percentText.textContent = `${pct}%`;
  });

  // 开始裁剪
  trimBtn.addEventListener("click", async () => {
    if (!inputPath.value || !outputPath.value || !startTime.value || !duration.value) {
      status.textContent = "请填写所有字段";
      status.className = "text-sm mt-2 text-warning";
      return;
    }

    trimActions.classList.add("hidden");
    trimActions.classList.remove("flex");
    trimInfo.classList.remove("hidden");
    statusLine.textContent = "处理中...";
    progressBar.value = 0;
    percentText.textContent = "0%";
    trimBtn.disabled = true;
    trimBtn.innerHTML = `<span class="loading loading-spinner loading-sm"></span> 裁剪中...`;
    status.textContent = "";

    try {
      // 读取设置中的默认分辨率
      const resolution = await invoke<string | null>("get_default_resolution");
      const result = await invoke<string>("trim_video", {
        input: inputPath.value,
        output: outputPath.value,
        start: startTime.value,
        duration: duration.value,
        resolution: resolution || null,
        framerate: framerate.value || null,
      });
      status.textContent = result;
      status.className = "text-sm mt-2 text-success";
      trimActions.classList.remove("hidden");
      trimActions.classList.add("flex");
    } catch (e) {
      status.textContent = `失败: ${e}`;
      status.className = "text-sm mt-2 text-error";
    } finally {
      trimBtn.disabled = false;
      trimBtn.textContent = "开始裁剪";
    }
  });
}
