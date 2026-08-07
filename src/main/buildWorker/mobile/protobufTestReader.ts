/**
 * Protobuf decoder and schema summarizers for the .aab tests. Only tests
 * import this; it never reaches the shipped bundle.
 *
 * Deliberately an independent implementation rather than a mirror of
 * protobufWriter.ts: a decoder derived from the encoder under test would agree
 * with it about a wrong wire format, which is exactly the class of bug these
 * tests exist to catch. The summarizers go one step further and project a
 * ResourceTable or an XmlNode down to what it MEANS - types, entries,
 * configurations, values - dropping the empty `Source` messages aapt2 sprinkles
 * everywhere. That projection is what makes "semantically equivalent to
 * aapt2's own conversion" an assertable statement instead of a byte diff that
 * would fail for reasons nobody cares about.
 */

export type ProtoValue =
    | { wire: "varint"; value: bigint }
    | { wire: "fixed32"; value: Buffer }
    | { wire: "bytes"; value: Buffer };

/** One decoded message: field number → the values written for it, in order. */
export type ProtoMessage = Map<number, ProtoValue[]>;

export function decodeMessage(buffer: Buffer): ProtoMessage {
    const fields: ProtoMessage = new Map();
    let cursor = 0;
    const varint = (): bigint => {
        let result = 0n;
        let shift = 0n;
        for (;;) {
            if (cursor >= buffer.length) {
                throw new Error("Truncated protobuf varint");
            }
            const byte = buffer[cursor++];
            result |= BigInt(byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) {
                return result;
            }
            shift += 7n;
        }
    };
    const push = (field: number, value: ProtoValue) => {
        const list = fields.get(field);
        if (list) {
            list.push(value);
        } else {
            fields.set(field, [value]);
        }
    };

    while (cursor < buffer.length) {
        const tag = Number(varint());
        const field = tag >>> 3;
        const wireType = tag & 7;
        if (field === 0) {
            throw new Error("Protobuf field number 0 is not valid");
        }
        switch (wireType) {
            case 0:
                push(field, { wire: "varint", value: varint() });
                break;
            case 2: {
                const length = Number(varint());
                if (cursor + length > buffer.length) {
                    throw new Error("Truncated length-delimited protobuf field");
                }
                push(field, { wire: "bytes", value: buffer.subarray(cursor, cursor + length) });
                cursor += length;
                break;
            }
            case 5:
                push(field, { wire: "fixed32", value: buffer.subarray(cursor, cursor + 4) });
                cursor += 4;
                break;
            default:
                throw new Error(`Unsupported protobuf wire type ${wireType}`);
        }
    }
    return fields;
}

export function has(message: ProtoMessage, field: number): boolean {
    return message.has(field);
}

export function uintAt(message: ProtoMessage, field: number): number {
    const values = message.get(field);
    if (!values) {
        return 0;
    }
    const [first] = values;
    if (first.wire !== "varint") {
        throw new Error(`Field ${field} is not a varint`);
    }
    return Number(first.value);
}

export function intAt(message: ProtoMessage, field: number): number {
    const values = message.get(field);
    if (!values) {
        return 0;
    }
    const [first] = values;
    if (first.wire !== "varint") {
        throw new Error(`Field ${field} is not a varint`);
    }
    return Number(BigInt.asIntN(64, first.value));
}

export function boolAt(message: ProtoMessage, field: number): boolean {
    return uintAt(message, field) !== 0;
}

export function floatAt(message: ProtoMessage, field: number): number {
    const values = message.get(field);
    if (!values) {
        return 0;
    }
    const [first] = values;
    if (first.wire !== "fixed32") {
        throw new Error(`Field ${field} is not a fixed32`);
    }
    return first.value.readFloatLE(0);
}

export function stringAt(message: ProtoMessage, field: number): string {
    return bytesAt(message, field).toString("utf8");
}

export function bytesAt(message: ProtoMessage, field: number): Buffer {
    const values = message.get(field);
    if (!values) {
        return Buffer.alloc(0);
    }
    const [first] = values;
    if (first.wire !== "bytes") {
        throw new Error(`Field ${field} is not length-delimited`);
    }
    return first.value;
}

export function messageAt(message: ProtoMessage, field: number): ProtoMessage | undefined {
    return message.has(field) ? decodeMessage(bytesAt(message, field)) : undefined;
}

