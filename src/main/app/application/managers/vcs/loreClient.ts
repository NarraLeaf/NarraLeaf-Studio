import { lore } from "@lore-vcs/sdk";
import { LoreEventTag } from "@lore-vcs/sdk/types/enums";
import path from "path";

/**
 * The only module in Studio allowed to import `@lore-vcs/sdk`.
 *
 * Lore is pre-1.0 with no semver guarantee, and its JS SDK is code-generated
 * from `lore-capi/lore.h` - a header change is an SDK change. Everything the
 * rest of Studio touches goes through the narrow surface below so that an
 * upstream break has exactly one blast site.
 *
 * The encoding rules here are DERIVED from the SDK's own generator contract
 * (`lore-js/generator/templates/native.ji`), not from trial and error:
 *
 *   `convertToLoreDatatype` converts caller-supplied JS values into the C
 *   representation using a per-function `convertOptions` table. It implements
 *   handlers for loreBoolean, loreString, loreBytes, loreBinary, lorePartition,
 *   loreContext, loreAddress, arrayTypes and complexTypes.
 *
 * So the contract is: **pass plain hex strings for every identifier.**
 *
 * With one upstream defect: the generator also emits `loreHash: [...]` entries,
 * but `convertToLoreDatatype` has **no loreHash handler**. Those fields reach
 * koffi unconverted and fail with "Unexpected String value, expected object".
 * As of Lore v0.8.5 that affects exactly four calls - `revisionTreeLoad`,
 * `storageMutableLoad`, `storageMutableStore`, `storageMutableCompareAndSwap`.
 *
 * The failure mode of guessing wrong is asymmetric, which is why this is
 * centralised:
 *
 *   - hex where binary is needed  -> throws loudly. Safe.
 *   - binary where hex is needed  -> `hexStringToByteArray({data})` reads
 *     `.length` off an object, gets `undefined`, and returns a ZERO-LENGTH
 *     array. koffi zero-fills the fixed-size field. The call SUCCEEDS with an
 *     all-zero partition. Silent data corruption.
 *
 * Hence: callers always pass hex; only declared `hashArgs` are ever rewritten,
 * and only after the hex form has been observed to fail (see resolveHashCodec).
 * When upstream implements the loreHash handler, hex starts working and this
 * layer stops rewriting anything - no version sniffing required.
 */

/** A Lore identifier in its canonical form: lowercase hex, no prefix. */
export type LoreHex = string;

/** Handle types are opaque `{ handleId }` records; keep them nominal-ish. */
export interface StoreHandle { readonly handleId: number }
export interface TreeHandle { readonly handleId: number }

export interface LoreGlobals {
    repositoryPath: string;
    identity?: string;
    /**
     * NOTE: not a network kill switch. Most verbs honour it, but some
     * (`repositoryInfo`) still dial the remote and block until TCP timeout.
     * Anything user-facing needs its own timeout on top.
     */
    offline?: boolean;
    /** Keep the store open between consecutive calls instead of reopening. */
    storeKeepAlive?: boolean;
    /** Retain fragments fetched from the remote. Off by default upstream. */
    cache?: boolean;
}

/** A captured event: tag plus a deep copy of its payload. */
export interface LoreCaptured<T = unknown> {
    tag: LoreEventTag;
    data: T;
}

export class LoreCallError extends Error {
    constructor(
        message: string,
        readonly operation: string,
        readonly errorCode: number | undefined,
        readonly trace: readonly string[],
    ) {
        super(message);
        this.name = "LoreCallError";
    }
}

/** Thrown when Lore silently skipped a path instead of acting on it (see invoke). */
export class LorePathIgnoredError extends LoreCallError {
    constructor(operation: string, readonly paths: readonly string[]) {
        super(
            `Lore ignored ${paths.length} path(s) during ${operation}: ${paths.join(", ")}`,
            operation,
            undefined,
            [],
        );
        this.name = "LorePathIgnoredError";
    }
}

