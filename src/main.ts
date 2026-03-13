import "./styles.css";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { renderSidebar } from "./sidebar";
import { renderHome } from "./home";
import { renderSettings } from "./settings";
import { renderSetup } from "./setup";

/** 加载用户设置的背景图 */
export async function applyBackground() {
  const bgPath = await invoke<string | null>("get_background_image");
  if (bgPath) {
    document.body.style.backgroundImage = `url('${convertFileSrc(bgPath)}')`;
  } else {
    document.body.style.backgroundImage = "";
  }
}

/** 导航到指定页面 */
function navigate(page: string, content: HTMLElement) {
  if (page === "home") {
    renderHome(content);
  } else if (page === "settings") {
    renderSettings(content);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const sidebar = document.querySelector("#sidebar") as HTMLElement;
  const content = document.querySelector("#content") as HTMLElement;

  // 加载背景图
  await applyBackground();

  // 应用已保存的窗口尺寸
  const savedSize = await invoke<string | null>("get_window_size");
  if (savedSize) {
    const [w, h] = savedSize.split("x").map(Number);
    await getCurrentWindow().setSize(new LogicalSize(w, h));
  }

  // 检查是否已配置 ffmpeg 路径
  const ffmpegPath = await invoke<string | null>("get_ffmpeg_path");

  if (!ffmpegPath) {
    // 首次启动：隐藏侧边栏，显示设置引导
    sidebar.style.display = "none";
    renderSetup(content, () => {
      sidebar.style.display = "flex";
      renderSidebar(sidebar, (page) => navigate(page, content));
      renderHome(content);
    });
  } else {
    // 正常启动：渲染侧边栏 + 首页
    renderSidebar(sidebar, (page) => navigate(page, content));
    renderHome(content);
  }
});
