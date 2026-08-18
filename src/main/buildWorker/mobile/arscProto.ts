/**
 * resources.arsc → aapt.pb.ResourceTable converter for the .aab build. Pure:
 * Buffer in → protobuf Buffer out, no fs.
 *
 * An App Bundle carries resources as protobuf, not as a binary table, so this
 * is a full ARSC parse - string pools, the package header's type/key pools,
 * type-spec and type chunks, entries, Res_value, ResTable_map compound values
 * and the ResTable_config struct. arsc.ts deliberately parses none of that (it
 * only overwrites the package-name slot in place, which needs no model of the
 * table); the .aab has to re-express every value, so it needs the real one.
 *
 * The one structural surprise: ARSC nests config INSIDE type (one type chunk
 * per configuration, each holding that config's entries), while the proto
 * nests config inside ENTRY (one Entry per resource, holding a repeated
 * ConfigValue). So the parse regroups - every type chunk that carries entry id
 * E contributes one ConfigValue to the single Entry E.
 *
 * Value mapping follows aapt2's own binary→proto rules rather than inventing
 * one, because bundletool and the platform read the result: a string whose
 * type is not `string` and whose text starts with "res/" is a FileReference,
 * not a String; a reference whose data is 0 is the magic @null reference and
 * loses its id AND its type; a compound value's concrete kind (style, array,
 * plural, attr) is decided by the TYPE NAME, since the binary form is the same
 * ResTable_map for all of them.
 */

import { encodeMessage, ProtoWriter } from "./protobufWriter";
import {
  parseStringPool,
  readChunk,
  RES_STRING_POOL_TYPE,
  type Chunk,
  type StringPool
} from "./axml";

const RES_TABLE_TYPE = 0x0002;
const RES_TABLE_PACKAGE_TYPE = 0x0200;
const RES_TABLE_TYPE_TYPE = 0x0201;
const RES_TABLE_TYPE_SPEC_TYPE = 0x0202;

/** ResTable_type header flags. */
const TYPE_FLAG_SPARSE = 0x01;
const TYPE_FLAG_OFFSET16 = 0x02;

/** ResTable_entry flags. */
const ENTRY_FLAG_COMPLEX = 0x0001;
const ENTRY_FLAG_PUBLIC = 0x0002;
const ENTRY_FLAG_COMPACT = 0x0008;

const NO_ENTRY = 0xffffffff;
const NO_ENTRY16 = 0xffff;

/** Res_value dataType codes (ResourceTypes.h). */
export const RES_VALUE_TYPE_NULL = 0x00;
export const RES_VALUE_TYPE_REFERENCE = 0x01;
export const RES_VALUE_TYPE_ATTRIBUTE = 0x02;
export const RES_VALUE_TYPE_STRING = 0x03;
export const RES_VALUE_TYPE_FLOAT = 0x04;
export const RES_VALUE_TYPE_DIMENSION = 0x05;
export const RES_VALUE_TYPE_FRACTION = 0x06;
export const RES_VALUE_TYPE_DYNAMIC_REFERENCE = 0x07;
export const RES_VALUE_TYPE_DYNAMIC_ATTRIBUTE = 0x08;
export const RES_VALUE_TYPE_INT_DEC = 0x10;
export const RES_VALUE_TYPE_INT_HEX = 0x11;
export const RES_VALUE_TYPE_INT_BOOLEAN = 0x12;
export const RES_VALUE_TYPE_INT_COLOR_ARGB8 = 0x1c;
export const RES_VALUE_TYPE_INT_COLOR_RGB8 = 0x1d;
export const RES_VALUE_TYPE_INT_COLOR_ARGB4 = 0x1e;
export const RES_VALUE_TYPE_INT_COLOR_RGB4 = 0x1f;

/** Res_value.data for TYPE_NULL: undefined vs. the explicit @empty. */
const DATA_NULL_EMPTY = 1;

/** ResTable_map.name values below this are the internal attr/plural keys. */
const RES_TABLE_MAP_INTERNAL = 0x01000000;
const ATTR_TYPE = RES_TABLE_MAP_INTERNAL | 0;
const ATTR_MIN = RES_TABLE_MAP_INTERNAL | 1;
const ATTR_MAX = RES_TABLE_MAP_INTERNAL | 2;
const ATTR_L10N = RES_TABLE_MAP_INTERNAL | 3;
const ATTR_OTHER = RES_TABLE_MAP_INTERNAL | 4;
const ATTR_MANY = RES_TABLE_MAP_INTERNAL | 9;

