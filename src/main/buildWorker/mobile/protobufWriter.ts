/**
 * Minimal protobuf wire-format writer - the only encoder in the .aab pipeline.
 * An App Bundle is the protobuf form of an APK, so Studio has to emit aapt2's
 * and bundletool's schemas (Resources.proto, Configuration.proto, config.proto,
 * files.proto) without taking on protobufjs or a codegen step: the whole mobile
 * build worker is dependency-free by design, and these four schemas together
 * use exactly four wire encodings.
 *
 * Proto3 semantics, and the distinction that matters most here:
 * - scalar fields equal to their default (0, false, "") are OMITTED, because a
 *   proto3 reader cannot tell an explicit default from an absent field anyway;
 * - a SUBMESSAGE is emitted whenever the caller says it is present, even when
 *   its body is empty. That is not decoration - `Entry.entry_id` and
 *   `TargetedAssetsDirectory.targeting` are both meaningful-when-empty
 *   (`EntryId{id:0}` and "no targeting" respectively), and dropping them
 *   changes what bundletool reads back.
 *
 * Only the encodings the schemas need exist: varint (uint32/int32/bool/enum),
 * length-delimited (string/bytes/message) and fixed32 (float). No maps, no
 * packed repeated fields, no groups - repeated fields are written by calling
 * the same field number more than once, which is the canonical unpacked form
 * and what aapt2 itself emits for message fields.
 */

/** Wire types, per the protobuf encoding spec. */
const WIRE_VARINT = 0;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

const MAX_UINT32 = 0xffffffff;
const MIN_INT32 = -0x80000000;
const MAX_FIELD_NUMBER = 0x1fffffff;

/** Base-128 varint of a non-negative safe integer. */
function encodeVarint(value: number): Buffer {
    const bytes: number[] = [];
    let remaining = value;
    do {
        const byte = remaining % 0x80;
        remaining = Math.floor(remaining / 0x80);
        bytes.push(remaining > 0 ? byte | 0x80 : byte);
    } while (remaining > 0);
    return Buffer.from(bytes);
}

/**
 * Varint of a signed int32. Negative values are sign-extended to 64 bits
 * first - the wire format has no short form for them, so they always occupy
 * ten bytes. (`Primitive.int_decimal_value` is the one signed field in these
 * schemas, and a binary Res_value of 0xffffffff really does mean -1 there.)
 */
function encodeSignedVarint(value: number): Buffer {
    if (value >= 0) {
        return encodeVarint(value);
    }
    let remaining = BigInt.asUintN(64, BigInt(value));
    const bytes: number[] = [];
    do {
        const byte = Number(remaining & 0x7fn);
        remaining >>= 7n;
        bytes.push(remaining > 0n ? byte | 0x80 : byte);
    } while (remaining > 0n);
    return Buffer.from(bytes);
}

function assertField(field: number): void {
    if (!Number.isInteger(field) || field < 1 || field > MAX_FIELD_NUMBER) {
        throw new Error(`Invalid protobuf field number: ${field}`);
    }
}

/**
 * Accumulates one message's fields. Methods chain; `toBuffer` returns the
 * message body (no length prefix - the parent adds that, and the top-level
 * message is the file's whole content).
 */
export class ProtoWriter {
    private readonly parts: Buffer[] = [];

    private push(field: number, wireType: number, payload: Buffer): this {
        assertField(field);
        this.parts.push(encodeVarint(field * 8 + wireType), payload);
        return this;
    }

    public uint32(field: number, value: number): this {
        if (!Number.isInteger(value) || value < 0 || value > MAX_UINT32) {
            throw new Error(`Field ${field} is not a uint32: ${value}`);
        }
        return value === 0 ? this : this.push(field, WIRE_VARINT, encodeVarint(value));
    }

    public int32(field: number, value: number): this {
        if (!Number.isInteger(value) || value < MIN_INT32 || value > 0x7fffffff) {
            throw new Error(`Field ${field} is not an int32: ${value}`);
        }
        return value === 0 ? this : this.push(field, WIRE_VARINT, encodeSignedVarint(value));
    }

    /** Enum fields are varints; the zero-valued member is always "UNSET". */
    public enumValue(field: number, value: number): this {
        return this.uint32(field, value);
    }

    public bool(field: number, value: boolean): this {
        return value ? this.push(field, WIRE_VARINT, encodeVarint(1)) : this;
    }

    public float(field: number, value: number): this {
        if (value === 0) {
            return this;
        }
        const payload = Buffer.alloc(4);
        payload.writeFloatLE(value, 0);
        return this.push(field, WIRE_FIXED32, payload);
    }

    public string(field: number, value: string): this {
        return value === "" ? this : this.bytes(field, Buffer.from(value, "utf8"));
    }

    /** Raw length-delimited bytes; an empty value is a default and is omitted. */
    public bytes(field: number, value: Buffer): this {
        if (value.length === 0) {
            return this;
        }
        return this.push(field, WIRE_LENGTH_DELIMITED, Buffer.concat([encodeVarint(value.length), value]));
    }

    /**
     * A present submessage. Always emitted, empty body included - see the file
     * header: presence is the payload for several fields in these schemas.
     */
    public message(field: number, build: (writer: ProtoWriter) => void): this {
        const body = encodeMessage(build);
        return this.push(field, WIRE_LENGTH_DELIMITED, Buffer.concat([encodeVarint(body.length), body]));
    }

    /** A present submessage whose body is already encoded. */
    public messageBytes(field: number, body: Buffer): this {
        return this.push(field, WIRE_LENGTH_DELIMITED, Buffer.concat([encodeVarint(body.length), body]));
    }

    public toBuffer(): Buffer {
        return Buffer.concat(this.parts);
    }
}

/** Encode one message body. */
export function encodeMessage(build: (writer: ProtoWriter) => void): Buffer {
    const writer = new ProtoWriter();
    build(writer);
    return writer.toBuffer();
}
