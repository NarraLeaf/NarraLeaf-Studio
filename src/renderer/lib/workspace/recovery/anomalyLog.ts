import type { TranslationKey } from "@shared/i18n";

/**
 * Every failure the workspace survived, kept verbatim.
 *
 * The problem this exists for is not that Studio crashes on a damaged project - mostly it does the
 * opposite. A corrupt asset shard is backed up and reset to `{}`; a story that will not parse is
 * left unloaded; a plugin that throws is skipped. Each of those is a reasonable local decision and
 * each one leaves the author looking at a workspace that is *quietly wrong*: the assets are gone,
 * the scene is empty, and the only record of why is a `console.warn` in a devtools window nobody has
 * open. This log is where that record goes instead.
 *
 * **Module-level, not a service**, for the same reason `writeFreeze` is: the things that need to
 * report are reached from paths that have no workspace context - a service's own `init`, which may
 * be the thing that failed - and a log that only existed once the workspace was up would miss
 * exactly the failures worth having.
 *
 * **Raw text is the product.** {@link WorkspaceAnomaly.raw} is never translated, never trimmed and
 * never summarised: the recovery panel shows it as it arrived, because the reader is either the
 * author pasting it into an issue or a developer reading the code that produced it, and both are
 * served by the original and neither by a friendlier version of it.
 */

export type WorkspaceAnomalySource =
    | "startup"
    | "project"
    | "assets"
    | "story"
    | "interface"
    | "characters"
    | "localization"
    | "voice"
    | "variables"
    | "audio"
    | "plugins";

export interface WorkspaceAnomaly {
    /** Unique per record; the list's React key. */
    id: string;
    source: WorkspaceAnomalySource;
    /**
     * What the workspace was doing when this happened.
     *
     * A key rather than a sentence so the list follows a live language switch, and so a report made
     * during startup - before i18n has necessarily settled - is not frozen in whatever locale
     * happened to be loaded at that instant.
     */
    operationKey: TranslationKey;
    /** The file involved, when there is one. Shown next to the operation, and worth copying. */
    path?: string;
    /** The error exactly as it arrived. See the note above: this is the point of the record. */
    raw: string;
    /**
     * `fatal` stopped the workspace from starting; `degraded` did not.
     *
     * Drives whether Studio offers recovery mode on its own. A degraded project is the dangerous
     * case - nothing looks broken, so nobody goes looking - and it is the one the author has to be
     * told about; a fatal one is already showing an error screen.
     */
    severity: "fatal" | "degraded";
    at: number;
}

export type WorkspaceAnomalyInput = Omit<WorkspaceAnomaly, "id" | "at" | "raw"> & {
    /** Anything at all: an `Error`, an fs reject `{code, message}`, a string. See {@link describeRawError}. */
    error: unknown;
};

/**
 * Kept small on purpose. A project that produces hundreds of distinct read failures has one
 * underlying cause, and the first few say what it is; past that the list stops being readable, which
 * is the only thing it has to be.
 */
const LIMIT = 200;

let anomalies: WorkspaceAnomaly[] = [];
let counter = 0;
const observers = new Set<(anomalies: readonly WorkspaceAnomaly[]) => void>();

/**
 * Record a failure the workspace decided to survive.
 *
 * Repeats collapse. Not a nicety: the load paths that report here run again on every working-tree
 * re-read (a thaw, a restore, a version view), so a single damaged file would otherwise add a row
 * every time the author browsed their own history, and the list would grow while the project got no
 * worse. Identity is the whole record bar the timestamp - a *different* error on the same file is a
 * different fact and gets its own row.
 */
export function reportWorkspaceAnomaly(input: WorkspaceAnomalyInput): WorkspaceAnomaly {
    const raw = describeRawError(input.error);
    const existing = anomalies.find(anomaly =>
        anomaly.source === input.source
        && anomaly.operationKey === input.operationKey
        && anomaly.path === input.path
        && anomaly.severity === input.severity
        && anomaly.raw === raw);
    if (existing) {
        return existing;
    }

    const anomaly: WorkspaceAnomaly = {
        id: `anomaly-${++counter}`,
        source: input.source,
        operationKey: input.operationKey,
        path: input.path,
        raw,
        severity: input.severity,
        at: Date.now(),
    };
    // Newest first, matching how the panel reads and how the notification history already behaves.
    anomalies = [anomaly, ...anomalies].slice(0, LIMIT);

    // The console line is not redundant with the record: the diagnostics bundle is built from the
    // renderer's console ring buffer, so a failure that only ever lived in this array would be
    // missing from the very export the author is asked to send.
    console.warn(`[workspace] ${input.source}: ${input.operationKey}${input.path ? ` (${input.path})` : ""}\n${raw}`);

    announce();
    return anomaly;
}