/** aapt.pb.FileReference.Type. */
const FILE_TYPE_PNG = 1;
const FILE_TYPE_BINARY_XML = 2;

/** aapt.pb.Reference.Type. */
const REFERENCE_TYPE_ATTRIBUTE = 1;

/** aapt.pb.Visibility.Level. */
const VISIBILITY_PUBLIC = 2;

export type ResValue = { dataType: number; data: number };

/**
 * The dataType-driven half of the Res_value → aapt.pb.Item mapping: every
 * concrete type EXCEPT string. Strings need the owning pool and, inside a
 * resource table, the "res/… is really a file" rule, so both callers handle
 * TYPE_STRING themselves - and for a binary XML attribute "no primitive item"
 * is exactly right, since aapt2 leaves string-valued attributes uncompiled.
 */
export function encodePrimitiveItem(value: ResValue): Buffer | undefined {
  const { dataType, data } = value;
  switch (dataType) {
    case RES_VALUE_TYPE_STRING:
      return undefined;
    case RES_VALUE_TYPE_REFERENCE:
    case RES_VALUE_TYPE_ATTRIBUTE:
    case RES_VALUE_TYPE_DYNAMIC_REFERENCE:
    case RES_VALUE_TYPE_DYNAMIC_ATTRIBUTE: {
      const isAttribute =
        dataType === RES_VALUE_TYPE_ATTRIBUTE || dataType === RES_VALUE_TYPE_DYNAMIC_ATTRIBUTE;
      const isDynamic =
        dataType === RES_VALUE_TYPE_DYNAMIC_REFERENCE ||
        dataType === RES_VALUE_TYPE_DYNAMIC_ATTRIBUTE;
      return encodeMessage((item) =>
        item.message(1, (reference) => {
          // data 0 is the magic @null reference: it keeps neither an id
          // nor a kind, which is why this drops both rather than writing
          // an ATTRIBUTE reference pointing at 0x00000000.
          if (data === 0) {
            return;
          }
          if (isAttribute) {
            reference.enumValue(1, REFERENCE_TYPE_ATTRIBUTE);
          }
          reference.uint32(2, data);
          if (isDynamic) {
            reference.message(5, (dynamic) => dynamic.bool(1, true));
          }
        })
      );
    }
    default:
      return encodeMessage((item) =>
        item.message(7, (prim) => encodePrimitiveBody(prim, dataType, data))
      );
  }
}

function encodePrimitiveBody(prim: ProtoWriter, dataType: number, data: number): void {
  switch (dataType) {
    case RES_VALUE_TYPE_NULL:
      // Both members are empty messages; presence is the whole signal.
      prim.message(data === DATA_NULL_EMPTY ? 2 : 1, () => undefined);
      return;
    case RES_VALUE_TYPE_FLOAT: {
      // The data word IS the IEEE-754 bit pattern; reinterpret, do not
      // convert (and do it through an explicit LE buffer rather than a
      // typed-array view, whose byte order is the host's).
      const bits = Buffer.alloc(4);
      bits.writeUInt32LE(data, 0);
      prim.float(3, bits.readFloatLE(0));
      return;
    }
    case RES_VALUE_TYPE_DIMENSION:
      prim.uint32(13, data);
      return;
    case RES_VALUE_TYPE_FRACTION:
      prim.uint32(14, data);
      return;
    case RES_VALUE_TYPE_INT_DEC:
      prim.int32(6, data | 0);
      return;
    case RES_VALUE_TYPE_INT_HEX:
      prim.uint32(7, data);
      return;
    case RES_VALUE_TYPE_INT_BOOLEAN:
      prim.bool(8, data !== 0);
      return;
    case RES_VALUE_TYPE_INT_COLOR_ARGB8:
      prim.uint32(9, data);
      return;
    case RES_VALUE_TYPE_INT_COLOR_RGB8:
      prim.uint32(10, data);
      return;
    case RES_VALUE_TYPE_INT_COLOR_ARGB4:
      prim.uint32(11, data);
      return;
    case RES_VALUE_TYPE_INT_COLOR_RGB4:
      prim.uint32(12, data);
      return;
    default:
      throw new Error(
        `Unsupported Res_value dataType 0x${dataType.toString(16)} in the resource table`
      );
  }
}

