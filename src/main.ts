import "./styles.css";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { renderSidebar } from "./sidebar";
import { renderHome } from "./home";
import { renderMerge } from "./merge";
import { renderSettings } from "./settings";
import { renderFrames } from "./frames";
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

// 页面容器缓存：每个页面只初始化一次，切换时显示/隐藏
const pageContainers: Record<string, HTMLElement> = {};
const pageInitialized: Record<string, boolean> = {};

/** 创建或获取页面容器 */
function getPageContainer(page: string, content: HTMLElement): HTMLElement {
  if (!pageContainers[page]) {
    const div = document.createElement("div");
    div.id = `page-${page}`;
    div.style.display = "none";
    content.appendChild(div);
    pageContainers[page] = div;
  }
  return pageContainers[page];
}

/** 导航到指定页面 */
async function navigate(page: string, content: HTMLElement) {
  // 隐藏所有页面
  for (const key of Object.keys(pageContainers)) {
    pageContainers[key].style.display = "none";
  }

  const container = getPageContainer(page, content);
  container.style.display = "block";

  // 设置页每次都重新渲染（需要读取最新配置）
  if (page === "settings") {
    await renderSettings(container);
    return;
  }

  // 其他页面只初始化一次
  if (!pageInitialized[page]) {
    pageInitialized[page] = true;
    if (page === "trim") {
      await renderHome(container);
    } else if (page === "merge") {
      renderMerge(container);
    } else if (page === "frames") {
      renderFrames(container);
    }
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
      navigate("trim", content);
    });
  } else {
    // 正常启动：渲染侧边栏 + 首页
    renderSidebar(sidebar, (page) => navigate(page, content));
    await navigate("trim", content);
  }
});
