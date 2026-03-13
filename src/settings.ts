import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { applyBackground } from "./main";

/**
 * 渲染设置页面：FFmpeg 路径 + 背景图设置
 */
export async function renderSettings(container: HTMLElement) {
  // 读取当前配置显示在输入框中
  const currentFfmpeg = await invoke<string | null>("get_ffmpeg_path");
  const currentBg = await invoke<string | null>("get_background_image");
  const currentRes = await invoke<string | null>("get_default_resolution");
  const currentWinSize = await invoke<string | null>("get_window_size");

  container.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">设置</h1>

    <div class="flex gap-6">
      <!-- 左栏：设置项 -->
      <div class="flex-1 min-w-0">
        <div class="card bg-base-200/80 shadow-md mb-6">
          <div class="card-body">
            <h2 class="card-title text-lg">FFmpeg 路径</h2>
            <div class="join w-full">
              <input id="ffmpeg-path" type="text" class="input join-item flex-1"
                placeholder="ffmpeg.exe 路径" readonly value="${currentFfmpeg || ""}" />
              <button id="ffmpeg-browse" class="btn join-item">浏览</button>
            </div>
            <div id="ffmpeg-msg" class="text-sm mt-1"></div>
          </div>
        </div>

        <div class="card bg-base-200/80 shadow-md mb-6">
          <div class="card-body">
            <h2 class="card-title text-lg">自定义背景</h2>
            <p id="bg-current" class="text-sm opacity-70 mb-2">当前: ${currentBg || "未设置"}</p>
            <div class="flex gap-2">
              <button id="bg-browse" class="btn">选择图片</button>
              <button id="bg-clear" class="btn btn-outline">清除背景</button>
            </div>
            <div id="bg-msg" class="text-sm mt-1"></div>
          </div>
        </div>

        <div class="card bg-base-200/80 shadow-md mb-6">
          <div class="card-body">
            <h2 class="card-title text-lg">默认输出分辨率</h2>
            <p class="text-sm opacity-70 mb-2">裁剪时默认使用的分辨率，选择"原始"则不缩放</p>
            <select id="resolution-select" class="select w-full">
              <option value="">原始（不缩放）</option>
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
            <h2 class="card-title text-lg">窗口尺寸</h2>
            <p class="text-sm opacity-70 mb-2">选择窗口大小，切换后立即生效</p>
            <select id="winsize-select" class="select w-full">
              <option value="">默认 (800x600)</option>
              <option value="1600x900">1600x900</option>
              <option value="1280x720">1280x720</option>
              <option value="1024x768">1024x768</option>
              <option value="800x600">800x600</option>
            </select>
            <div id="winsize-msg" class="text-sm mt-1"></div>
          </div>
        </div>
      </div>

      <!-- 右栏：关于 -->
      <div class="w-64 shrink-0">
        <div class="card bg-base-200/80 shadow-md">
          <div class="card-body">
            <h2 class="card-title text-lg mb-2">关于</h2>
            <div class="flex items-center gap-4 mb-4">
              <img src="/icon.png" alt="Velo" class="w-16 h-16 rounded-xl shrink-0" />
              <div>
                <h3 class="text-lg font-bold">Velo</h3>
                <p class="text-sm opacity-70">v0.7.0</p>
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

  // 设置当前分辨率选中状态
  if (currentRes) {
    resSelect.value = currentRes;
  }

  // 窗口尺寸相关
  const winSizeSelect = container.querySelector("#winsize-select") as HTMLSelectElement;
  const winSizeMsg = container.querySelector("#winsize-msg")!;

  if (currentWinSize) {
    winSizeSelect.value = currentWinSize;
  }

  winSizeSelect.addEventListener("change", async () => {
    try {
      await invoke("set_window_size", { size: winSizeSelect.value });
      // 立即调整窗口大小
      const sizeStr = winSizeSelect.value || "800x600";
      const [w, h] = sizeStr.split("x").map(Number);
      const win = getCurrentWindow();
      await win.setSize(new LogicalSize(w, h));
      winSizeMsg.textContent = "已保存";
      winSizeMsg.className = "text-sm mt-1 text-success";
    } catch (e) {
      winSizeMsg.textContent = `保存失败: ${e}`;
      winSizeMsg.className = "text-sm mt-1 text-error";
    }
  });

  // 分辨率变更时自动保存
  resSelect.addEventListener("change", async () => {
    try {
      await invoke("set_default_resolution", { resolution: resSelect.value });
      resMsg.textContent = "已保存";
      resMsg.className = "text-sm mt-1 text-success";
    } catch (e) {
      resMsg.textContent = `保存失败: ${e}`;
      resMsg.className = "text-sm mt-1 text-error";
    }
  });

  // 浏览选择 ffmpeg
  container.querySelector("#ffmpeg-browse")!.addEventListener("click", async () => {
    const selected = await open({
      filters: [{ name: "FFmpeg", extensions: ["exe"] }],
    });
    if (selected) {
      try {
        await invoke("set_ffmpeg_path", { path: selected as string });
        ffmpegInput.value = selected as string;
        ffmpegMsg.textContent = "保存成功";
        ffmpegMsg.className = "text-sm mt-1 text-success";
      } catch (e) {
        ffmpegMsg.textContent = `保存失败: ${e}`;
        ffmpegMsg.className = "text-sm mt-1 text-error";
      }
    }
  });

  // 浏览选择背景图
  container.querySelector("#bg-browse")!.addEventListener("click", async () => {
    const selected = await open({
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
    });
    if (selected) {
      try {
        await invoke("set_background_image", { path: selected as string });
        await applyBackground();
        bgCurrent.textContent = `当前: ${selected}`;
        bgMsg.textContent = "背景已更新";
        bgMsg.className = "text-sm mt-1 text-success";
      } catch (e) {
        bgMsg.textContent = `失败: ${e}`;
        bgMsg.className = "text-sm mt-1 text-error";
      }
    }
  });

  // 清除背景图
  container.querySelector("#bg-clear")!.addEventListener("click", async () => {
    try {
      // 保存空路径来清除
      document.body.style.backgroundImage = "";
      bgCurrent.textContent = "当前: 未设置";
      bgMsg.textContent = "背景已清除";
      bgMsg.className = "text-sm mt-1 text-success";
    } catch (e) {
      bgMsg.textContent = `失败: ${e}`;
      bgMsg.className = "text-sm mt-1 text-error";
    }
  });

  // Github 链接
  container.querySelector("#github-link")!.addEventListener("click", (e) => {
    e.preventDefault();
    openUrl("https://github.com/TSK-Glofy/Velo");
  });
}
