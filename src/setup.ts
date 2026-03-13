import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/**
 * 首次启动引导页：设置 FFmpeg 路径
 * onComplete 回调：保存成功后通知 main.ts 切换到主界面
 */
export function renderSetup(container: HTMLElement, onComplete: () => void) {
  container.innerHTML = `
    <div class="flex items-center justify-center h-full">
      <div class="card bg-base-200/90 shadow-xl w-96">
        <div class="card-body">
          <h1 class="card-title text-2xl">欢迎使用 Velo</h1>
          <p class="opacity-70">首次使用，请设置 FFmpeg 路径</p>
          <div class="join w-full mt-4">
            <input id="ffmpeg-path" type="text" class="input join-item flex-1"
              placeholder="ffmpeg.exe 路径" readonly />
            <button id="browse-btn" class="btn join-item">浏览</button>
          </div>
          <button id="save-btn" class="btn btn-primary mt-4 w-full">保存并继续</button>
          <p id="setup-msg" class="text-sm mt-2 text-error"></p>
        </div>
      </div>
    </div>
  `;

  const pathInput = container.querySelector("#ffmpeg-path") as HTMLInputElement;

  container.querySelector("#browse-btn")!.addEventListener("click", async () => {
    const selected = await open({
      filters: [{ name: "FFmpeg", extensions: ["exe"] }],
    });
    if (selected) {
      pathInput.value = selected as string;
    }
  });

  container.querySelector("#save-btn")!.addEventListener("click", async () => {
    const path = pathInput.value;
    const msg = container.querySelector("#setup-msg")!;
    if (!path) {
      msg.textContent = "请先选择 ffmpeg.exe";
      return;
    }
    try {
      await invoke("set_ffmpeg_path", { path });
      onComplete();
    } catch (e) {
      msg.textContent = `保存失败: ${e}`;
    }
  });
}
