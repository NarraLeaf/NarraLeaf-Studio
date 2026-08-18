import { PlatformSystem } from "@shared/types/os";
import { getPlatformInfo } from "@/lib/renderApp";

export function isMacPlatform(): boolean {
  try {
    return getPlatformInfo().system === PlatformSystem.darwin;
  } catch {
    return false;
  }
}

export function isWindowsPlatform(): boolean {
  try {
    return getPlatformInfo().system === PlatformSystem.win32;
  } catch {
    return false;
  }
}
