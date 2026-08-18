import { getConsoleBufferLines } from "./consoleBuffer";

/**
 * The renderer's half of a support bundle, and the same text the "copy" button puts on the
 * clipboard.
 *
 * Pure string building on purpose: the caller is a screen that only exists because something
 * already failed, so nothing here may read a service, touch the file system, or throw.
 */

export interface DiagnosticsReportInput {
  /** What the user was looking at, e.g. `workspace-init`. Also names the file. */
  scope: string;
  /** The failure this report is about, if there is one. */
  error?: Error | null;
  /** Anything worth stating outright: the project path, the window type, a build id. */
  facts?: Record<string, string | number | boolean | null | undefined>;
  /**
   * A block of the caller's own, placed between the facts and the console tail.
   *
   * For a report whose substance is not one error: recovery mode's bundle is a list of failures
   * and a table of which subsystems load, and squeezing that into `facts` would flatten multi-line
   * stack traces into single-line values.
   */
  details?: string;
  /** Console tail. Defaults to this window's buffer. */
  consoleLines?: string[];
}

function formatError(error: Error): string {
  const headline = `${error.name}: ${error.message}`;
  // V8 already opens `.stack` with `Name: message`, so printing both would repeat the one line
  // the reader cares about most. Only add the headline when the stack does not already carry it -
  // an engine or a subclass that formats its stack differently still gets a readable report.
  const lines = error.stack?.startsWith(headline) ? [] : [headline];
  if (error.stack) {
    lines.push(error.stack);
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== null) {
    lines.push(
      `Caused by: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`
    );
  }
  return lines.join("\n");
}

/**
 * Two digits, so a file name sorts the way a date should.
 */
function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `narraleaf-studio-<scope>-20260731-142530.log`, in local time - the user's own clock. */
export function buildDiagnosticsFileName(scope: string, now: Date = new Date()): string {
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
  return `narraleaf-studio-${scope}-${stamp}.log`;
}

export function buildDiagnosticsReport(input: DiagnosticsReportInput): string {
  const sections: string[] = [`--- Report (${input.scope}) ---`];

  const facts = input.facts ?? {};
  const factLines = Object.entries(facts)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value === null ? "<none>" : String(value)}`);
  if (factLines.length > 0) {
    sections.push(factLines.join("\n"));
  }

  sections.push(
    input.error ? `--- Error ---\n${formatError(input.error)}` : "--- Error ---\n<none>"
  );

  if (input.details) {
    sections.push(`--- Details ---\n${input.details}`);
  }

  const consoleLines = input.consoleLines ?? getConsoleBufferLines();
  sections.push(
    consoleLines.length > 0
      ? `--- Renderer console (last ${consoleLines.length} lines) ---\n${consoleLines.join("\n")}`
      : "--- Renderer console ---\n<empty>"
  );

  return sections.join("\n\n");
}
