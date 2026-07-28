import koffi from "koffi";
import path from "path";

/**
 * Converting between JS values and Lore's C representations.
 *
 * This module is where the SDK's worst defect used to live, so it is worth being
 * precise about what changed.
 *
 * The SDK converts arguments through a per-function lookup table (`convertOptions`)
 * naming which fields are strings, which are hashes, and so on. The table has an
 * entry kind - `loreHash` - for which no handler was ever implemented. Those fields
 * reach koffi unconverted, and the failure is asymmetric:
 *
 *   - a hex string where bytes are wanted throws. Safe.
 *   - bytes where a hex string is wanted make `hexStringToByteArray` read `.length`
 *     off an object, get `undefined`, and return a ZERO-LENGTH array. koffi
 *     zero-fills the fixed-size field, the call SUCCEEDS, and the repository id is
 *     all zeroes. Silent data corruption.
 *
 * Here there is no table and nothing to look up. The struct field's declared type is
 * the encoding rule: a `LoreString` field takes a hex string (Lore parses it), a
 * `LoreHash` field takes 32 bytes, a `LorePartition`/`LoreContext` field takes 16.
 * That is why `LoreRevisionTreeLoadArgs` in `abi/definitions.ts` says `repository:
 * "LorePartition"` - and why {@link hashBytes} throws on malformed input rather than
 * producing a short buffer that koffi would pad out for us.
 */

/** A Lore identifier in its canonical form: lowercase hex, unprefixed. */
export type LoreHex = string;

const HEX = /^[0-9a-fA-F]*$/;

/** All-zero hashes are Lore's "absent" marker, not a real revision. */
const ZERO = /^0*$/;

export class LoreValueError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LoreValueError";
    }
}

/**
 * Bytes for a fixed-width identifier field (`LoreHash`, `LorePartition`,
 * `LoreContext`).
 *
 * Length is checked, never padded. A short value here is the exact input that used
 * to produce a silently zero-filled field, so it must be an error - a caller that
 * passes a truncated revision hash has a bug, and finding it now is far cheaper
 * than finding it as a commit written against the wrong repository.
 */
export function hashBytes(hex: LoreHex, byteLength: number, field: string): { data: Buffer } {
    if (typeof hex !== "string" || !HEX.test(hex)) {
        throw new LoreValueError(`${field} must be a hex string, got ${JSON.stringify(hex)}`);
    }
    if (hex.length !== byteLength * 2) {
        throw new LoreValueError(
            `${field} must be ${byteLength * 2} hex characters (${byteLength} bytes), got ${hex.length}`,
        );
    }
    return { data: Buffer.from(hex, "hex") };
}

/** 32-byte revision/content hash. */
export const revisionBytes = (hex: LoreHex, field = "revision") => hashBytes(hex, 32, field);
/** 16-byte repository (partition) id. */
export const partitionBytes = (hex: LoreHex, field = "repository") => hashBytes(hex, 16, field);
/** 16-byte branch/context id. */
export const contextBytes = (hex: LoreHex, field = "context") => hashBytes(hex, 16, field);

export interface LoreStringValue { string: Buffer; length: number }
export interface LoreStringArrayValue { ptr: LoreStringValue[]; count: number }

/**
 * A `LoreString`: a pointer plus a byte length, NOT a NUL-terminated C string.
 *
 * koffi does not copy Buffer arguments, so the Buffer must stay reachable until the
 * call returns or the GC can free memory the native thread is still reading. That is
 * satisfied structurally rather than by bookkeeping: the args object holds this
 * value, and `invoke` holds the args object until the call settles. Async makes it
 * sharper - the JS frame that built the arguments is long gone by then - which is
 * why nothing here hands out a bare pointer.
 */
export function loreString(value: string | undefined): LoreStringValue {
    const bytes = Buffer.from(value ?? "", "utf-8");
    return { string: bytes, length: bytes.byteLength };
}