/* ----------------------------------------------------------------- config */

/**
 * The subset of ResTable_config this reader models. Field offsets are fixed by
 * the struct; a config chunk declares its own size and older tables simply
 * stop early, so every read is guarded by that size.
 */
type ArscConfig = {
  mcc: number;
  mnc: number;
  language: string;
  country: string;
  orientation: number;
  touchscreen: number;
  density: number;
  keyboard: number;
  navigation: number;
  inputFlags: number;
  screenWidth: number;
  screenHeight: number;
  sdkVersion: number;
  screenLayout: number;
  uiMode: number;
  smallestScreenWidthDp: number;
  screenWidthDp: number;
  screenHeightDp: number;
  localeScript: string;
  localeVariant: string;
  localeScriptWasComputed: boolean;
  screenLayout2: number;
  colorMode: number;
};

/**
 * Two- and three-letter language/region codes share two bytes: the high bit
 * marks the packed three-letter form, five bits per letter above 'a' - 1.
 */
function unpackLocalePart(first: number, second: number): string {
  if (first === 0) {
    return "";
  }
  if ((first & 0x80) === 0) {
    return String.fromCharCode(first, second);
  }
  const base = "a".charCodeAt(0) - 1;
  return String.fromCharCode(
    base + ((first & 0x7c) >> 2),
    base + (((first & 0x03) << 3) | ((second & 0xe0) >> 5)),
    base + (second & 0x1f)
  );
}

/** A fixed-width char[] field, NUL-padded rather than NUL-terminated. */
function readAsciiField(buffer: Buffer, start: number, length: number, limit: number): string {
  if (start + length > limit) {
    return "";
  }
  let end = start;
  while (end < start + length && buffer.readUInt8(end) !== 0) {
    end++;
  }
  return buffer.subarray(start, end).toString("latin1");
}

function parseConfig(buffer: Buffer, start: number, size: number): ArscConfig {
  // Every read is guarded by the chunk's own declared config size: the
  // struct only ever grew, so an older table simply stops early and the
  // fields it never had must read as "any".
  const u8 = (offset: number) => (offset + 1 <= size ? buffer.readUInt8(start + offset) : 0);
  const u16 = (offset: number) => (offset + 2 <= size ? buffer.readUInt16LE(start + offset) : 0);
  const end = start + size;
  return {
    mcc: u16(4),
    mnc: u16(6),
    language: unpackLocalePart(u8(8), u8(9)),
    country: unpackLocalePart(u8(10), u8(11)),
    orientation: u8(12),
    touchscreen: u8(13),
    density: u16(14),
    keyboard: u8(16),
    navigation: u8(17),
    inputFlags: u8(18),
    screenWidth: u16(20),
    screenHeight: u16(22),
    sdkVersion: u16(24),
    screenLayout: u8(28),
    uiMode: u8(29),
    smallestScreenWidthDp: u16(30),
    screenWidthDp: u16(32),
    screenHeightDp: u16(34),
    localeScript: readAsciiField(buffer, start + 36, 4, end),
    localeVariant: readAsciiField(buffer, start + 40, 8, end),
    screenLayout2: u8(48),
    colorMode: u8(49),
    localeScriptWasComputed: u8(52) !== 0
  };
}

/**
 * The BCP-47 tag the proto carries in place of the struct's split
 * language/script/region/variant, assembled in AOSP's order. A script that the
 * platform computed rather than the author writing it is dropped, matching
 * ResTable_config::getBcp47Locale.
 */
function bcp47Locale(config: ArscConfig): string {
  if (!config.language && !config.country) {
    return "";
  }
  const parts: string[] = [];
  if (config.language) {
    parts.push(config.language);
  }
  if (config.localeScript && !config.localeScriptWasComputed) {
    parts.push(config.localeScript);
  }
  if (config.country) {
    parts.push(config.country);
  }
  if (config.localeVariant) {
    parts.push(config.localeVariant);
  }
  return parts.join("-");
}

/**
 * Config bit-fields → Configuration message. Four of these mappings are
 * INVERTED relative to the binary encoding (long/night/round/wide-gamut and
 * HDR all spell "yes" as 2 in the struct and as 1 in the proto), which is
 * exactly the kind of thing a "just copy the number" converter gets silently
 * wrong, so each one is an explicit switch.
 */
