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

const CONFIG_ACCESS_SENTINEL = "VELO_CONFIG_ACCESS:";
const CONFIG_ACCESS_PATTERNS = [
  "Failed to read config ",
  "Failed to parse config ",
  "Failed to read installer defaults ",
  "Failed to parse installer defaults ",
  "Unable to locate executable:",
  "Executable path has no parent directory",
];

function getErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "");
}

function createErrorScreen(
  title: string,
  messages: string[],
  detail: string,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "mx-auto max-w-2xl px-6 py-10";

  const card = document.createElement("div");
  card.className = "card bg-base-200/90 shadow-lg";

  const body = document.createElement("div");
  body.className = "card-body gap-4";

  const heading = document.createElement("h1");
  heading.className = "text-2xl font-bold";
  heading.textContent = title;
  body.appendChild(heading);

  for (const message of messages) {
    const paragraph = document.createElement("p");
    paragraph.className = "text-base leading-7";
    paragraph.textContent = message;
    body.appendChild(paragraph);
  }

  const detailBox = document.createElement("div");
  detailBox.className = "rounded-md bg-base-300/70 p-3 text-sm break-all whitespace-pre-wrap";
  detailBox.textContent = detail;
  body.appendChild(detailBox);

  card.appendChild(body);
  wrapper.appendChild(card);
  return wrapper;
}

function toConfigAccessError(error: unknown): Error {
  return new Error(`${CONFIG_ACCESS_SENTINEL}${getErrorDetail(error)}`);
}

function isConfigAccessError(error: unknown): boolean {
  if (error instanceof Error && error.message.startsWith(CONFIG_ACCESS_SENTINEL)) {
    return true;
  }

  const detail = getErrorDetail(error);
  return CONFIG_ACCESS_PATTERNS.some((pattern) => detail.includes(pattern));
}

async function configInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toConfigAccessError(error);
  }
}

export function renderConfigError(container: HTMLElement, error: unknown) {
  const detail = getErrorDetail(error).replace(CONFIG_ACCESS_SENTINEL, "") || "Unknown configuration access error.";
  container.replaceChildren(
    createErrorScreen(
      "Configuration Access Error",
      [
        "Velo cannot read or create configuration in the installation folder. Install Velo in a user-writable folder or fix folder permissions.",
        "Velo 无法读取或创建安装目录中的配置。请将 Velo 安装到可写文件夹，或修复文件夹权限。",
      ],
      detail,
    ),
  );
}

function renderFatalError(container: HTMLElement, error: unknown) {
  const detail = getErrorDetail(error) || "Unknown fatal error.";
  container.replaceChildren(
    createErrorScreen(
      "Velo Hit an Unexpected Error",
      [
        "Velo ran into an unexpected problem while loading this page.",
        "Velo 在加载此页面时遇到了意外错误。",
      ],
      detail,
    ),
  );
}

/** Load user's background image */
export async function applyBackground() {
  const bgPath = await configInvoke<string | null>("get_background_image");
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
      if (isConfigAccessError(error)) {
        renderConfigError(container, error);
      } else {
        renderFatalError(container, error);
      }
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
        if (isConfigAccessError(error)) {
          renderConfigError(container, error);
        } else {
          renderFatalError(container, error);
        }
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
    const savedLang = await configInvoke<string>("get_language");
    setLang(savedLang as Lang);

    await applyBackground();

    const savedSize = await configInvoke<string | null>("get_window_size");
    if (savedSize) {
      const [w, h] = savedSize.split("x").map(Number);
      await getCurrentWindow().setSize(new LogicalSize(w, h));
    }

    const ffmpegPath = await configInvoke<string | null>("get_ffmpeg_path");

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
    if (isConfigAccessError(error)) {
      renderConfigError(content, error);
    } else {
      renderFatalError(content, error);
    }
  }
});
