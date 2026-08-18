/**
 * The two things a window still needs once a render has already failed: somewhere to put the
 * failure that outlives the window, and a way to write out what the failing tree had not saved.
 *
 * Module state rather than React state, deliberately. Everything here is read at the moment the
 * component tree that would have held it is being torn down - see {@link setCrashRecoveryFlush}.
 */

import type { RendererErrorReport, RendererErrorSource } from "@shared/types/ipcEvents";
import { getInterface } from "../bridge";

/** How many reports one window may send. A render loop can fail once per frame. */
const MAX_REPORTS_PER_WINDOW = 50;

/** Two identical failures this close together are one failure being retried. */
const DUPLICATE_WINDOW_MS = 5000;

let reportCount = 0;
let lastKey = "";
let lastKeyAt = 0;

export interface RendererErrorInput {
  source: RendererErrorSource;
  error: unknown;
  /** Names the failing region. Panels pass their title; the window-level boundary passes nothing. */
  label?: string | null;
  componentStack?: string | null;
}

function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: `${error.name}: ${error.message}`, stack: error.stack ?? null };
  }
  return { message: String(error), stack: null };
}

/**
 * Record a failure in the main-process log.
 *
 * Never throws and never awaits: every caller is already on a failure path, and a reporter that
 * can fail turns one bug into two. The console call is not redundant with the IPC - it is what
 * puts the failure in this window's own buffer, which is what the support bundle carries.
 */
export function reportRendererError(input: RendererErrorInput): void {
  const { message, stack } = describe(input.error);

  try {
    console.error(`[crash:${input.source}]${input.label ? ` ${input.label}:` : ""}`, input.error);
  } catch {
    // A console that cannot print is not a reason to skip the report below.
  }

  const key = `${input.source}|${input.label ?? ""}|${message}`;
  const now = Date.now();
  if (key === lastKey && now - lastKeyAt < DUPLICATE_WINDOW_MS) {
    lastKeyAt = now;
    return;
  }
  lastKey = key;
  lastKeyAt = now;

  if (reportCount >= MAX_REPORTS_PER_WINDOW) {
    return;
  }
  reportCount += 1;

  const report: RendererErrorReport = {
    source: input.source,
    label: input.label ?? null,
    message,
    stack,
    componentStack: input.componentStack ?? null
  };
  try {
    getInterface().reportError(report);
  } catch {
    // No bridge yet, or one that has been taken away. The console buffer still has it.
  }
}

type CrashFlush = () => Promise<unknown>;

let pendingSaveFlush: CrashFlush | null = null;

/**
 * Hand the crash screen a way to write out unsaved work.
 *
 * Registered by whoever owns the debounced saves (the workspace), and deliberately **not** cleared
 * when that owner unmounts: the one moment this is read is the moment React has just replaced the
 * owner's whole tree with the crash screen. A registration that cleaned itself up on unmount would
 * therefore be gone exactly when it is needed. Passing `null` clears it, which is what a window
 * that closes its project does.
 */
export function setCrashRecoveryFlush(flush: CrashFlush | null): void {
  pendingSaveFlush = flush;
}

/** `none` = nothing was registered, so nothing was at risk. */
export type CrashFlushOutcome = "none" | "saved" | "failed";

/**
 * Write out whatever the failed tree had pending.
 *
 * Bounded, because the state this is asking to save is by definition state a bug has just been
 * running in: a flush that never settles would leave the crash screen unable to offer a reload,
 * which is the one thing it exists to offer.
 */
export async function runCrashRecoveryFlush(timeoutMs = 8000): Promise<CrashFlushOutcome> {
  const flush = pendingSaveFlush;
  if (!flush) {
    return "none";
  }
  try {
    let timer: number | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = window.setTimeout(
        () => reject(new Error("Timed out saving pending changes")),
        timeoutMs
      );
    });
    try {
      await Promise.race([flush(), expiry]);
    } finally {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    }
    return "saved";
  } catch (error) {
    reportRendererError({ source: "boundary", label: "pending-save-flush", error });
    return "failed";
  }
}

let globalReportingInstalled = false;

/**
 * Report the two failures React never sees: a script error that reached the top of the stack, and
 * a promise nobody attached a catch to.
 *
 * Neither replaces the window - most of them are one failed call - but before this they lived only
 * in a devtools console nobody had open, which in a packaged build is nobody at all.
 */
export function installGlobalErrorReporting(): void {
  if (globalReportingInstalled || typeof window === "undefined") {
    return;
  }
  globalReportingInstalled = true;

  window.addEventListener("error", (event) => {
    reportRendererError({ source: "window", error: event.error ?? event.message });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportRendererError({ source: "rejection", error: event.reason });
  });
}

/** Test seam: forget the throttling state between cases. */
export function resetCrashRecoveryForTests(): void {
  reportCount = 0;
  lastKey = "";
  lastKeyAt = 0;
  pendingSaveFlush = null;
  globalReportingInstalled = false;
}
