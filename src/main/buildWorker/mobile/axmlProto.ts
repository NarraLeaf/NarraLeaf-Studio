/**
 * Binary AndroidManifest.xml → aapt.pb.XmlNode converter for the .aab build.
 * Pure: Buffer in → protobuf Buffer out, no fs.
 *
 * An App Bundle stores the manifest as proto XML, so the shell template's
 * compiled AXML has to be re-expressed rather than copied. The caller patches
 * identity first (repackApk's patchBinaryManifest, unchanged) and hands the
 * patched bytes here, so package name / label / versionCode / versionName
 * arrive already rewritten and this module never has to know about them.
 *
 * The chunk walker and string-pool decoder come from axml.ts - one decoder for
 * both the APK and the AAB path, because the pool's two varint length forms
 * are precisely the detail that rots when copied.
 *
 * Two conversion rules are aapt2's, not ours, and both are load-bearing:
 * - an attribute whose binary value type is STRING keeps its text in `value`
 *   and gets NO compiled_item (a compiled string would make aapt2's own
 *   converter and ours disagree on every label in the file);
 * - `source` is written on an attribute only when a compiled_item exists,
 *   which is why string attributes carry neither.
 */

import {
    parseStringPool,
    readChunk,
    RES_STRING_POOL_TYPE,
    RES_XML_RESOURCE_MAP_TYPE,
    RES_XML_START_ELEMENT_TYPE,
    RES_XML_TYPE,
    type Chunk,
    type StringPool,
} from "./axml";
import { encodePrimitiveItem, RES_VALUE_TYPE_STRING } from "./arscProto";
import { encodeMessage, ProtoWriter } from "./protobufWriter";

const RES_XML_START_NAMESPACE_TYPE = 0x0100;
const RES_XML_END_NAMESPACE_TYPE = 0x0101;
const RES_XML_END_ELEMENT_TYPE = 0x0103;
const RES_XML_CDATA_TYPE = 0x0104;

const NO_ENTRY = 0xffffffff;

/** ResXMLTree_attribute is a fixed 20-byte struct; sizes come from the header. */
const ATTRIBUTE_DATA_TYPE_OFFSET = 15;
const ATTRIBUTE_DATA_OFFSET = 16;

type ProtoNamespace = { prefix: string; uri: string; line: number };

type ProtoAttribute = {
    namespaceUri: string;
    name: string;
    value: string;
    resourceId: number;
    /** Encoded aapt.pb.Item, absent for string-valued attributes. */
    compiledItem?: Buffer;
};

type ProtoElement = {
    namespaceUri: string;
    name: string;
    line: number;
    namespaces: ProtoNamespace[];
    attributes: ProtoAttribute[];
    children: ProtoNode[];
};

type ProtoNode =
    | { kind: "element"; element: ProtoElement }
    | { kind: "text"; text: string; line: number };

function poolString(pool: StringPool, index: number): string {
    if (index === NO_ENTRY) {
        return "";
    }
    const value = pool.strings[index];
    if (value === undefined) {
        throw new Error(`Binary XML references string ${index}, which is not in the pool`);
    }
    return value;
}

function parseAttributes(
    axml: Buffer,
    chunk: Chunk,
    pool: StringPool,
    resourceIdByPoolIndex: Map<number, number>,
): ProtoAttribute[] {
    const ext = chunk.start + chunk.headerSize;
    const attributeStart = axml.readUInt16LE(ext + 8);
    const attributeSize = axml.readUInt16LE(ext + 10);
    const attributeCount = axml.readUInt16LE(ext + 12);

    const attributes: ProtoAttribute[] = [];
    for (let i = 0; i < attributeCount; i++) {
        const offset = ext + attributeStart + i * attributeSize;
        const nameIndex = axml.readUInt32LE(offset + 4);
        const rawValueIndex = axml.readUInt32LE(offset + 8);
        const dataType = axml.readUInt8(offset + ATTRIBUTE_DATA_TYPE_OFFSET);
        const data = axml.readUInt32LE(offset + ATTRIBUTE_DATA_OFFSET);
        // A string attribute's text is the raw value when the compiler kept
        // one and the typed value's pool index otherwise; a typed attribute
        // has no text at all unless the compiler preserved the source form.
        const value = dataType === RES_VALUE_TYPE_STRING && rawValueIndex === NO_ENTRY
            ? poolString(pool, data)
            : poolString(pool, rawValueIndex);
        attributes.push({
            namespaceUri: poolString(pool, axml.readUInt32LE(offset)),
            name: poolString(pool, nameIndex),
            value,
            resourceId: resourceIdByPoolIndex.get(nameIndex) ?? 0,
            ...(dataType === RES_VALUE_TYPE_STRING ? {} : { compiledItem: encodePrimitiveItem({ dataType, data }) }),
        });
    }
    return attributes;
}

/**
 * Walk the chunk stream into a node tree. Namespace declarations precede the
 * element that owns them in the binary form, so they are held until the next
 * start tag - the same rule aapt2's own inflater uses.
 */
