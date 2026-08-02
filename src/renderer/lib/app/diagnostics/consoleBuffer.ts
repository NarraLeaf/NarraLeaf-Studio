/**
 * A rolling copy of this window's console, kept so it can be handed over after something breaks.
 *
 * The main process writes its own log to `<userData>/logs/main.log`, but the renderer has no
 * equivalent: everything Studio's UI prints lives only in a devtools console the user did not have
 * open. That is precisely the half that explains a failed workspace start, so a bounded buffer is
 * kept here and shipped with the support bundle.
 *
 * Bounded, formatted at capture time, and length-capped per entry - the buffer must cost a stable
 * amount of memory no matter how chatty a session gets, and it must survive the page being in a
 * state where nothing else works.
 */

export type ConsoleBufferLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleBufferEntry {
    level: ConsoleBufferLevel;
    timestamp: number;
    message: string;
}

/** How many lines to keep. Enough to cover a window's whole startup, small enough to paste. */
const MAX_ENTRIES = 400;

/** Per-line cap. One huge object dump must not push the rest of the story out of the buffer. */
const MAX_MESSAGE_CHARS = 4000;

const entries: ConsoleBufferEntry[] = [];
let installed = false;

function truncate(text: string): string {
    return text.length > MAX_MESSAGE_CHARS
        ? `${text.slice(0, MAX_MESSAGE_CHARS)}… <${text.length - MAX_MESSAGE_CHARS} more chars>`
        : text;
}

/**
 * One console argument as text.
 *
 * Errors keep their stack (the reason to read this buffer at all), and anything that will not
 * serialize falls back to its own `String()` rather than throwing - a formatter that can throw
 * would turn every log call into a second failure.
 */
function argumentToString(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    if (value instanceof Error) {
        return value.stack ?? `${value.name}: ${value.message}`;
    }
    if (value === null || value === undefined || typeof value !== "object") {
        return String(value);
    }
    try {
        const seen = new WeakSet<object>();
        return JSON.stringify(value, (_key, nested) => {
            if (typeof nested === "object" && nested !== null) {
                if (seen.has(nested as object)) {
                    return "<circular>";
                }
                seen.add(nested as object);
            }
            return nested;
        }) ?? String(value);
    } catch {
        return String(value);
    }
}

export function recordConsoleEntry(level: ConsoleBufferLevel, args: unknown[]): void {
    entries.push({
        level,
        timestamp: Date.now(),
        message: truncate(args.map(argumentToString).join(" ")),
    });
    if (entries.length > MAX_ENTRIES) {
        entries.splice(0, entries.length - MAX_ENTRIES);
    }
}

/**
 * Start recording. Idempotent, and safe to call before anything else in the window exists.
 *
 * The original console methods are still called, so devtools shows exactly what it did before -
 * this only tees the stream, it never swallows a line.
 */
export function installConsoleBuffer(): void {
    if (installed || typeof console === "undefined") {
        return;
    }
    installed = true;

    const levels: ConsoleBufferLevel[] = ["log", "info", "warn", "error", "debug"];
    for (const level of levels) {
        const original = console[level]?.bind(console);
        if (!original) {
            continue;
        }
        console[level] = (...args: unknown[]) => {
            recordConsoleEntry(level, args);
            original(...args);
        };
    }

    if (typeof window !== "undefined") {
        // Two failures the console never sees as `console.error`: a script error that reached the
        // top of the stack, and a promise nobody attached a catch to. Both are exactly what the
        // buffer exists for.
        window.addEventListener("error", event => {
            recordConsoleEntry("error", ["[window.onerror]", event.error ?? event.message]);
        });
        window.addEventListener("unhandledrejection", event => {
            recordConsoleEntry("error", ["[unhandledrejection]", event.reason]);
        });
    }
}

/** Newest last, formatted one line per entry. */
export function getConsoleBufferLines(): string[] {
    return entries.map(entry =>
        `${new Date(entry.timestamp).toISOString()} [${entry.level.toUpperCase()}] ${entry.message}`,
    );
}

/** Test seam: forget everything recorded so far. */
export function clearConsoleBuffer(): void {
    entries.length = 0;
}
