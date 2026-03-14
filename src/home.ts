import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

// 模块级缓存：页面切换时保留用户输入，关闭程序自动释放
const cache: Record<string, string> = {};

/** 从完整路径中提取目录、文件名（不含扩展名）、扩展名 */
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
 * 渲染主页：视频截取界面
 */
export async function renderHome(container: HTMLElement) {
  container.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">视频截取</h1>

    <div class="card bg-base-200/80 shadow-md mb-6">
      <div class="card-body gap-4">
        <div>
          <label class="label">输入文件</label>
          <div class="join w-full">
            <input id="input-path" type="text" class="input join-item flex-1"
              placeholder="选择视频文件" readonly />
            <button id="input-btn" class="btn join-item">浏览</button>
          </div>
        </div>

        <div class="grid grid-cols-4 gap-4">
          <div>
            <label class="label">起始时间 (-ss)</label>
            <input id="start-time" type="text" class="input w-full" autocomplete="off" placeholder="00:00:00" />
          </div>
          <div>
            <label class="label">持续时间 (-t)</label>
            <input id="duration" type="text" class="input w-full" autocomplete="off" placeholder="00:00:10" />
          </div>
          <div>
            <label class="label">帧率 (-r)</label>
            <select id="framerate" class="select w-full">
              <option value="">原始</option>
              <option value="15">15</option>
              <option value="24">24</option>
              <option value="30">30</option>
              <option value="60">60</option>
              <option value="120">120</option>
            </select>
          </div>
          <div>
            <label class="label">旋转</label>
            <select id="rotation" class="select w-full">
              <option value="">不旋转</option>
              <option value="left">向左 90°</option>
              <option value="right">向右 90°</option>
              <option value="180">180°</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="label">输出文件名</label>
            <input id="output-name" type="text" class="input w-full"
              placeholder="video-new.mp4" />
          </div>
          <div>
            <label class="label">输出格式</label>
            <select id="output-format" class="select w-full">
              <option value="">与源文件相同</option>
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
            <label class="label">编码</label>
            <label class="flex items-center gap-2 h-12 cursor-pointer">
              <input id="copy-mode" type="checkbox" class="checkbox" />
              <span class="text-sm">仅复制（不重新编码）</span>
            </label>
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input id="same-dir" type="checkbox" class="checkbox checkbox-sm" />
          <span>输出到原目录（否则使用默认输出文件夹）</span>
        </label>

        <button id="trim-btn" class="btn btn-primary mt-2 w-full">开始截取</button>
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
  const trimInfo = container.querySelector("#trim-info")!;
  const statusLine = container.querySelector("#ffmpeg-status")!;
  const progressBar = container.querySelector("#trim-progress") as HTMLProgressElement;
  const percentText = container.querySelector("#trim-percent")!;
  const trimActions = container.querySelector("#trim-actions")!;
  const playBtn = container.querySelector("#play-btn")!;
  const revealBtn = container.querySelector("#reveal-btn")!;

  // 自动恢复所有 input/select 的缓存值，并监听变化同步缓存
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

  /** 根据输出格式选择确定扩展名 */
  function getOutputExt(): string {
    if (outputFormat.value) {
      return `.${outputFormat.value}`;
    }
    if (inputPath.value) {
      return parsePath(inputPath.value).ext;
    }
    return ".mp4";
  }

  // 更新 placeholder 提示文字
  function updatePlaceholder() {
    const ext = getOutputExt();
    if (inputPath.value) {
      const { name } = parsePath(inputPath.value);
      outputName.placeholder = `${name}-new${ext}`;
    } else {
      outputName.placeholder = `video-new${ext}`;
    }
  }

  // 切换「仅复制」勾选框：勾选时禁用输出格式（灰色不可选）
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

  // 首次加载时从设置读取默认值（缓存优先）
  if (!cache["copy-mode"]) {
    const defaultCopy = await invoke<boolean>("get_default_copy_mode");
    copyMode.checked = defaultCopy;
  }
  if (!cache["same-dir"]) {
    const defaultSameDir = await invoke<boolean>("get_default_same_dir");
    sameDirCheck.checked = defaultSameDir;
  }

  // 恢复缓存后立即同步 UI 状态
  toggleCopyMode();
  updatePlaceholder();

  /** 根据当前模式计算最终输出路径 */
  async function getOutputPath(): Promise<string> {
    const filename = outputName.value || outputName.placeholder;
    if (sameDirCheck.checked && inputPath.value) {
      const { dir, sep } = parsePath(inputPath.value);
      return `${dir}${sep}${filename}`;
    }
    // 使用默认输出文件夹
    const defaultDir = await invoke<string | null>("get_default_output_dir");
    const dir = defaultDir || ".";
    const sep = dir.includes("\\") ? "\\" : "/";
    return `${dir}${sep}${filename}`;
  }

  // 播放输出视频
  playBtn.addEventListener("click", async () => {
    const out = await getOutputPath();
    if (out) {
      try {
        await openPath(out);
      } catch (e) {
        status.textContent = `播放失败: ${e}`;
        status.className = "text-sm mt-2 text-error";
      }
    }
  });

  // 在文件管理器中显示输出文件
  revealBtn.addEventListener("click", async () => {
    const out = await getOutputPath();
    if (out) {
      try {
        await revealItemInDir(out);
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
      updatePlaceholder();
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

  // 开始截取
  trimBtn.addEventListener("click", async () => {
    const finalOutput = await getOutputPath();

    if (!inputPath.value || !finalOutput || !startTime.value || !duration.value) {
      status.textContent = "请填写所有字段";
      status.className = "text-sm mt-2 text-warning";
      return;
    }


    // 检查文件是否已存在
    const exists = await invoke<boolean>("check_file_exists", { path: finalOutput });
    if (exists) {
      const overwrite = await ask(`文件 "${outputName.value || finalOutput}" 已存在，是否覆盖？`, {
        title: "文件已存在",
        kind: "warning",
      });
      if (!overwrite) return;
    }

    trimActions.classList.add("hidden");
    trimActions.classList.remove("flex");
    trimInfo.classList.remove("hidden");
    statusLine.textContent = "处理中...";
    progressBar.value = 0;
    percentText.textContent = "0%";
    trimBtn.disabled = true;
    sameDirCheck.disabled = true;
    trimBtn.innerHTML = `<span class="loading loading-spinner loading-sm"></span> 截取中...`;
    status.textContent = "";

    try {
      // 读取设置中的默认分辨率
      const resolution = await invoke<string | null>("get_default_resolution");
      const result = await invoke<string>("trim_video", {
        input: inputPath.value,
        output: finalOutput,
        start: startTime.value,
        duration: duration.value,
        resolution: resolution || null,
        framerate: framerate.value || null,
        codecMode: copyMode.checked ? "copy" : "reencode",
        rotation: rotation.value || null,
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
      sameDirCheck.disabled = false;
      trimBtn.textContent = "开始截取";
    }
  });
}
