import koffi from "koffi";
import type { LoreVerbName } from "./abi/definitions";
import { decodeEvent, LoreTag, type LoreCompletePayload, type LoreErrorPayload, type LoreEvent, type LorePathIgnorePayload } from "./events";
import { loadLoreLibrary, type LoreLibrary } from "./library";
import { loreBool, loreString } from "./values";

/**
 * The one way Studio calls Lore.
 *
 * Everything that made the SDK's call path dangerous is handled here, once:
 *
 *  - **One callback, many listeners.** The SDK's `.callback()` REPLACES the handler
 *    rather than appending, so attaching one in a wrapper and another at a call site
 *    silently drops the first - the call still returns 0 and you simply receive
 *    nothing. Exactly one native callback is registered here and events are fanned
 *    out in JS.
 *  - **No borrowed memory escapes.** Payloads are decoded and copied inside the
 *    callback (see `events.ts`), then queued. Nothing lazily reads FFI memory later.
 *  - **No re-entry.** Calling Lore from inside a callback is forbidden process-wide,
 *    so handlers run against the collected events after the call settles. The only
 *    work done inside the callback is decoding.
 *  - **Registered callbacks are always released.** koffi has a bounded pool of
 *    registered callbacks; leaking one per call exhausts it after a few thousand
 *    operations and the failure looks nothing like its cause.
 *  - **Ignored paths raise.** Lore answers a path outside the repository with
 *    success, a PATH_IGNORE event, and no work done. Left alone, that is an asset
 *    the author believes is versioned and is not.
 */

/** Global arguments every verb takes. */
export interface LoreGlobals {
    /** Repository root. Absolute; Lore resolves relative paths against the process CWD. */
    repositoryPath: string;
    /** Commit author. Lore records it verbatim. */
    identity?: string;
    /**
     * NOT a network kill switch. Most verbs honour it, but some (`repositoryInfo`)
     * still dial the remote and block until the socket times out. Anything
     * user-facing needs its own timeout regardless.
     */
    offline?: boolean;
    /**
     * Retain fragments fetched from a remote. OFF upstream by default, which makes
     * repeated diffs of the same two revisions re-fetch every time.
     */
    cache?: boolean;
    /** Keep the store open between consecutive calls instead of reopening it. */
    storeKeepAlive?: boolean;
    storeKeepAliveSeconds?: number;
    dryRun?: boolean;
    force?: boolean;
    /** Echoed into Lore's logs; useful for correlating a user action with its trace. */
    correlationId?: string;
}

export class LoreCallError extends Error {
    constructor(
        message: string,
        readonly verb: LoreVerbName,
        readonly errorCode: number | undefined,
        readonly trace: readonly string[],
    ) {
        super(message);
        this.name = "LoreCallError";
    }
}

/** Lore silently skipped a path instead of acting on it. */
export class LorePathIgnoredError extends LoreCallError {
    constructor(verb: LoreVerbName, readonly paths: readonly string[]) {
        super(`Lore ignored ${paths.length} path(s) during ${verb}: ${paths.join(", ")}`, verb, undefined, []);
        this.name = "LorePathIgnoredError";
    }
}

export interface InvokeOptions {
    /**
     * Called for each event as it is decoded, after the call settles. Use for
     * streaming/progress; the full list is returned regardless.
     */
    onEvent?: (event: LoreEvent) => void;
    /** Do not raise on PATH_IGNORE. Only for callers that genuinely tolerate skips. */
    allowIgnoredPaths?: boolean;
    /** Forward Lore's own LOG events here instead of dropping them. */
    onLog?: (message: string, level: number) => void;
}

export interface LoreCallResult {
    events: LoreEvent[];
    /** Events of one tag, typed by the caller. */
    of<T>(tag: number): T[];
    /** The single event of one tag; throws if there is not exactly one. */
    one<T>(tag: number): T;
    /** First event of one tag, or undefined. */
    first<T>(tag: number): T | undefined;
}

