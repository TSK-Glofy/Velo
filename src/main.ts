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
    await renderSettings(container);
    return;
  }

  // Other pages initialize only once
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
      navigate("trim", content);
    });
  } else {
    renderSidebar(sidebar, (page) => navigate(page, content));
    await navigate("trim", content);
  }
});