export function getWorkspaceAnomalies(): readonly WorkspaceAnomaly[] {
    return anomalies;
}

/**
 * Empty the log.
 *
 * **Not called on a retry, and that is deliberate.** The obvious-looking rule - "a fresh attempt
 * starts with a fresh log" - is wrong here, because several of the load paths that report *repair*
 * what they could not read: an unparseable asset shard is set aside and replaced with `{}`. The
 * second attempt therefore finds a healthy file and reports nothing, and a log cleared beforehand
 * would leave a workspace whose assets are silently empty with no record of why. Repeats collapse in
 * {@link reportWorkspaceAnomaly}, so a genuinely re-run load costs nothing anyway.
 *
 * Exists for tests, and for a future project switch inside one window - which the one-project,
 * one-window model does not currently allow.
 */
export function clearWorkspaceAnomalies(): void {
    if (anomalies.length === 0) {
        return;
    }
    anomalies = [];
    announce();
}

/**
 * Watch the log. Fires immediately with the current contents, then on every change.
 *
 * The immediate call is not a convenience: most of what lands here is reported while services are
 * initializing, which is before any component that cares has mounted. An observer that only saw
 * later writes would come up empty on precisely the window that opened because the log was not.
 *
 * Guarded like the announcement below, and for the same reason - a subscriber that throws must not
 * take down the thing subscribing to it.
 */
export function observeWorkspaceAnomalies(
    observer: (anomalies: readonly WorkspaceAnomaly[]) => void,
): () => void {
    observers.add(observer);
    notify(() => observer(anomalies));
    return () => {
        observers.delete(observer);
    };
}

/**
 * Turn anything a `catch` can hand you into text worth reading.
 *
 * The three shapes that actually turn up, in the order they turn up in: an `Error` (services throw
 * `RendererError`), the filesystem bridge's `{code, message}` reject, and - from a `JSON.parse` deep
 * inside something - a plain string. Everything else is serialised rather than becoming
 * `[object Object]`, because the case this is for is the one nobody predicted.
 *
 * The stack is kept. It is the difference between "could not read the asset index" and knowing which
 * of the four code paths that could say that actually did.
 */
export function describeRawError(error: unknown): string {
    if (typeof error === "string") {
        return error;
    }
    if (error instanceof Error) {
        const head = `${error.name}: ${error.message}`;
        // V8 stacks already begin with that same line; a second copy would push the frames off the
        // visible part of the box for no gain.
        const body = error.stack && !error.stack.startsWith(head) ? `${head}\n${error.stack}` : error.stack ?? head;
        const cause = (error as { cause?: unknown }).cause;
        return cause === undefined ? body : `${body}\nCaused by: ${describeRawError(cause)}`;
    }
    if (error && typeof error === "object") {
        const record = error as Record<string, unknown>;
        if (typeof record.message === "string") {
            return typeof record.code === "string" || typeof record.code === "number"
                ? `${record.code}: ${record.message}`
                : record.message;
        }
        try {
            return JSON.stringify(error, null, 2);
        } catch {
            // Circular, or something with a throwing getter. Still better than nothing.
            return String(error);
        }
    }
    return String(error);
}

function announce(): void {
    for (const observer of observers) {
        notify(() => observer(anomalies));
    }
}

/**
 * Run one observer callback, absorbing anything it throws.
 *
 * An observer must never be able to turn "we survived this" into a thrown error on the load path
 * that survived it - which would take down the very startup this log exists to report on.
 */
function notify(run: () => void): void {
    try {
        run();
    } catch (error) {
        console.warn("[workspace] anomaly observer threw", error);
    }
}
