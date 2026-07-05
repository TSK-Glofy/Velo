/**
 * Time string utilities: seconds <-> "HH:MM:SS(.fff)".
 * Accepted input formats mirror the Rust-side parse_duration_us:
 * "SS", "SS.f", "MM:SS", "HH:MM:SS" (each part may carry a fraction).
 */

/** Parse a time string into seconds. Returns null when the format is invalid. */
export function hmsToSeconds(str: string): number | null {
  const trimmed = str.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part)) return null;
    seconds = seconds * 60 + Number(part);
  }
  return seconds;
}

/** Format seconds as "HH:MM:SS", keeping sub-second precision when present. */
export function secondsToHms(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const ms = totalMs % 1000;
  const total = (totalMs - ms) / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const frac = ms ? `.${String(ms).padStart(3, "0").replace(/0+$/, "")}` : "";
  return `${pad(h)}:${pad(m)}:${pad(s)}${frac}`;
}

/**
 * Normalize a time input to HH:MM:SS on blur; mark invalid values with
 * the `input-error` class. Pass the page's input cache so the normalized
 * value survives page switches.
 */
export function attachTimeNormalizer(el: HTMLInputElement, cache: Record<string, string>) {
  el.addEventListener("blur", () => {
    el.classList.remove("input-error");
    const raw = el.value.trim();
    if (!raw) return;
    const sec = hmsToSeconds(raw);
    if (sec === null) {
      el.classList.add("input-error");
      return;
    }
    el.value = secondsToHms(sec);
    cache[el.id] = el.value;
  });
}

/** True when a time field blocks submission: non-empty but unparseable. */
export function isInvalidTimeInput(el: HTMLInputElement): boolean {
  return el.value.trim() !== "" && hmsToSeconds(el.value) === null;
}
