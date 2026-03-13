import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

// 模块级缓存：页面切换时保留文件列表和输出路径
const cache: { files: string[]; output: string } = { files: [], output: "" };

/**
 * 渲染视频合并页面
 */
export function renderMerge(container: HTMLElement) {
  container.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">视频合并</h1>

    <div class="card bg-base-200/80 shadow-md mb-6">
      <div class="card-body">
        <label class="label">输入文件（按顺序合并）</label>
        <div id="file-list" class="flex flex-col gap-2 mb-2"></div>
        <button id="add-file-btn" class="btn btn-outline w-full">添加视频文件</button>

        <label class="label mt-4">输出文件</label>
        <div class="join w-full">
          <input id="merge-output" type="text" class="input join-item flex-1"
            placeholder="选择保存路径" readonly />
          <button id="merge-output-btn" class="btn join-item">浏览</button>
        </div>

        <button id="merge-btn" class="btn btn-primary mt-6 w-full">开始合并</button>
        <p id="merge-status" class="text-sm mt-2"></p>
        <div id="merge-actions" class="hidden gap-2 mt-3">
          <button id="merge-play-btn" class="btn btn-outline flex-1">播放视频</button>
          <button id="merge-reveal-btn" class="btn btn-outline flex-1">打开输出文件夹</button>
        </div>
      </div>
    </div>

    <div id="merge-info" class="hidden">
      <div class="card bg-base-200/80 shadow-md mb-6">
        <div class="card-body">
          <label class="label">进度</label>
          <div class="flex items-center gap-3">
            <progress id="merge-progress" class="progress progress-primary flex-1" value="0" max="100"></progress>
            <span id="merge-percent" class="text-sm font-mono w-12 text-right">0%</span>
          </div>
        </div>
      </div>

      <div class="card bg-base-200/80 shadow-md">
        <div class="card-body">
          <label class="label">FFmpeg 状态</label>
          <p id="merge-ffmpeg-status" class="font-mono text-sm opacity-70">处理中...</p>
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

  // 恢复缓存
  outputPath.value = cache.output;
  outputPath.addEventListener("input", () => { cache.output = outputPath.value; });

  /** 渲染文件列表 */
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

    // 上移
    fileList.querySelectorAll<HTMLButtonElement>(".move-up").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        if (idx > 0) {
          [cache.files[idx - 1], cache.files[idx]] = [cache.files[idx], cache.files[idx - 1]];
          renderFileList();
        }
      });
    });

    // 下移
    fileList.querySelectorAll<HTMLButtonElement>(".move-down").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        if (idx < cache.files.length - 1) {
          [cache.files[idx], cache.files[idx + 1]] = [cache.files[idx + 1], cache.files[idx]];
          renderFileList();
        }
      });
    });

    // 删除
    fileList.querySelectorAll<HTMLButtonElement>(".remove-file").forEach((btn) => {
      btn.addEventListener("click", () => {
        cache.files.splice(Number(btn.dataset.idx), 1);
        renderFileList();
      });
    });
  }

  renderFileList();

  // 添加文件
  container.querySelector("#add-file-btn")!.addEventListener("click", async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "视频文件", extensions: ["mp4", "mkv", "avi", "mov", "flv", "wmv", "webm", "ts"] }],
    });
    if (selected) {
      const files = Array.isArray(selected) ? selected : [selected];
      cache.files.push(...files.map(String));
      renderFileList();
    }
  });

  // 选择输出路径
  container.querySelector("#merge-output-btn")!.addEventListener("click", async () => {
    const selected = await save({
      filters: [{ name: "视频文件", extensions: ["mp4", "mkv", "avi"] }],
    });
    if (selected) {
      outputPath.value = selected as string;
      cache.output = outputPath.value;
    }
  });

  // 播放输出视频
  container.querySelector("#merge-play-btn")!.addEventListener("click", async () => {
    if (outputPath.value) {
      try {
        await openPath(outputPath.value);
      } catch (e) {
        status.textContent = `播放失败: ${e}`;
        status.className = "text-sm mt-2 text-error";
      }
    }
  });

  // 打开输出文件夹
  container.querySelector("#merge-reveal-btn")!.addEventListener("click", async () => {
    if (outputPath.value) {
      try {
        await revealItemInDir(outputPath.value);
      } catch (e) {
        status.textContent = `打开文件夹失败: ${e}`;
        status.className = "text-sm mt-2 text-error";
      }
    }
  });

  // 监听合并相关事件
  listen<string>("ffmpeg-status", (event) => {
    statusLine.textContent = event.payload;
  });
  listen<number>("ffmpeg-progress", (event) => {
    const pct = Math.round(event.payload);
    progressBar.value = pct;
    percentText.textContent = `${pct}%`;
  });

  // 开始合并
  mergeBtn.addEventListener("click", async () => {
    if (cache.files.length < 2) {
      status.textContent = "请至少添加两个视频文件";
      status.className = "text-sm mt-2 text-warning";
      return;
    }
    if (!outputPath.value) {
      status.textContent = "请选择输出文件路径";
      status.className = "text-sm mt-2 text-warning";
      return;
    }

    mergeActions.classList.add("hidden");
    mergeActions.classList.remove("flex");
    mergeInfo.classList.remove("hidden");
    statusLine.textContent = "处理中...";
    progressBar.value = 0;
    percentText.textContent = "0%";
    mergeBtn.disabled = true;
    mergeBtn.innerHTML = `<span class="loading loading-spinner loading-sm"></span> 合并中...`;
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
      status.textContent = `失败: ${e}`;
      status.className = "text-sm mt-2 text-error";
    } finally {
      mergeBtn.disabled = false;
      mergeBtn.textContent = "开始合并";
    }
  });
}