export function repeatedAt(message: ProtoMessage, field: number): ProtoMessage[] {
    return (message.get(field) ?? []).map(value => {
        if (value.wire !== "bytes") {
            throw new Error(`Field ${field} is not a repeated message`);
        }
        return decodeMessage(value.value);
    });
}

/* --------------------------------------------------- aapt.pb summarizers */

const FILE_TYPE_NAMES = ["unknown", "png", "binary_xml", "proto_xml"];

/** aapt.pb.Item → a short, comparable, human-readable form. */
export function summarizeItem(item: ProtoMessage): string {
    const reference = messageAt(item, 1);
    if (reference) {
        const kind = uintAt(reference, 1) === 1 ? "attr" : "ref";
        const name = stringAt(reference, 3);
        if (!has(reference, 2) && !name) {
            return "ref:null";
        }
        return name ? `${kind}:@${name}` : `${kind}:0x${uintAt(reference, 2).toString(16).padStart(8, "0")}`;
    }
    if (has(item, 2)) {
        return `str:${stringAt(messageAt(item, 2)!, 1)}`;
    }
    if (has(item, 3)) {
        return `raw:${stringAt(messageAt(item, 3)!, 1)}`;
    }
    if (has(item, 5)) {
        const file = messageAt(item, 5)!;
        return `file:${stringAt(file, 1)}:${FILE_TYPE_NAMES[uintAt(file, 2)] ?? uintAt(file, 2)}`;
    }
    if (has(item, 6)) {
        return "id";
    }
    if (has(item, 7)) {
        return summarizePrimitive(messageAt(item, 7)!);
    }
    return "?";
}

function summarizePrimitive(prim: ProtoMessage): string {
    const hex = (field: number) => `0x${uintAt(prim, field).toString(16).padStart(8, "0")}`;
    if (has(prim, 1)) {
        return "null";
    }
    if (has(prim, 2)) {
        return "empty";
    }
    if (has(prim, 3)) {
        return `float:${floatAt(prim, 3)}`;
    }
    if (has(prim, 13)) {
        return `dimension:${hex(13)}`;
    }
    if (has(prim, 14)) {
        return `fraction:${hex(14)}`;
    }
    if (has(prim, 7)) {
        return `hex:${hex(7)}`;
    }
    if (has(prim, 8)) {
        return `bool:${boolAt(prim, 8)}`;
    }
    for (const [field, name] of [[9, "argb8"], [10, "rgb8"], [11, "argb4"], [12, "rgb4"]] as const) {
        if (has(prim, field)) {
            return `${name}:${hex(field)}`;
        }
    }
    // int_decimal last: proto3 omits it when zero, so an all-default Primitive
    // decodes as "int:0", which is what a zeroed Res_value actually means.
    return `int:${intAt(prim, 6)}`;
}

const PLURAL_ARITIES = ["zero", "one", "two", "few", "many", "other"];

/** aapt.pb.CompoundValue → a short, comparable form. */
export function summarizeCompound(compound: ProtoMessage): string {
    /** A Reference submessage rendered as its resource id. */
    const referenceId = (message: ProtoMessage, field: number) =>
        `0x${uintAt(decodeMessage(bytesAt(message, field)), 2).toString(16).padStart(8, "0")}`;

    const attribute = messageAt(compound, 1);
    if (attribute) {
        const symbols = repeatedAt(attribute, 4)
            .map(symbol => `${referenceId(symbol, 3)}=${uintAt(symbol, 4)}`);
        return `attr(format=0x${uintAt(attribute, 1).toString(16)},min=${intAt(attribute, 2)},max=${intAt(attribute, 3)})`
            + (symbols.length ? `[${symbols.join(",")}]` : "");
    }
    const style = messageAt(compound, 2);
    if (style) {
        const parent = has(style, 1) ? referenceId(style, 1) : "none";
        const entries = repeatedAt(style, 3)
            .map(entry => `${referenceId(entry, 3)}=${summarizeItem(messageAt(entry, 4)!)}`);
        return `style(parent=${parent}){${entries.join(",")}}`;
    }
    const array = messageAt(compound, 4);
    if (array) {
        return `array[${repeatedAt(array, 1).map(element => summarizeItem(messageAt(element, 3)!)).join(",")}]`;
    }
    const plural = messageAt(compound, 5);
    if (plural) {
        const entries = repeatedAt(plural, 1)
            .map(entry => `${PLURAL_ARITIES[uintAt(entry, 3)]}=${summarizeItem(messageAt(entry, 4)!)}`);
        return `plural{${entries.join(",")}}`;
    }
    return "?";
}