/** Shape of a fluent SDK executor, narrowed to what this module uses. */
interface LoreExecutor {
    callback(fn: (event: { tag: LoreEventTag; clone(): { data: unknown } }) => void): LoreExecutor;
    waitAsync(): Promise<number>;
}

type LoreOperation = (globals: object, args: object) => LoreExecutor;

export interface InvokeOptions {
    /** Only these tags are captured. Omit to capture everything except log noise. */
    capture?: readonly LoreEventTag[];
    /**
     * Arg fields declared `loreHash` by the generator. These are the only fields
     * this module will ever re-encode. See the header comment.
     */
    hashArgs?: readonly string[];
    /**
     * Lore reports an unusable path by emitting PATH_IGNORE and returning 0 -
     * `fileStage` on a bad path "succeeds" having staged nothing, and the error
     * only surfaces later as "Nothing staged for commit". Default is to raise.
     */
    allowIgnoredPaths?: boolean;
}

/**
 * Whether this SDK build needs `loreHash` args pre-encoded. Resolved lazily on
 * first observed failure and cached; a fixed SDK never leaves "hex".
 */
let hashCodec: "hex" | "binary" = "hex";

const HASH_TYPE_ERROR = "Unexpected String value, expected object";

const toBinary = (hex: LoreHex) => ({ data: Uint8Array.from(Buffer.from(hex, "hex")) });

function encodeHashArgs(args: object, hashArgs: readonly string[]): object {
    const out: Record<string, unknown> = { ...args };
    for (const field of hashArgs) {
        const value = out[field];
        if (typeof value === "string" && value.length > 0) {
            out[field] = toBinary(value);
        }
    }
    return out;
}

/**
 * Run one Lore operation and collect its events.
 *
 * Handles, in one place, four SDK behaviours that are individually easy to get
 * wrong and collectively fatal:
 *
 *  1. `.callback()` REPLACES the handler rather than appending. Attaching one
 *     here and another at the call site silently drops the first - the call
 *     still returns 0 and you simply receive no data. Exactly one is attached.
 *  2. `event.data` is borrowed FFI memory freed when the callback returns.
 *     Every captured payload is cloned.
 *  3. Re-entering Lore from inside a callback is forbidden process-wide, so
 *     events are buffered and only handed back after the call settles.
 *  4. The loreHash encoding defect described in the header.
 */
export async function invoke<T = unknown>(
    operation: LoreOperation,
    operationName: string,
    globals: LoreGlobals,
    args: object,
    options: InvokeOptions = {},
): Promise<LoreCaptured<T>[]> {
    const { capture, hashArgs = [], allowIgnoredPaths = false } = options;
    const wanted = capture ? new Set<LoreEventTag>(capture) : undefined;

    const attempt = async (encoded: object): Promise<LoreCaptured<T>[]> => {
        const captured: LoreCaptured<T>[] = [];
        const ignoredPaths: string[] = [];

        const executor = operation(globals, encoded).callback((event) => {
            // Cloning is mandatory; see (2) above.
            if (event.tag === LoreEventTag.PATH_IGNORE) {
                const data = event.clone().data as { path?: string };
                if (data?.path) ignoredPaths.push(data.path);
                return;
            }
            if (event.tag === LoreEventTag.LOG) return;
            if (wanted && !wanted.has(event.tag)) return;
            captured.push({ tag: event.tag, data: event.clone().data as T });
        });

        await executor.waitAsync();

        if (ignoredPaths.length > 0 && !allowIgnoredPaths) {
            throw new LorePathIgnoredError(operationName, ignoredPaths);
        }
        return captured;
    };

    try {
        return await attempt(hashCodec === "binary" && hashArgs.length > 0
            ? encodeHashArgs(args, hashArgs)
            : args);
    } catch (error) {
        // A hex hash rejected by an SDK without the loreHash handler. Latch the
        // binary codec and retry once. Only ever triggered for declared hash
        // fields, so no other argument can be silently rewritten.
        if (
            hashCodec === "hex"
            && hashArgs.length > 0
            && error instanceof Error
            && error.message.includes(HASH_TYPE_ERROR)
        ) {
            hashCodec = "binary";
            return attempt(encodeHashArgs(args, hashArgs));
        }
        throw enrich(error, operationName);
    }
}

