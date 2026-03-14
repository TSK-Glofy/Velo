/**
 * 侧边栏组件：可展开/收起的图标导航栏
 * 收起时只显示图标，展开后显示图标+文字标签
 */

// SVG 图标（内联，不引入图标库）
const ICONS = {
  menu: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`,
  trim: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1Z"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>`,
  merge: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/></svg>`,
  frames: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M17 3v18"/><path d="M3 7h18"/><path d="M3 12h18"/><path d="M3 17h18"/></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
};

// 导航项配置，后续新增页面只需在此添加
const NAV_ITEMS: { page: Page; icon: string; label: string; position: "top" | "bottom" }[] = [
  { page: "trim", icon: ICONS.trim, label: "视频截取", position: "top" },
  { page: "merge", icon: ICONS.merge, label: "视频合并", position: "top" },
  { page: "frames", icon: ICONS.frames, label: "逐帧提取", position: "top" },
  { page: "settings", icon: ICONS.settings, label: "设置", position: "bottom" },
];

type Page = "trim" | "merge" | "frames" | "settings";

let expanded = false;

export function renderSidebar(
  sidebar: HTMLElement,
  onNavigate: (page: Page) => void
) {
  const topItems = NAV_ITEMS.filter((i) => i.position === "top");
  const bottomItems = NAV_ITEMS.filter((i) => i.position === "bottom");

  const renderBtn = (item: typeof NAV_ITEMS[0], isFirst: boolean) => `
    <button class="sidebar-btn btn btn-ghost${isFirst ? " active btn-active" : ""}" data-page="${item.page}" title="${item.label}">
      <span class="sidebar-icon">${item.icon}</span>
      <span class="sidebar-label">${item.label}</span>
    </button>`;

  sidebar.innerHTML = `
    <button id="sidebar-toggle" class="sidebar-btn btn btn-ghost" title="展开菜单">
      <span class="sidebar-icon">${ICONS.menu}</span>
      <span class="sidebar-label">菜单</span>
    </button>
    ${topItems.map((item) => renderBtn(item, item.page === "trim")).join("")}
    <div class="flex-1"></div>
    ${bottomItems.map((item) => renderBtn(item, false)).join("")}
    <div class="mb-2"></div>
  `;

  // 展开/收起切换
  sidebar.querySelector("#sidebar-toggle")!.addEventListener("click", () => {
    expanded = !expanded;
    sidebar.classList.toggle("expanded", expanded);
    sidebar.querySelector("#sidebar-toggle")!.setAttribute("title", expanded ? "收起菜单" : "展开菜单");
  });

  // 页面导航
  const buttons = sidebar.querySelectorAll<HTMLButtonElement>(".sidebar-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active", "btn-active"));
      btn.classList.add("active", "btn-active");
      onNavigate(btn.dataset.page as Page);
    });
  });
}
