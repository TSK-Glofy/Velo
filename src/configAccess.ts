import { invoke } from "@tauri-apps/api/core";

const CONFIG_ACCESS_SENTINEL = "VELO_CONFIG_ACCESS:";

function getErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "");
}

export class ConfigAccessError extends Error {
  constructor(error: unknown) {
    super(`${CONFIG_ACCESS_SENTINEL}${getErrorDetail(error)}`);
    this.name = "ConfigAccessError";
  }
}

export async function configInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new ConfigAccessError(error);
  }
}

export function isConfigAccessError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(CONFIG_ACCESS_SENTINEL);
}

export function configErrorMessage(error: unknown): string {
  void error;
  return [
    "Velo cannot read or create configuration in the installation folder.",
    "Install Velo in a user-writable folder or fix folder permissions.",
    "Velo cannot access configuration in its installation folder.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function errorDetail(error: unknown): string {
  return getErrorDetail(error).replace(CONFIG_ACCESS_SENTINEL, "");
}