/** Convenience: run an operation and return the payloads of one tag. */
export async function invokeFor<T>(
    operation: LoreOperation,
    operationName: string,
    globals: LoreGlobals,
    args: object,
    tag: LoreEventTag,
    options: Omit<InvokeOptions, "capture"> = {},
): Promise<T[]> {
    const events = await invoke<T>(operation, operationName, globals, args, { ...options, capture: [tag] });
    return events.map((e) => e.data);
}

/** Same, but requires exactly one event and returns it. */
export async function invokeOne<T>(
    operation: LoreOperation,
    operationName: string,
    globals: LoreGlobals,
    args: object,
    tag: LoreEventTag,
    options: Omit<InvokeOptions, "capture"> = {},
): Promise<T> {
    const results = await invokeFor<T>(operation, operationName, globals, args, tag, options);
    if (results.length !== 1) {
        throw new LoreCallError(
            `${operationName} produced ${results.length} ${LoreEventTag[tag]} events, expected 1`,
            operationName,
            undefined,
            [],
        );
    }
    return results[0];
}

function enrich(error: unknown, operationName: string): Error {
    if (error instanceof LoreCallError) return error;
    if (!(error instanceof Error)) return new Error(String(error));

    // The SDK's LoreError carries the COMPLETE event's error detail, which
    // includes Rust file:line trace locations. Surfacing them turns an opaque
    // "invalid arguments" into something actionable.
    const detail = (error as { completeError?: { errorCode?: number; traceLocations?: { file?: string; line?: number }[] } }).completeError;
    const trace = (detail?.traceLocations ?? [])
        .map((t) => `${t.file ?? "?"}:${t.line ?? 0}`)
        .filter((s) => s !== "?:0");
    return new LoreCallError(`${operationName}: ${error.message}`, operationName, detail?.errorCode, trace);
}

/**
 * Lore resolves relative paths against the PROCESS working directory, not
 * against `repositoryPath` (`lore-revision/src/util/path.rs` calls
 * `std::path::absolute`). An Electron main process CWD is never the project
 * directory, and a path that lands outside the repository is *ignored*, not
 * rejected. Every path handed to Lore goes through here.
 */
export function repoPath(repositoryRoot: string, relative: string): string {
    const absolute = path.resolve(repositoryRoot, relative);
    const rel = path.relative(repositoryRoot, absolute);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`Path escapes the repository: ${relative}`);
    }
    return absolute;
}

/**
 * The SDK's operation table, narrowed to the call shape `invoke` needs.
 *
 * Deliberately not `export const sdk = lore`: the SDK's own type references a
 * non-exported symbol, so re-exporting it verbatim breaks declaration emit
 * ("has or is using name 'STATE' ... but cannot be named"). Narrowing to
 * LoreOperation is also the honest type - every call goes through `invoke`, and
 * nothing here should be reaching for the fluent helpers directly.
 */
export type LoreSdk = Record<keyof typeof lore, LoreOperation>;
export const sdk = lore as unknown as LoreSdk;
export { LoreEventTag };

/** Test seam: reset the latched codec so a suite can exercise both paths. */
export function __resetHashCodecForTests(): void {
    hashCodec = "hex";
}

/**
 * Test seam: which codec is currently latched. A suite should assert this flips
 * to "binary" on today's SDK - and, once upstream implements the loreHash
 * handler, that it stays "hex". That assertion is the upgrade tripwire.
 */
export function __hashCodecForTests(): "hex" | "binary" {
    return hashCodec;
}