function encodeConfiguration(writer: ProtoWriter, config: ArscConfig): void {
  writer.uint32(1, config.mcc);
  writer.uint32(2, config.mnc);
  writer.string(3, bcp47Locale(config));
  writer.enumValue(4, (config.screenLayout & 0xc0) >> 6);
  writer.uint32(5, config.screenWidth);
  writer.uint32(6, config.screenHeight);
  writer.uint32(7, config.screenWidthDp);
  writer.uint32(8, config.screenHeightDp);
  writer.uint32(9, config.smallestScreenWidthDp);

  writer.enumValue(10, config.screenLayout & 0x0f);
  writer.enumValue(11, invertedTriState((config.screenLayout & 0x30) >> 4));
  writer.enumValue(12, invertedTriState(config.screenLayout2 & 0x03));
  writer.enumValue(13, invertedTriState(config.colorMode & 0x03));
  writer.enumValue(14, invertedTriState((config.colorMode & 0x0c) >> 2));
  writer.enumValue(15, config.orientation);
  writer.enumValue(16, config.uiMode & 0x0f);
  writer.enumValue(17, invertedTriState((config.uiMode & 0x30) >> 4));
  writer.uint32(18, config.density);
  writer.enumValue(19, config.touchscreen);
  writer.enumValue(20, config.inputFlags & 0x03);
  writer.enumValue(21, config.keyboard);
  writer.enumValue(22, (config.inputFlags & 0x0c) >> 2);
  writer.enumValue(23, config.navigation);
  writer.uint32(24, config.sdkVersion);
}

/** ARSC "any/no/yes" (0/1/2) → proto "unset/yes/no" (0/1/2). */
function invertedTriState(value: number): number {
  if (value === 1) {
    return 2;
  }
  if (value === 2) {
    return 1;
  }
  return 0;
}

/* ------------------------------------------------------------------ parse */

type ArscEntry = {
  id: number;
  key: string;
  flags: number;
  /** Simple entries. */
  value?: ResValue;
  /** Compound (ResTable_map) entries. */
  map?: { parent: number; entries: { name: number; value: ResValue }[] };
};

type ArscTypeChunk = { id: number; config: ArscConfig; entries: ArscEntry[] };

function readResValue(buffer: Buffer, offset: number): ResValue {
  return { dataType: buffer.readUInt8(offset + 3), data: buffer.readUInt32LE(offset + 4) };
}

function entryKey(keys: string[], index: number): string {
  const key = keys[index];
  if (key === undefined) {
    throw new Error(`Resource entry names key ${index}, which is not in the package's key pool`);
  }
  return key;
}

function parseEntry(buffer: Buffer, offset: number, id: number, keys: string[]): ArscEntry {
  const flags = buffer.readUInt16LE(offset + 2);
  if (flags & ENTRY_FLAG_COMPACT) {
    // Compact entries (API 34 aapt2) fold the key index into the size slot
    // and the Res_value into the trailing word, with the dataType in the
    // flags' high byte.
    return {
      id,
      key: entryKey(keys, buffer.readUInt16LE(offset)),
      flags,
      value: { dataType: (flags >> 8) & 0xff, data: buffer.readUInt32LE(offset + 4) }
    };
  }
  const size = buffer.readUInt16LE(offset);
  const key = entryKey(keys, buffer.readUInt32LE(offset + 4));
  if (!(flags & ENTRY_FLAG_COMPLEX)) {
    return { id, key, flags, value: readResValue(buffer, offset + size) };
  }
  const parent = buffer.readUInt32LE(offset + 8);
  const count = buffer.readUInt32LE(offset + 12);
  const entries: { name: number; value: ResValue }[] = [];
  for (let i = 0; i < count; i++) {
    const at = offset + size + i * 12;
    entries.push({ name: buffer.readUInt32LE(at), value: readResValue(buffer, at + 4) });
  }
  return { id, key, flags, map: { parent, entries } };
}

