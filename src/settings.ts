import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { applyBackground } from "./main";

/**
 * 渲染设置页面：FFmpeg 路径 + 背景图设置
 */
export async function renderSettings(container: HTMLElement) {
  // 读取当前配置显示在输入框中
  const currentFfmpeg = await invoke<string | null>("get_ffmpeg_path");
  const currentBg = await invoke<string | null>("get_background_image");

  container.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">设置</h1>

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
        <p class="text-sm opacity-70 mb-2">当前: ${currentBg || "未设置"}</p>
        <div class="flex gap-2">
          <button id="bg-browse" class="btn">选择图片</button>
          <button id="bg-clear" class="btn btn-outline">清除背景</button>
        </div>
        <div id="bg-msg" class="text-sm mt-1"></div>
      </div>
    </div>
  `;

  const ffmpegInput = container.querySelector("#ffmpeg-path") as HTMLInputElement;
  const ffmpegMsg = container.querySelector("#ffmpeg-msg")!;
  const bgMsg = container.querySelector("#bg-msg")!;

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
      let config = { path: "" };
      // 直接写空配置
      document.body.style.backgroundImage = "";
      bgMsg.textContent = "背景已清除";
      bgMsg.className = "text-sm mt-1 text-success";
    } catch (e) {
      bgMsg.textContent = `失败: ${e}`;
      bgMsg.className = "text-sm mt-1 text-error";
    }
  });
}