const CONFIGURATION_FIELDS: readonly (readonly [number, string])[] = [
    [1, "mcc"], [2, "mnc"], [3, "locale"], [4, "layoutDirection"],
    [5, "screenWidth"], [6, "screenHeight"], [7, "screenWidthDp"], [8, "screenHeightDp"],
    [9, "smallestScreenWidthDp"], [10, "screenLayoutSize"], [11, "screenLayoutLong"],
    [12, "screenRound"], [13, "wideColorGamut"], [14, "hdr"], [15, "orientation"],
    [16, "uiModeType"], [17, "uiModeNight"], [18, "density"], [19, "touchscreen"],
    [20, "keysHidden"], [21, "keyboard"], [22, "navHidden"], [23, "navigation"], [24, "sdkVersion"],
];

/** aapt.pb.Configuration → "density=160,locale=en-US", or "(default)". */
export function summarizeConfiguration(config: ProtoMessage): string {
    const parts: string[] = [];
    for (const [field, name] of CONFIGURATION_FIELDS) {
        if (!has(config, field)) {
            continue;
        }
        parts.push(`${name}=${field === 3 ? stringAt(config, 3) : uintAt(config, field)}`);
    }
    return parts.length ? parts.join(",") : "(default)";
}

export type ResourceEntrySummary = {
    id: number;
    name: string;
    values: { config: string; value: string }[];
};

export type ResourceTableSummary = {
    packages: {
        id: number;
        name: string;
        types: { id: number; name: string; entries: ResourceEntrySummary[] }[];
    }[];
};

/** aapt.pb.ResourceTable → the projection two converters must agree on. */
export function summarizeResourceTable(bytes: Buffer): ResourceTableSummary {
    return {
        packages: repeatedAt(decodeMessage(bytes), 2).map(pkg => ({
            id: uintAt(messageAt(pkg, 1) ?? new Map(), 1),
            name: stringAt(pkg, 2),
            types: repeatedAt(pkg, 3).map(type => ({
                id: uintAt(messageAt(type, 1) ?? new Map(), 1),
                name: stringAt(type, 2),
                entries: repeatedAt(type, 3).map(entry => ({
                    id: uintAt(messageAt(entry, 1) ?? new Map(), 1),
                    name: stringAt(entry, 2),
                    values: repeatedAt(entry, 6).map(configValue => {
                        const value = messageAt(configValue, 2)!;
                        return {
                            config: summarizeConfiguration(messageAt(configValue, 1) ?? new Map()),
                            value: has(value, 4)
                                ? summarizeItem(messageAt(value, 4)!)
                                : summarizeCompound(messageAt(value, 5)!),
                        };
                    }),
                })),
            })),
        })),
    };
}

export type XmlAttributeSummary = {
    namespaceUri: string;
    name: string;
    value: string;
    resourceId: string;
    item?: string;
};

export type XmlElementSummary = {
    name: string;
    namespaceUri: string;
    namespaces: { prefix: string; uri: string }[];
    attributes: XmlAttributeSummary[];
    children: (XmlElementSummary | { text: string })[];
};

/**
 * aapt.pb.XmlNode → the projection two converters must agree on. Source
 * positions are excluded: they are provenance, not meaning.
 */
export function summarizeXmlNode(bytes: Buffer): XmlElementSummary | { text: string } {
    const node = decodeMessage(bytes);
    const element = messageAt(node, 1);
    if (!element) {
        return { text: stringAt(node, 2) };
    }
    return {
        name: stringAt(element, 3),
        namespaceUri: stringAt(element, 2),
        namespaces: repeatedAt(element, 1).map(namespace => ({
            prefix: stringAt(namespace, 1),
            uri: stringAt(namespace, 2),
        })),
        attributes: repeatedAt(element, 4).map(attribute => ({
            namespaceUri: stringAt(attribute, 1),
            name: stringAt(attribute, 2),
            value: stringAt(attribute, 3),
            resourceId: `0x${uintAt(attribute, 5).toString(16).padStart(8, "0")}`,
            ...(has(attribute, 6) ? { item: summarizeItem(messageAt(attribute, 6)!) } : {}),
        })),
        children: (element.get(5) ?? []).map(child => {
            if (child.wire !== "bytes") {
                throw new Error("XmlElement.child is not a message");
            }
            return summarizeXmlNode(child.value);
        }),
    };
}