function parseTypeChunk(buffer: Buffer, chunk: Chunk, keys: string[]): ArscTypeChunk {
  const id = buffer.readUInt8(chunk.start + 8);
  const flags = buffer.readUInt8(chunk.start + 9);
  const entryCount = buffer.readUInt32LE(chunk.start + 12);
  const entriesStart = buffer.readUInt32LE(chunk.start + 16);
  const configSize = buffer.readUInt32LE(chunk.start + 20);
  const config = parseConfig(buffer, chunk.start + 20, configSize);
  const indexStart = chunk.start + chunk.headerSize;

  const entries: ArscEntry[] = [];
  if (flags & TYPE_FLAG_SPARSE) {
    // Sparse index: (entry id, offset/4) pairs instead of a dense table.
    for (let i = 0; i < entryCount; i++) {
      const at = indexStart + i * 4;
      const entryId = buffer.readUInt16LE(at);
      const offset = buffer.readUInt16LE(at + 2) * 4;
      entries.push(parseEntry(buffer, chunk.start + entriesStart + offset, entryId, keys));
    }
    return { id, config, entries };
  }
  for (let i = 0; i < entryCount; i++) {
    let offset: number;
    if (flags & TYPE_FLAG_OFFSET16) {
      const raw = buffer.readUInt16LE(indexStart + i * 2);
      if (raw === NO_ENTRY16) {
        continue;
      }
      offset = raw * 4;
    } else {
      offset = buffer.readUInt32LE(indexStart + i * 4);
      if (offset === NO_ENTRY) {
        continue;
      }
    }
    entries.push(parseEntry(buffer, chunk.start + entriesStart + offset, i, keys));
  }
  return { id, config, entries };
}

type ArscPackage = {
  id: number;
  name: string;
  typeNames: string[];
  typeChunks: ArscTypeChunk[];
};

/** char16[128] slot inside ResTable_package, null-terminated. */
function readPackageName(buffer: Buffer, chunk: Chunk): string {
  const slot = buffer.subarray(chunk.start + 12, chunk.start + 12 + 256);
  let end = 0;
  while (end < 127 && slot.readUInt16LE(end * 2) !== 0) {
    end++;
  }
  return slot.subarray(0, end * 2).toString("utf16le");
}

function parsePackage(buffer: Buffer, chunk: Chunk): ArscPackage {
  const id = buffer.readUInt32LE(chunk.start + 8);
  const typeStringsOffset = buffer.readUInt32LE(chunk.start + 268);
  const keyStringsOffset = buffer.readUInt32LE(chunk.start + 276);
  if (typeStringsOffset === 0 || keyStringsOffset === 0) {
    throw new Error("Resource-table package has no type or key string pool");
  }
  const typePool = parseStringPool(buffer, readChunk(buffer, chunk.start + typeStringsOffset));
  const keyPool = parseStringPool(buffer, readChunk(buffer, chunk.start + keyStringsOffset));

  const typeChunks: ArscTypeChunk[] = [];
  let cursor = chunk.start + chunk.headerSize;
  while (cursor < chunk.start + chunk.size) {
    const sub = readChunk(buffer, cursor);
    if (sub.type === RES_TABLE_TYPE_TYPE) {
      typeChunks.push(parseTypeChunk(buffer, sub, keyPool.strings));
    }
    // Type-spec chunks carry only the per-entry config-change flags, which
    // the proto table has no field for; library and overlayable chunks do
    // not appear in an application package. All pass through unread.
    if (
      sub.type !== RES_TABLE_TYPE_TYPE &&
      sub.type !== RES_TABLE_TYPE_SPEC_TYPE &&
      sub.type !== RES_STRING_POOL_TYPE
    ) {
      throw new Error(
        `Unsupported resource-table chunk 0x${sub.type.toString(16)} in package "${readPackageName(buffer, chunk)}"`
      );
    }
    cursor += sub.size;
  }
  return { id, name: readPackageName(buffer, chunk), typeNames: typePool.strings, typeChunks };
}

type ParsedArsc = { valuePool: StringPool; packages: ArscPackage[] };

function parseArsc(arsc: Buffer): ParsedArsc {
  const root = readChunk(arsc, 0);
  if (root.type !== RES_TABLE_TYPE) {
    throw new Error("Not a resources.arsc file (missing RES_TABLE header)");
  }
  let valuePool: StringPool | undefined;
  const packages: ArscPackage[] = [];
  let cursor = root.headerSize;
  while (cursor < root.size) {
    const chunk = readChunk(arsc, cursor);
    if (chunk.type === RES_STRING_POOL_TYPE && !valuePool) {
      valuePool = parseStringPool(arsc, chunk);
    } else if (chunk.type === RES_TABLE_PACKAGE_TYPE) {
      packages.push(parsePackage(arsc, chunk));
    }
    cursor += chunk.size;
  }
  if (!valuePool) {
    throw new Error("Resource table has no value string pool");
  }
  return { valuePool, packages };
}

