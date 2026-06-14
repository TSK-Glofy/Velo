import "./styles.css";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { setLang, type Lang } from "./i18n";
import { renderSidebar } from "./sidebar";
import { renderHome } from "./home";
import { renderMerge } from "./merge";
import { renderSettings } from "./settings";
import { renderFrames } from "./frames";
import { renderSetup } from "./setup";

function getConfigErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "");
}

export function renderConfigError(container: HTMLElement, error: unknown) {
  const detail = getConfigErrorDetail(error);
  container.innerHTML = `
    <div class="mx-auto max-w-2xl px-6 py-10">
      <div class="card bg-base-200/90 shadow-lg">
        <div class="card-body gap-4">
          <h1 class="text-2xl font-bold">Configuration Access Error</h1>
          <p class="text-base leading-7">
            Velo cannot read or create configuration in the installation folder.
            Install Velo in a user-writable folder or fix folder permissions.
          </p>
          <p class="text-base leading-7">
            Velo 无法读取或创建安装目录中的配置。请将 Velo 安装到可写文件夹，或修复文件夹权限。
          </p>
          <div class="rounded-md bg-base-300/70 p-3 text-sm break-all">
            ${detail || "Unknown configuration access error."}
          </div>
        </div>
      </div>
    </div>
  `;
}

/** Load user's background image */
export async function applyBackground() {
  const bgPath = await invoke<string | null>("get_background_image");
  if (bgPath) {
    document.body.style.backgroundImage = `url('${convertFileSrc(bgPath)}')`;
  } else {
    document.body.style.backgroundImage = "";
  }
}

// Page container cache: each page is initialized once, then shown/hidden
const pageContainers: Record<string, HTMLElement> = {};
const pageInitialized: Record<string, boolean> = {};

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

async function navigate(page: string, content: HTMLElement) {
  for (const key of Object.keys(pageContainers)) {
    pageContainers[key].style.display = "none";
  }

  const container = getPageContainer(page, content);
  container.style.display = "block";

  // Settings page re-renders every time (needs latest config)
  if (page === "settings") {
    try {
      await renderSettings(container);
    } catch (error) {
      renderConfigError(container, error);
    }
    return;
  }

  // Other pages initialize only once
  if (!pageInitialized[page]) {
    if (page === "trim") {
      try {
        await renderHome(container);
        pageInitialized[page] = true;
      } catch (error) {
        renderConfigError(container, error);
      }
    } else if (page === "merge") {
      renderMerge(container);
      pageInitialized[page] = true;
    } else if (page === "frames") {
      renderFrames(container);
      pageInitialized[page] = true;
    }
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const sidebar = document.querySelector("#sidebar") as HTMLElement;
  const content = document.querySelector("#content") as HTMLElement;

  try {
    // Load saved language before rendering any UI
    const savedLang = await invoke<string>("get_language");
    setLang(savedLang as Lang);

    await applyBackground();

    const savedSize = await invoke<string | null>("get_window_size");
    if (savedSize) {
      const [w, h] = savedSize.split("x").map(Number);
      await getCurrentWindow().setSize(new LogicalSize(w, h));
    }

    const ffmpegPath = await invoke<string | null>("get_ffmpeg_path");

    if (!ffmpegPath) {
      sidebar.style.display = "none";
      renderSetup(content, () => {
        sidebar.style.display = "flex";
        renderSidebar(sidebar, (page) => navigate(page, content));
        void navigate("trim", content);
      });
    } else {
      renderSidebar(sidebar, (page) => navigate(page, content));
      await navigate("trim", content);
    }
  } catch (error) {
    sidebar.style.display = "none";
    renderConfigError(content, error);
  }
});