function buildGlobals(globals: LoreGlobals): object {
    return {
        repositoryPath: loreString(globals.repositoryPath),
        correlationId: loreString(globals.correlationId),
        identity: loreString(globals.identity),
        force: loreBool(globals.force),
        offline: loreBool(globals.offline),
        local: 0,
        remote: 0,
        dryRun: loreBool(globals.dryRun),
        noAtime: 0,
        maxConnections: 0,
        searchLimit: 0,
        searchNearest: 0,
        noGc: 0,
        inMemory: 0,
        fileCountLimit: 0,
        fileSizeLimit: 0,
        compressTaskLimit: 0,
        storeKeepAlive: loreBool(globals.storeKeepAlive),
        storeKeepAliveSeconds: globals.storeKeepAliveSeconds ?? 0,
        syncData: 0,
        cache: loreBool(globals.cache),
    };
}

/**
 * Run one verb and collect its events.
 *
 * The call runs on koffi's worker pool, so a large stage or a network fetch does not
 * block the main thread. Event callbacks are marshalled back to the JS thread by
 * koffi.
 */
export async function invoke(
    verb: LoreVerbName,
    globals: LoreGlobals,
    args: object,
    options: InvokeOptions = {},
    library: LoreLibrary = loadLoreLibrary(),
): Promise<LoreCallResult> {
    const fn = library.verb(verb);
    const globalArgs = buildGlobals(globals);

    const events: LoreEvent[] = [];
    let decodeFailure: unknown = null;

    const trampoline = (pointer: unknown) => {
        try {
            events.push(decodeEvent(library, pointer));
        } catch (error) {
            // Never let a decode failure propagate into native code: it would unwind
            // through the FFI boundary. Record it and report after the call settles.
            decodeFailure ??= error;
        }
    };

    const registered = koffi.register(trampoline, koffi.pointer(library.callbackPrototype));
    let status: number;
    try {
        status = await new Promise<number>((resolve, reject) => {
            fn.async(
                globalArgs,
                args,
                { userContext: 0, callback: registered },
                (error, result) => (error ? reject(error) : resolve(result)),
            );
        });
    } finally {
        // Unregistered only after the call settles, not on the END event: an early
        // failure never reaches END, and releasing a callback native code might still
        // hold is worse than releasing it a moment late.
        koffi.unregister(registered);
    }

    if (decodeFailure) throw decodeFailure;

    const result = makeResult(events);

    if (options.onLog) {
        for (const event of events) {
            if (event.tag === LoreTag.LOG) {
                const log = event.data as { message: string; level: number };
                options.onLog(log.message, log.level);
            }
        }
    }
    if (options.onEvent) {
        for (const event of events) options.onEvent(event);
    }

    if (status !== 0) throw describeFailure(verb, result);

    const ignored = result.of<LorePathIgnorePayload>(LoreTag.PATH_IGNORE).map((event) => event.path);
    if (ignored.length > 0 && !options.allowIgnoredPaths) {
        throw new LorePathIgnoredError(verb, ignored);
    }

    return result;
}

function makeResult(events: LoreEvent[]): LoreCallResult {
    const of = <T>(tag: number): T[] =>
        events.filter((event) => event.tag === tag && event.data !== undefined).map((event) => event.data as T);
    return {
        events,
        of,
        first: <T>(tag: number) => of<T>(tag)[0],
        one: <T>(tag: number) => {
            const matches = of<T>(tag);
            if (matches.length !== 1) {
                throw new Error(`Expected exactly 1 event with tag ${tag}, got ${matches.length}`);
            }
            return matches[0];
        },
    };
}

/**
 * Turn a non-zero return into an error that says what went wrong and where.
 *
 * Lore reports the detail through events rather than the return code: ERROR events
 * carry the message, and COMPLETE carries an error code plus Rust `file:line` trace
 * locations. Dropping those leaves "invalid arguments" with nowhere to look.
 */
function describeFailure(verb: LoreVerbName, result: LoreCallResult): LoreCallError {
    const errors = result.of<LoreErrorPayload>(LoreTag.ERROR).map((event) => event.message).filter(Boolean);
    const complete = result.first<LoreCompletePayload>(LoreTag.COMPLETE);
    const message = errors.length > 0
        ? errors.join("\n")
        : complete?.message || `${verb} failed`;
    return new LoreCallError(`${verb}: ${message}`, verb, complete?.errorCode, complete?.trace ?? []);
}