/* --------------------------------------------------------------- encoding */

function encodeReference(id: number): Buffer {
  return encodeMessage((reference) => reference.uint32(2, id));
}

/**
 * A table string value → Item. aapt2's rule, not ours: outside the `string`
 * type, text beginning with "res/" is a compiled file path, and the file's
 * kind comes from its extension.
 */
function encodeStringItem(typeName: string, text: string, resourceName: string): Buffer {
  if (typeName !== "string" && text.startsWith("res/")) {
    const isXml = text.toLowerCase().endsWith(".xml");
    if (isXml && typeName !== "raw") {
      throw new Error(
        `Resource "${typeName}/${resourceName}" points at compiled binary XML (${text}); ` +
          "an App Bundle needs proto XML there, which this converter does not produce"
      );
    }
    return encodeMessage((item) =>
      item.message(5, (file) => {
        file.string(1, text);
        if (typeName === "raw") {
          return;
        }
        if (text.toLowerCase().endsWith(".png")) {
          file.enumValue(2, FILE_TYPE_PNG);
        } else if (isXml) {
          file.enumValue(2, FILE_TYPE_BINARY_XML);
        }
      })
    );
  }
  return encodeMessage((item) => item.message(2, (str) => str.string(1, text)));
}

function encodeTableItem(
  value: ResValue,
  typeName: string,
  resourceName: string,
  valuePool: StringPool
): Buffer {
  // An `id` resource is a pure placeholder: it occupies a resource id and
  // carries no value at all, whatever the binary Res_value happens to say.
  if (typeName === "id") {
    return encodeMessage((item) => item.message(6, () => undefined));
  }
  if (value.dataType === RES_VALUE_TYPE_STRING) {
    const text = valuePool.strings[value.data];
    if (text === undefined) {
      throw new Error(
        `Resource "${typeName}/${resourceName}" references string ${value.data}, which is not in the pool`
      );
    }
    return encodeStringItem(typeName, text, resourceName);
  }
  const item = encodePrimitiveItem(value);
  if (!item) {
    throw new Error(`Resource "${typeName}/${resourceName}" has an unrepresentable value`);
  }
  return item;
}

/** Plural arity keys (ResTable_map internal names) → aapt.pb.Plural.Arity. */
function pluralArity(name: number): number {
  if (name < ATTR_OTHER || name > ATTR_MANY) {
    throw new Error(`Plural entry has an unknown arity key 0x${name.toString(16)}`);
  }
  // ATTR_OTHER..ATTR_MANY are other, zero, one, two, few, many; the proto's
  // Arity is zero, one, two, few, many, other.
  return name === ATTR_OTHER ? 5 : name - ATTR_OTHER - 1;
}

function encodeCompoundValue(entry: ArscEntry, typeName: string, valuePool: StringPool): Buffer {
  const map = entry.map!;
  const item = (value: ResValue) => encodeTableItem(value, typeName, entry.key, valuePool);
  switch (typeName) {
    case "style":
      return encodeMessage((compound) =>
        compound.message(2, (style) => {
          if (map.parent !== 0) {
            style.messageBytes(1, encodeReference(map.parent));
          }
          for (const child of map.entries) {
            style.message(3, (styleEntry) => {
              styleEntry.messageBytes(3, encodeReference(child.name));
              styleEntry.messageBytes(4, item(child.value));
            });
          }
        })
      );
    case "array":
      return encodeMessage((compound) =>
        compound.message(4, (array) => {
          for (const child of map.entries) {
            array.message(1, (element) => element.messageBytes(3, item(child.value)));
          }
        })
      );
    case "plurals":
      return encodeMessage((compound) =>
        compound.message(5, (plural) => {
          for (const child of map.entries) {
            plural.message(1, (pluralEntry) => {
              pluralEntry.enumValue(3, pluralArity(child.name));
              pluralEntry.messageBytes(4, item(child.value));
            });
          }
        })
      );
    case "attr":
    case "^attr-private":
      return encodeMessage((compound) =>
        compound.message(1, (attribute) => {
          let formatFlags = 0;
          let minInt = 0;
          let maxInt = 0;
          const symbols: { name: number; value: number; type: number }[] = [];
          for (const child of map.entries) {
            if (child.name === ATTR_TYPE) {
              formatFlags = child.value.data;
            } else if (child.name === ATTR_MIN) {
              minInt = child.value.data | 0;
            } else if (child.name === ATTR_MAX) {
              maxInt = child.value.data | 0;
            } else if (child.name !== ATTR_L10N) {
              symbols.push({
                name: child.name,
                value: child.value.data,
                type: child.value.dataType
              });
            }
          }
          attribute.uint32(1, formatFlags);
          attribute.int32(2, minInt);
          attribute.int32(3, maxInt);
          for (const symbol of symbols) {
            attribute.message(4, (pb) => {
              pb.messageBytes(3, encodeReference(symbol.name));
              pb.uint32(4, symbol.value);
              pb.uint32(5, symbol.type);
            });
          }
        })
      );
    default:
      throw new Error(
        `Resource type "${typeName}" carries a compound value this converter cannot express in protobuf`
      );
  }
}

