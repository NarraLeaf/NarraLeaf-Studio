/**
 * What this build does when it stops working, as the renderer knows it.
 *
 * Module state rather than React state or a prop, for the same reason the crash reporting is:
 * it is read at the moment a tree is being torn down, and by code that runs before React exists.
 *
 * It is deliberately answerable *before* the pack has been read. The crash most likely to be shown
 * is one that happened while the pack was still loading, and a screen that fell back to "show the
 * error" in that window would put a stack trace in front of the players of a game whose author
 * asked for the opposite. The desktop shell therefore hands the policy over as a process argument
 * (see the preload), and the pack only confirms it later.
 */

import {
  DEFAULT_GAME_CRASH_POLICY,
  normalizeGameCrashPolicy,
  type GameCrashPolicy
} from "@shared/types/gameRuntime";

let policy: GameCrashPolicy = DEFAULT_GAME_CRASH_POLICY;

export function setRuntimeCrashPolicy(next: unknown): void {
  policy = normalizeGameCrashPolicy(next);
}

export function getRuntimeCrashPolicy(): GameCrashPolicy {
  return policy;
}

/**
 * How many times in a row this window has restarted itself.
 *
 * In `sessionStorage` because it has to survive the reload it is counting - the whole question is
 * whether the *previous* automatic restart worked. Falls back to a module counter where storage is
 * unavailable, which at least bounds a loop inside one page load.
 */
const AUTO_RESTART_KEY = "nl.crash.autoRestarts";

let inMemoryAutoRestarts = 0;

function readAutoRestarts(): number {
  try {
    const raw = window.sessionStorage.getItem(AUTO_RESTART_KEY);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return inMemoryAutoRestarts;
  }
}

function writeAutoRestarts(value: number): void {
  inMemoryAutoRestarts = value;
  try {
    window.sessionStorage.setItem(AUTO_RESTART_KEY, String(value));
  } catch {
    /* Private mode, a storage quota, a shell that has none. The counter above still bounds. */
  }
}

/**
 * Whether to restart rather than draw the crash screen, counting this attempt.
 *
 * A game that fails on the way up would otherwise restart forever, showing the player a flickering
 * window and no way to read what happened. After the limit the screen is drawn instead, which is
 * the only state from which a person can act.
 */
export function claimAutomaticRestart(limit: number): boolean {
  const attempts = readAutoRestarts();
  if (attempts >= limit) {
    return false;
  }
  writeAutoRestarts(attempts + 1);
  return true;
}

/** Called once the game is up: the next failure is a new incident, not a continuing loop. */
export function clearAutomaticRestarts(): void {
  inMemoryAutoRestarts = 0;
  try {
    window.sessionStorage.removeItem(AUTO_RESTART_KEY);
  } catch {
    /* Nothing to clear where there is no storage. */
  }
}
