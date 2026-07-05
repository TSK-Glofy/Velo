import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { secondsToHms } from "./timeFormat";

/**
 * Dual-handle range selector with live frame preview.
 *
 * Playback modes:
 * - "video": the source plays in an HTML5 <video> (WebView2 native decode,
 *   mp4/webm/most mkv) and seeks instantly while dragging.
 * - "frame": for codecs the webview can't decode (avi/flv/wmv...), dragging
 *   is debounced and a single frame is extracted through ffmpeg instead.
 */
export interface RangeSelector {
  /** Sync handles/preview from the outside (e.g. after manual input edits). */
  setRange(startSec: number, endSec: number): void;
  destroy(): void;
}

export interface RangeSelectorOptions {
  host: HTMLElement;
  inputPath: string;
  /** Fired while dragging and on release with the selected range in seconds. */
  onRangeChange: (startSec: number, endSec: number) => void;
}

const SCRUB_DEBOUNCE_MS = 200;

export function createRangeSelector(opts: RangeSelectorOptions): RangeSelector {
  const { host, inputPath, onRangeChange } = opts;

  host.innerHTML = `
    <div class="card bg-base-200/80 shadow-md mb-6">
      <div class="card-body gap-3">
        <div class="rs-media">
          <video class="rs-video" muted preload="metadata"></video>
          <img class="rs-img hidden" alt="" />
          <div class="rs-badge hidden">${t("range.fallbackBadge")}</div>
        </div>
        <div class="rs-track">
          <div class="rs-rail"></div>
          <div class="rs-sel"></div>
          <div class="rs-handle rs-handle-start" data-handle="start"></div>
          <div class="rs-handle rs-handle-end" data-handle="end"></div>
        </div>
        <div class="flex justify-between text-xs font-mono opacity-70">
          <span class="rs-label-start">00:00:00</span>
          <span class="rs-hint font-sans opacity-80">${t("range.loading")}</span>
          <span class="rs-label-end">--:--:--</span>
        </div>
      </div>
    </div>
  `;

  const video = host.querySelector(".rs-video") as HTMLVideoElement;
  const img = host.querySelector(".rs-img") as HTMLImageElement;
  const badge = host.querySelector(".rs-badge") as HTMLElement;
  const track = host.querySelector(".rs-track") as HTMLElement;
  const sel = host.querySelector(".rs-sel") as HTMLElement;
  const handleStart = host.querySelector(".rs-handle-start") as HTMLElement;
  const handleEnd = host.querySelector(".rs-handle-end") as HTMLElement;
  const labelStart = host.querySelector(".rs-label-start") as HTMLElement;
  const labelEnd = host.querySelector(".rs-label-end") as HTMLElement;
  const hint = host.querySelector(".rs-hint") as HTMLElement;

  let mode: "video" | "frame" = "video";
  let duration = 0;
  let start = 0;
  let end = 0;
  let ready = false;
  let destroyed = false;
  let pendingRange: [number, number] | null = null;
  let scrubTimer: number | undefined;
  let scrubGeneration = 0;

  function fractionFor(sec: number): number {
    return duration > 0 ? Math.min(1, Math.max(0, sec / duration)) : 0;
  }

  function renderTrack() {
    const fs = fractionFor(start) * 100;
    const fe = fractionFor(end) * 100;
    handleStart.style.left = `${fs}%`;
    handleEnd.style.left = `${fe}%`;
    sel.style.left = `${fs}%`;
    sel.style.width = `${Math.max(0, fe - fs)}%`;
    labelStart.textContent = secondsToHms(start);
    labelEnd.textContent = secondsToHms(end);
  }

  /** Show the frame at `sec` — instant seek in video mode, debounced ffmpeg extraction otherwise. */
  function showFrameAt(sec: number) {
    if (!ready) return;
    if (mode === "video") {
      video.currentTime = sec;
      return;
    }
    window.clearTimeout(scrubTimer);
    const generation = ++scrubGeneration;
    scrubTimer = window.setTimeout(async () => {
      try {
        const path = await invoke<string>("generate_scrub_frame", {
          input: inputPath,
          seconds: sec,
        });
        if (destroyed || generation !== scrubGeneration) return;
        img.src = `${convertFileSrc(path)}?v=${generation}`;
      } catch {
        // Frame extraction is best-effort; keep the previous frame.
      }
    }, SCRUB_DEBOUNCE_MS);
  }

  function activate(totalSec: number) {
    if (destroyed) return;
    duration = totalSec;
    ready = true;
    hint.textContent = t("range.hint");
    if (pendingRange) {
      [start, end] = pendingRange;
      pendingRange = null;
      start = Math.min(Math.max(0, start), duration);
      end = Math.min(Math.max(start, end), duration);
    } else {
      start = 0;
      end = duration;
    }
    renderTrack();
    showFrameAt(start);
  }

  video.addEventListener("loadedmetadata", () => {
    if (mode !== "video") return;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      activate(video.duration);
    }
  });

  video.addEventListener("error", async () => {
    if (destroyed || mode === "frame") return;
    // Webview can't decode this container/codec: fall back to ffmpeg frames.
    mode = "frame";
    video.classList.add("hidden");
    img.classList.remove("hidden");
    badge.classList.remove("hidden");
    try {
      const secs = await invoke<number>("get_video_duration", { input: inputPath });
      activate(secs);
    } catch (e) {
      hint.textContent = `${t("range.error")}${e}`;
    }
  });

  video.src = convertFileSrc(inputPath);

  // --- dragging ---
  let dragging: "start" | "end" | null = null;

  function secondsFromPointer(ev: PointerEvent): number {
    const rect = track.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    return frac * duration;
  }

  track.addEventListener("pointerdown", (ev) => {
    if (!ready) return;
    const target = ev.target as HTMLElement;
    const explicit = target.dataset?.handle as "start" | "end" | undefined;
    if (explicit) {
      dragging = explicit;
    } else {
      // Grab the nearest handle when clicking the rail directly.
      const sec = secondsFromPointer(ev);
      dragging = Math.abs(sec - start) <= Math.abs(sec - end) ? "start" : "end";
    }
    track.setPointerCapture(ev.pointerId);
    onPointerMove(ev);
  });

  function onPointerMove(ev: PointerEvent) {
    if (!dragging || !ready) return;
    const sec = secondsFromPointer(ev);
    if (dragging === "start") {
      start = Math.min(sec, end);
    } else {
      end = Math.max(sec, start);
    }
    renderTrack();
    showFrameAt(dragging === "start" ? start : end);
    onRangeChange(start, end);
  }

  track.addEventListener("pointermove", onPointerMove);
  track.addEventListener("pointerup", (ev) => {
    if (dragging) {
      track.releasePointerCapture(ev.pointerId);
      dragging = null;
      onRangeChange(start, end);
    }
  });

  return {
    setRange(startSec: number, endSec: number) {
      if (!ready) {
        pendingRange = [startSec, endSec];
        return;
      }
      start = Math.min(Math.max(0, startSec), duration);
      end = Math.min(Math.max(start, endSec), duration);
      renderTrack();
      showFrameAt(start);
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(scrubTimer);
      video.removeAttribute("src");
      video.load();
      host.innerHTML = "";
    },
  };
}
