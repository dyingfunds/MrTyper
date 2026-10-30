import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AppSettings,
  BackendEvents,
  BootstrapPayload,
  EngineStatus,
  Preset,
  StartRequest,
  TypingSettings,
  WindowBounds,
} from "../types";
import { mockBackend } from "./mockBackend";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function bootstrap(): Promise<BootstrapPayload> {
  if (!isTauri) return mockBackend.bootstrap();
  return invoke<BootstrapPayload>("bootstrap");
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (!isTauri) return mockBackend.saveSettings(settings);
  return invoke<AppSettings>("save_settings", { settings });
}

export async function saveLastText(text: string): Promise<void> {
  if (!isTauri) return mockBackend.saveLastText(text);
  await invoke("save_last_text", { text });
}

export async function saveWindowBounds(bounds: WindowBounds): Promise<void> {
  if (!isTauri) return mockBackend.saveWindowBounds(bounds);
  await invoke("save_window_bounds", { bounds });
}

export async function startTyping(request: StartRequest): Promise<void> {
  if (!isTauri) return mockBackend.startTyping(request);
  await invoke("start_typing", { request });
}

export async function pauseTyping(): Promise<void> {
  if (!isTauri) return mockBackend.pauseTyping();
  await invoke("pause_typing");
}

export async function resumeTyping(): Promise<void> {
  if (!isTauri) return mockBackend.resumeTyping();
  await invoke("resume_typing");
}

export async function stopTyping(): Promise<void> {
  if (!isTauri) return mockBackend.stopTyping();
  await invoke("stop_typing");
}

export async function emergencyStop(): Promise<void> {
  if (!isTauri) return mockBackend.emergencyStop();
  await invoke("emergency_stop");
}

export async function getEngineStatus(): Promise<EngineStatus> {
  if (!isTauri) return mockBackend.getEngineStatus();
  return invoke<EngineStatus>("get_engine_status");
}

export async function savePreset(name: string, typing: TypingSettings): Promise<Preset> {
  if (!isTauri) return mockBackend.savePreset(name, typing);
  return invoke<Preset>("save_preset", { name, typing });
}

export async function renamePreset(id: string, name: string): Promise<Preset> {
  if (!isTauri) return mockBackend.renamePreset(id, name);
  return invoke<Preset>("rename_preset", { id, name });
}

export async function deletePreset(id: string): Promise<void> {
  if (!isTauri) return mockBackend.deletePreset(id);
  await invoke("delete_preset", { id });
}

export async function onBackendEvent<K extends keyof BackendEvents>(
  event: K,
  handler: (payload: BackendEvents[K]) => void,
): Promise<UnlistenFn> {
  if (!isTauri) {
    const unlisten = mockBackend.on(event, handler);
    return async () => unlisten();
  }
  return listen<BackendEvents[K]>(event, (eventPayload) => {
    handler(eventPayload.payload);
  });
}

export async function showWindow(): Promise<void> {
  if (!isTauri) return;
  const window = getCurrentWindow();
  await window.show();
  await window.setFocus();
}

export async function hideWindow(): Promise<void> {
  if (!isTauri) return;
  await getCurrentWindow().hide();
}

export async function minimizeWindow(): Promise<void> {
  if (!isTauri) return;
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow(): Promise<boolean> {
  if (!isTauri) return false;
  const window = getCurrentWindow();
  await window.toggleMaximize();
  return window.isMaximized();
}

export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri) return false;
  return getCurrentWindow().isMaximized();
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  if (!isTauri) return;
  await getCurrentWindow().setAlwaysOnTop(alwaysOnTop);
}

export async function setBackdropTheme(dark: boolean): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke("apply_backdrop_theme", { dark });
  } catch {
    // Mica is a progressive enhancement; the CSS backdrop is the fallback.
  }
}

export async function readWindowBounds(): Promise<WindowBounds | null> {
  if (!isTauri) return null;
  try {
    const window = getCurrentWindow();
    const [position, size] = await Promise.all([
      window.outerPosition(),
      window.innerSize(),
    ]);
    return {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };
  } catch {
    return null;
  }
}

export async function onWindowGeometryChange(
  callback: () => void,
): Promise<() => void> {
  if (!isTauri) return () => undefined;
  const window = getCurrentWindow();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(callback, 450);
  };
  const unlisteners = await Promise.all([
    window.onMoved(schedule),
    window.onResized(schedule),
  ]);
  return () => {
    if (timer) clearTimeout(timer);
    unlisteners.forEach((unlisten) => unlisten());
  };
}

export async function onWindowMaximizeChange(
  callback: (maximized: boolean) => void,
): Promise<() => void> {
  if (!isTauri) return () => undefined;
  const unlisten = await getCurrentWindow().onResized(async () => {
    try {
      callback(await getCurrentWindow().isMaximized());
    } catch {
      // Ignore transient state while the window is being torn down.
    }
  });
  return unlisten;
}

export function friendlyError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Something went wrong. Please try again.";
}
