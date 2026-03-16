import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n";

/**
 * First-time setup page: configure FFmpeg path
 */
export function renderSetup(container: HTMLElement, onComplete: () => void) {
  container.innerHTML = `
    <div class="flex items-center justify-center h-full">
      <div class="card bg-base-200/90 shadow-xl w-96">
        <div class="card-body">
          <h1 class="card-title text-2xl">${t("setup.welcome")}</h1>
          <p class="opacity-70">${t("setup.hint")}</p>
          <div class="join w-full mt-4">
            <input id="ffmpeg-path" type="text" class="input join-item flex-1"
              placeholder="${t("setup.ffmpegPlaceholder")}" readonly />
            <button id="browse-btn" class="btn join-item">${t("setup.browse")}</button>
          </div>
          <button id="save-btn" class="btn btn-primary mt-4 w-full">${t("setup.saveAndContinue")}</button>
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
      msg.textContent = t("setup.selectFirst");
      return;
    }
    try {
      await invoke("set_ffmpeg_path", { path });
      onComplete();
    } catch (e) {
      msg.textContent = `${t("setup.saveFailed")}${e}`;
    }
  });
}
