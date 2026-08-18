import { promises as fs } from "fs";
import path from "path";

/**
 * How much of the main log goes into a bundle.
 *
 * The log rotates at 5MB (see `fileLogSink`), and a support bundle that big is one nobody opens.
 * The tail is the part that matters: whatever the app was doing when the user pressed the button.
 */
export const MAX_LOG_TAIL_BYTES = 512 * 1024;

const LOG_FILE_NAME = "main.log";

/** Reserved on Windows, and separators everywhere. Control characters are dropped by range below. */
const RESERVED_FILE_NAME_CHARS = '<>:"/\\|?*';

/** The extensions a diagnostics bundle may carry, and the one it gets when it carries none. */
const DIAGNOSTICS_EXTENSIONS = [".log", ".txt"] as const;

/**
 * Reduce a suggested name to something safe to hand a save dialog.
 *
 * The renderer proposes the name, and a renderer is never trusted with a path: a separator or a
 * `..` in there would steer the dialog somewhere the user did not choose. Only the basename
 * survives, and only its printable characters.
 *
 * Both separators are cut on every host, so `path.basename` is deliberately not used: it honours
 * only the host's own, which would let `C:\…\report.log` through whole on Linux. Untrusted input
 * does not become trustworthy by arriving on a platform that cannot parse it.
 *
 * `extensions` is a parameter rather than the `.log`/`.txt` pair this started as, because a second
 * caller arrived (the settings export) and inherited the pair silently: it asked to save
 * `narraleaf-studio-settings.json` and the dialog offered
 * `narraleaf-studio-settings.json.log`. A default that is right for one caller and wrong for the
 * next is worse than no default, so the allowed set is now stated at every call site.
 */
export function sanitizeBundleFileName(
  candidate: string,
  fallback: string,
  extensions: readonly string[] = DIAGNOSTICS_EXTENSIONS
): string {
  const base = candidate.trim().split(/[\\/]/).pop() ?? "";
  const kept = Array.from(base)
    .filter((char) => char >= " " && !RESERVED_FILE_NAME_CHARS.includes(char))
    .join("");
  const trimmed = kept.replace(/^\.+/, "").trim();
  if (!trimmed) {
    return fallback;
  }
  const lower = trimmed.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension))
    ? trimmed
    : `${trimmed}${extensions[0]}`;
}

/**
 * The tail of `<logsDir>/main.log`, at most {@link MAX_LOG_TAIL_BYTES}.
 *
 * Reads by byte offset rather than slurping the file: the whole point of the cap is to not hold a
 * 5MB log in memory on a machine that is already unhappy. A partial first line is dropped, since a
 * byte offset lands mid-line and half a line reads as corruption to whoever opens the bundle.
 *
 * Never throws. A bundle is what someone falls back to when the app is already broken, and a
 * missing or unreadable log must not be the thing that stops it from being written.
 */
export async function readMainLogTail(
  logsDir: string,
  maxBytes = MAX_LOG_TAIL_BYTES
): Promise<string> {
  const logPath = path.join(logsDir, LOG_FILE_NAME);
  let handle;
  try {
    handle = await fs.open(logPath, "r");
  } catch (error) {
    return `<no main.log at ${logPath}: ${(error as Error).message}>`;
  }

  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const text = buffer.toString("utf-8");
    if (size <= maxBytes) {
      return text;
    }
    const firstBreak = text.indexOf("\n");
    const body = firstBreak === -1 ? text : text.slice(firstBreak + 1);
    return `<truncated: showing the last ${length} of ${size} bytes>\n${body}`;
  } catch (error) {
    return `<could not read ${logPath}: ${(error as Error).message}>`;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export interface DiagnosticsEnvironment {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  osRelease: string;
  arch: string;
  packaged: boolean;
  locale: string;
  userDataDir: string;
  logsDir: string;
  generatedAt: string;
}

/** The header every bundle opens with: what was running, and where its files are. */
export function formatEnvironmentSection(environment: DiagnosticsEnvironment): string {
  return [
    "=== NarraLeaf Studio diagnostics ===",
    `Generated: ${environment.generatedAt}`,
    `Studio: ${environment.appVersion}${environment.packaged ? "" : " (development build)"}`,
    `Electron: ${environment.electronVersion} (Chrome ${environment.chromeVersion}, Node ${environment.nodeVersion})`,
    `Platform: ${environment.platform} ${environment.osRelease} ${environment.arch}`,
    `Language: ${environment.locale}`,
    `User data: ${environment.userDataDir}`,
    `Logs: ${environment.logsDir}`
  ].join("\n");
}

/**
 * Stitch the three sections into the file that gets written.
 *
 * The renderer's report comes first and the log tail last: whoever opens this reads top-down, and
 * the answer is almost always in the report - the log is the evidence behind it.
 */
export function composeDiagnosticsBundle(
  environment: DiagnosticsEnvironment,
  rendererReport: string,
  mainLogTail: string
): string {
  return [
    formatEnvironmentSection(environment),
    "",
    rendererReport.trim(),
    "",
    `--- main.log (tail, up to ${MAX_LOG_TAIL_BYTES} bytes) ---`,
    mainLogTail.trimEnd(),
    ""
  ].join("\n");
}