function parseTree(axml: Buffer): ProtoNode {
    const root = readChunk(axml, 0);
    if (root.type !== RES_XML_TYPE) {
        throw new Error("Not a binary AndroidManifest.xml (missing RES_XML header)");
    }

    const chunks: Chunk[] = [];
    let cursor = root.headerSize;
    while (cursor < root.size) {
        const chunk = readChunk(axml, cursor);
        chunks.push(chunk);
        cursor += chunk.size;
    }

    const poolChunk = chunks.find(chunk => chunk.type === RES_STRING_POOL_TYPE);
    if (!poolChunk) {
        throw new Error("AXML string pool missing");
    }
    const pool = parseStringPool(axml, poolChunk);

    const resourceIdByPoolIndex = new Map<number, number>();
    const mapChunk = chunks.find(chunk => chunk.type === RES_XML_RESOURCE_MAP_TYPE);
    if (mapChunk) {
        const count = (mapChunk.size - mapChunk.headerSize) / 4;
        for (let i = 0; i < count; i++) {
            resourceIdByPoolIndex.set(i, axml.readUInt32LE(mapChunk.start + mapChunk.headerSize + i * 4));
        }
    }

    const stack: ProtoElement[] = [];
    let pendingNamespaces: ProtoNamespace[] = [];
    let rootNode: ProtoNode | undefined;

    const attach = (node: ProtoNode) => {
        const parent = stack[stack.length - 1];
        if (parent) {
            parent.children.push(node);
        } else if (rootNode) {
            throw new Error("Binary XML has more than one root element");
        } else {
            rootNode = node;
        }
    };

    for (const chunk of chunks) {
        const ext = chunk.start + chunk.headerSize;
        const line = chunk.type === RES_STRING_POOL_TYPE || chunk.type === RES_XML_RESOURCE_MAP_TYPE
            ? 0
            : axml.readUInt32LE(chunk.start + 8);
        switch (chunk.type) {
            case RES_XML_START_NAMESPACE_TYPE:
                pendingNamespaces.push({
                    prefix: poolString(pool, axml.readUInt32LE(ext)),
                    uri: poolString(pool, axml.readUInt32LE(ext + 4)),
                    line,
                });
                break;
            case RES_XML_START_ELEMENT_TYPE: {
                const element: ProtoElement = {
                    namespaceUri: poolString(pool, axml.readUInt32LE(ext)),
                    name: poolString(pool, axml.readUInt32LE(ext + 4)),
                    line,
                    namespaces: pendingNamespaces,
                    attributes: parseAttributes(axml, chunk, pool, resourceIdByPoolIndex),
                    children: [],
                };
                pendingNamespaces = [];
                stack.push(element);
                break;
            }
            case RES_XML_END_ELEMENT_TYPE: {
                const element = stack.pop();
                if (!element) {
                    throw new Error("Binary XML has an end tag with no matching start tag");
                }
                attach({ kind: "element", element });
                break;
            }
            case RES_XML_CDATA_TYPE:
                attach({ kind: "text", text: poolString(pool, axml.readUInt32LE(ext)), line });
                break;
            case RES_XML_END_NAMESPACE_TYPE:
            case RES_STRING_POOL_TYPE:
            case RES_XML_RESOURCE_MAP_TYPE:
                break;
            default:
                throw new Error(`Unsupported binary XML chunk 0x${chunk.type.toString(16)}`);
        }
    }

    if (stack.length > 0) {
        throw new Error("Binary XML ends inside an unclosed element");
    }
    if (!rootNode) {
        throw new Error("Binary XML has no root element");
    }
    return rootNode;
}

/* --------------------------------------------------------------- encoding */

function encodeSourcePosition(writer: ProtoWriter, field: number, line: number): void {
    writer.message(field, position => position.uint32(1, line));
}

function encodeElement(writer: ProtoWriter, element: ProtoElement): void {
    for (const namespace of element.namespaces) {
        writer.message(1, pb => {
            pb.string(1, namespace.prefix);
            pb.string(2, namespace.uri);
            encodeSourcePosition(pb, 3, namespace.line);
        });
    }
    writer.string(2, element.namespaceUri);
    writer.string(3, element.name);
    for (const attribute of element.attributes) {
        writer.message(4, pb => {
            pb.string(1, attribute.namespaceUri);
            pb.string(2, attribute.name);
            pb.string(3, attribute.value);
            if (attribute.compiledItem) {
                encodeSourcePosition(pb, 4, 0);
            }
            pb.uint32(5, attribute.resourceId);
            if (attribute.compiledItem) {
                pb.messageBytes(6, attribute.compiledItem);
            }
        });
    }
    for (const child of element.children) {
        writer.messageBytes(5, encodeNode(child));
    }
}

function encodeNode(node: ProtoNode): Buffer {
    return encodeMessage(writer => {
        if (node.kind === "text") {
            writer.string(2, node.text);
            encodeSourcePosition(writer, 3, node.line);
            return;
        }
        writer.message(1, element => encodeElement(element, node.element));
        encodeSourcePosition(writer, 3, node.element.line);
    });
}

/** Patched binary AndroidManifest.xml bytes → aapt.pb.XmlNode bytes. */
export function convertBinaryManifestToProto(axml: Buffer): Buffer {
    return encodeNode(parseTree(axml));
}