/** A `LoreStringArray`: a pointer to `LoreString` plus a count. */
export function loreStringArray(values: readonly string[] | undefined): LoreStringArrayValue {
    const items = (values ?? []).map(loreString);
    return { ptr: items, count: items.length };
}

/** Lore's booleans are `uint8_t`. */
export const loreBool = (value: boolean | undefined): number => (value ? 1 : 0);

// -- decoding ---------------------------------------------------------------

/**
 * A decoded koffi struct. Deliberately loose: koffi returns plain objects whose
 * field types depend on the C declaration, so the decoders below narrow field by
 * field rather than pretending the whole shape is known.
 */
export type DecodedStruct = Record<string, unknown> | null | undefined;

/** Fixed-width identifier struct (`{ data: uint8_t[N] }`) to lowercase hex. */
export function decodeHash(value: DecodedStruct): LoreHex {
    const data = value?.data as ArrayLike<number> | undefined;
    if (!data) return "";
    return Buffer.from(Uint8Array.from(Array.from(data))).toString("hex");
}

/**
 * Same, but reports Lore's all-zero "absent" marker as undefined.
 *
 * Lore fills unset revision fields with zeroes rather than omitting them - a status
 * with nothing staged reports `revisionStaged` as 64 zero characters. Treating that
 * as a revision id produces lookups for a revision that cannot exist.
 */
export function decodeOptionalHash(value: DecodedStruct): LoreHex | undefined {
    const hex = decodeHash(value);
    return hex.length === 0 || ZERO.test(hex) ? undefined : hex;
}

/** `LoreString` to a JS string. Copies; the pointer is only valid during the callback. */
export function decodeString(value: DecodedStruct): string {
    if (!value?.string) return "";
    const length = Number(value.length ?? 0);
    if (length === 0) return "";
    return toBuffer(koffi.decode(value.string, "uint8_t", length)).toString("utf-8");
}

/** `LoreBytes` / `LoreBinary` payload to a Buffer. Copies, for the same reason. */
export function decodeBytes(value: DecodedStruct): Buffer {
    const pointer = value?.ptr ?? value?.payload;
    const size = Number(value?.len ?? value?.length ?? 0);
    if (!pointer || size === 0) return Buffer.alloc(0);
    return toBuffer(koffi.decode(pointer, "uint8_t", size));
}

/** Lore's 64-bit counters arrive as number or BigInt depending on magnitude. */
export const decodeCount = (value: unknown): number => Number(value ?? 0);

/**
 * koffi hands back a Buffer, a typed array, or a plain number array depending on the
 * type and version. Normalise once here rather than at every call site.
 */
function toBuffer(decoded: unknown): Buffer {
    if (Buffer.isBuffer(decoded)) return Buffer.from(decoded);
    if (decoded instanceof Uint8Array) return Buffer.from(decoded);
    if (Array.isArray(decoded)) return Buffer.from(Uint8Array.from(decoded));
    throw new LoreValueError(`Cannot read ${typeof decoded} as bytes`);
}

/**
 * Absolute path for a repository-relative one, refusing anything that escapes.
 *
 * Two Lore behaviours make this mandatory rather than defensive:
 *
 *  1. Relative paths are resolved against the PROCESS working directory, not against
 *     `repositoryPath` (`lore-revision/src/util/path.rs` calls `std::path::absolute`).
 *     An Electron main process CWD is never the project directory.
 *  2. A path outside the repository is IGNORED, not rejected: `fileStage` returns 0,
 *     emits PATH_IGNORE, and stages nothing. The error only surfaces later as
 *     "Nothing staged for commit", by which point the author believes their work is
 *     versioned and it is not.
 */
export function repositoryPath(root: string, relative: string): string {
    const absolute = path.resolve(root, relative);
    const rel = path.relative(root, absolute);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new LoreValueError(`Path escapes the repository: ${relative}`);
    }
    return absolute;
}
