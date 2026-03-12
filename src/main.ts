import { invoke } from "@tauri-apps/api/core";

window.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector("#hello-btn");
  const msg = document.querySelector("#hello-msg");

  btn?.addEventListener("click", async () => {
    // 调用 Rust 端的 "hello" 命令，类似于前端调后端 API
    const result = await invoke<string>("hello");
    if (msg) msg.textContent = result;
  });
});