function encodeEntryValue(entry: ArscEntry, typeName: string, valuePool: StringPool): Buffer {
  return encodeMessage((value) => {
    if (entry.map) {
      value.messageBytes(5, encodeCompoundValue(entry, typeName, valuePool));
    } else {
      value.messageBytes(4, encodeTableItem(entry.value!, typeName, entry.key, valuePool));
    }
  });
}

/**
 * Rebuild the config-inside-type nesting as the proto's config-inside-entry
 * nesting: one Entry per resource id, carrying a ConfigValue for every type
 * chunk that defined it. Type-chunk order is preserved so the configurations
 * come out in the order the table declared them.
 */
function encodePackage(pkg: ArscPackage, valuePool: StringPool): Buffer {
  const byTypeId = new Map<number, ArscTypeChunk[]>();
  for (const chunk of pkg.typeChunks) {
    const list = byTypeId.get(chunk.id);
    if (list) {
      list.push(chunk);
    } else {
      byTypeId.set(chunk.id, [chunk]);
    }
  }

  return encodeMessage((pb) => {
    pb.message(1, (id) => id.uint32(1, pkg.id));
    pb.string(2, pkg.name);
    for (const typeId of [...byTypeId.keys()].sort((a, b) => a - b)) {
      const chunks = byTypeId.get(typeId)!;
      const typeName = pkg.typeNames[typeId - 1];
      if (typeName === undefined) {
        throw new Error(`Resource type id ${typeId} has no name in the package's type pool`);
      }
      pb.message(3, (type) => {
        type.message(1, (id) => id.uint32(1, typeId));
        type.string(2, typeName);

        const configValuesByEntryId = new Map<number, { entry: ArscEntry; config: ArscConfig }[]>();
        for (const chunk of chunks) {
          for (const entry of chunk.entries) {
            const list = configValuesByEntryId.get(entry.id);
            if (list) {
              list.push({ entry, config: chunk.config });
            } else {
              configValuesByEntryId.set(entry.id, [{ entry, config: chunk.config }]);
            }
          }
        }

        for (const entryId of [...configValuesByEntryId.keys()].sort((a, b) => a - b)) {
          const configValues = configValuesByEntryId.get(entryId)!;
          type.message(3, (pbEntry) => {
            // Present-but-empty for id 0: an absent entry_id means
            // "no id assigned", which is a different resource.
            pbEntry.message(1, (id) => id.uint32(1, entryId));
            pbEntry.string(2, configValues[0].entry.key);
            if (configValues.some(({ entry }) => entry.flags & ENTRY_FLAG_PUBLIC)) {
              pbEntry.message(3, (visibility) => visibility.enumValue(1, VISIBILITY_PUBLIC));
            }
            for (const { entry, config } of configValues) {
              pbEntry.message(6, (configValue) => {
                configValue.message(1, (pbConfig) => encodeConfiguration(pbConfig, config));
                configValue.messageBytes(2, encodeEntryValue(entry, typeName, valuePool));
              });
            }
          });
        }
      });
    }
  });
}

/** resources.arsc bytes → aapt.pb.ResourceTable bytes. */
export function convertArscToProto(arsc: Buffer): Buffer {
  const { valuePool, packages } = parseArsc(arsc);
  if (packages.length === 0) {
    throw new Error("Resource table declares no packages");
  }
  return encodeMessage((table) => {
    for (const pkg of packages) {
      table.messageBytes(2, encodePackage(pkg, valuePool));
    }
  });
}
