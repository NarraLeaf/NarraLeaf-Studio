/**
 * Full-shape synthetic Android binaries for the .aab converter tests: a binary
 * AndroidManifest.xml with namespaces, nesting and real end tags, and a
 * resources.arsc with several type chunks, two configurations of one entry, a
 * locale-qualified string and a compound style.
 *
 * androidFixtures.ts already builds Android binaries, but deliberately minimal
 * ones - "enough chunks for the patchers to locate and rewrite the identity".
 * The proto converters read the WHOLE file, so they need fixtures that are
 * whole: an AXML without end tags and an ARSC whose package body is eight
 * arbitrary bytes are exactly what those are, and both would be rejected here
 * for the right reasons and prove nothing.
 *
 * Hand-encoded, like its sibling: a fixture produced by the code under test
 * cannot catch a symmetric encoder/decoder bug. Only tests import this.
 */

const NO_ENTRY = 0xffffffff;
const ANDROID_NS = "http://schemas.android.com/apk/res/android";

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_BOOLEAN = 0x12;

/** ResTable_config is 64 bytes in every table aapt2 has emitted for years. */
const CONFIG_SIZE = 64;

function chunk(type: number, headerSize: number, body: Buffer, headerExtra?: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt16LE(type, 0);
  head.writeUInt16LE(headerSize, 2);
  head.writeUInt32LE(8 + (headerExtra?.length ?? 0) + body.length, 4);
  return Buffer.concat([head, ...(headerExtra ? [headerExtra] : []), body]);
}

function encodePoolString(value: string, utf8: boolean): Buffer {
  if (utf8) {
    const bytes = Buffer.from(value, "utf8");
    const lengths: number[] = [];
    for (const length of [value.length, bytes.length]) {
      if (length > 0x7f) {
        lengths.push(((length >> 8) & 0x7f) | 0x80, length & 0xff);
      } else {
        lengths.push(length);
      }
    }
    return Buffer.concat([Buffer.from(lengths), bytes, Buffer.from([0])]);
  }
  const header = Buffer.alloc(2);
  header.writeUInt16LE(value.length, 0);
  return Buffer.concat([header, Buffer.from(value, "utf16le"), Buffer.from([0, 0])]);
}

function buildPool(strings: string[], utf8: boolean): Buffer {
  const encoded = strings.map((value) => encodePoolString(value, utf8));
  const offsets = Buffer.alloc(strings.length * 4);
  let cursor = 0;
  encoded.forEach((piece, index) => {
    offsets.writeUInt32LE(cursor, index * 4);
    cursor += piece.length;
  });
  let data = Buffer.concat(encoded);
  const padding = (4 - (data.length % 4)) % 4;
  if (padding) {
    data = Buffer.concat([data, Buffer.alloc(padding)]);
  }
  const headerExtra = Buffer.alloc(20);
  headerExtra.writeUInt32LE(strings.length, 0);
  headerExtra.writeUInt32LE(0, 4);
  headerExtra.writeUInt32LE(utf8 ? 0x100 : 0, 8);
  headerExtra.writeUInt32LE(28 + offsets.length, 12);
  headerExtra.writeUInt32LE(0, 16);
  return chunk(0x0001, 28, Buffer.concat([offsets, data]), headerExtra);
}

/* ------------------------------------------------- binary AndroidManifest */

type FixtureAttribute = {
  ns: number;
  name: number;
  rawValue: number;
  dataType: number;
  data: number;
};

function xmlNode(type: number, line: number, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(line, 0);
  header.writeUInt32LE(NO_ENTRY, 4);
  return chunk(type, 16, body, header);
}

function startNamespace(line: number, prefix: number, uri: number): Buffer {
  const body = Buffer.alloc(8);
  body.writeUInt32LE(prefix, 0);
  body.writeUInt32LE(uri, 4);
  return xmlNode(0x0100, line, body);
}

function endNamespace(line: number, prefix: number, uri: number): Buffer {
  const body = Buffer.alloc(8);
  body.writeUInt32LE(prefix, 0);
  body.writeUInt32LE(uri, 4);
  return xmlNode(0x0101, line, body);
}

function startElement(line: number, nameIndex: number, attributes: FixtureAttribute[]): Buffer {
  const body = Buffer.alloc(20 + attributes.length * 20);
  body.writeUInt32LE(NO_ENTRY, 0);
  body.writeUInt32LE(nameIndex, 4);
  body.writeUInt16LE(20, 8);
  body.writeUInt16LE(20, 10);
  body.writeUInt16LE(attributes.length, 12);
  attributes.forEach((attribute, index) => {
    const at = 20 + index * 20;
    body.writeUInt32LE(attribute.ns, at);
    body.writeUInt32LE(attribute.name, at + 4);
    body.writeUInt32LE(attribute.rawValue, at + 8);
    body.writeUInt16LE(8, at + 12);
    body.writeUInt8(0, at + 14);
    body.writeUInt8(attribute.dataType, at + 15);
    body.writeUInt32LE(attribute.data, at + 16);
  });
  return xmlNode(0x0102, line, body);
}

function endElement(line: number, nameIndex: number): Buffer {
  const body = Buffer.alloc(8);
  body.writeUInt32LE(NO_ENTRY, 0);
  body.writeUInt32LE(nameIndex, 4);
  return xmlNode(0x0103, line, body);
}

function cdata(line: number, valueIndex: number): Buffer {
  const body = Buffer.alloc(20);
  body.writeUInt32LE(valueIndex, 0);
  body.writeUInt16LE(8, 4);
  body.writeUInt8(TYPE_STRING, 7);
  body.writeUInt32LE(valueIndex, 8);
  return xmlNode(0x0104, line, body);
}

export type ProtoManifestFixtureOptions = {
  packageName?: string;
  label?: string;
  versionCode?: number;
  versionName?: string;
  /** Add a text child, so the CDATA branch is exercised rather than dead. */
  withText?: boolean;
};

/**
 * A binary AndroidManifest.xml a proto converter can read end to end: one
 * namespace declaration, three nested elements with real end tags, and one
 * attribute of each value kind the converter maps (string, int, boolean,
 * reference).
 */
export function buildProtoManifestFixture(options: ProtoManifestFixtureOptions = {}): Buffer {
  const packageName = options.packageName ?? "com.narraleaf.shell.placeholder";
  const strings = [
    "theme", //  0 → 0x01010000
    "label", //  1 → 0x01010001
    "name", //  2 → 0x01010003
    "exported", //  3 → 0x01010010
    "versionCode", //  4 → 0x0101021b
    "versionName", //  5 → 0x0101021c
    ANDROID_NS, //  6
    "android", //  7
    "package", //  8
    "manifest", //  9
    "application", // 10
    "activity", // 11
    packageName, // 12
    options.versionName ?? "0.0.0", // 13
    options.label ?? "NarraLeaf Shell", // 14
    "com.narraleaf.shell.MainActivity", // 15
    "some text" // 16
  ];

  const resourceIds = Buffer.alloc(24);
  [0x01010000, 0x01010001, 0x01010003, 0x01010010, 0x0101021b, 0x0101021c].forEach((id, index) =>
    resourceIds.writeUInt32LE(id, index * 4)
  );

  const body = Buffer.concat([
    buildPool(strings, false),
    chunk(0x0180, 8, resourceIds),
    startNamespace(2, 7, 6),
    startElement(2, 9, [
      { ns: NO_ENTRY, name: 8, rawValue: 12, dataType: TYPE_STRING, data: 12 },
      {
        ns: 6,
        name: 4,
        rawValue: NO_ENTRY,
        dataType: TYPE_INT_DEC,
        data: options.versionCode ?? 1
      },
      { ns: 6, name: 5, rawValue: 13, dataType: TYPE_STRING, data: 13 }
    ]),
    startElement(5, 10, [
      { ns: 6, name: 1, rawValue: 14, dataType: TYPE_STRING, data: 14 },
      { ns: 6, name: 0, rawValue: NO_ENTRY, dataType: TYPE_REFERENCE, data: 0x7f020000 }
    ]),
    startElement(8, 11, [
      { ns: 6, name: 2, rawValue: 15, dataType: TYPE_STRING, data: 15 },
      { ns: 6, name: 3, rawValue: NO_ENTRY, dataType: TYPE_INT_BOOLEAN, data: 0xffffffff }
    ]),
    ...(options.withText ? [cdata(9, 16)] : []),
    endElement(10, 11),
    endElement(11, 10),
    endElement(12, 9),
    endNamespace(12, 7, 6)
  ]);
  return chunk(0x0003, 8, body);
}

/* ------------------------------------------------------- resources.arsc */

function config(fill: (buffer: Buffer) => void): Buffer {
  const buffer = Buffer.alloc(CONFIG_SIZE);
  buffer.writeUInt32LE(CONFIG_SIZE, 0);
  fill(buffer);
  return buffer;
}

function resValue(dataType: number, data: number): Buffer {
  const value = Buffer.alloc(8);
  value.writeUInt16LE(8, 0);
  value.writeUInt8(dataType, 3);
  value.writeUInt32LE(data, 4);
  return value;
}

function simpleEntry(key: number, dataType: number, data: number): Buffer {
  const entry = Buffer.alloc(8);
  entry.writeUInt16LE(8, 0);
  entry.writeUInt16LE(0, 2);
  entry.writeUInt32LE(key, 4);
  return Buffer.concat([entry, resValue(dataType, data)]);
}

function mapEntry(
  key: number,
  parent: number,
  values: { name: number; dataType: number; data: number }[]
): Buffer {
  const entry = Buffer.alloc(16);
  entry.writeUInt16LE(16, 0);
  entry.writeUInt16LE(0x0001, 2);
  entry.writeUInt32LE(key, 4);
  entry.writeUInt32LE(parent, 8);
  entry.writeUInt32LE(values.length, 12);
  return Buffer.concat([
    entry,
    ...values.map((value) => {
      const name = Buffer.alloc(4);
      name.writeUInt32LE(value.name, 0);
      return Buffer.concat([name, resValue(value.dataType, value.data)]);
    })
  ]);
}

function typeSpec(id: number, entryCount: number): Buffer {
  const headerExtra = Buffer.alloc(8);
  headerExtra.writeUInt8(id, 0);
  headerExtra.writeUInt32LE(entryCount, 4);
  return chunk(0x0202, 16, Buffer.alloc(entryCount * 4), headerExtra);
}

function typeChunk(id: number, configBytes: Buffer, entries: Buffer[]): Buffer {
  const headerSize = 20 + CONFIG_SIZE;
  const offsets = Buffer.alloc(entries.length * 4);
  let cursor = 0;
  entries.forEach((entry, index) => {
    offsets.writeUInt32LE(cursor, index * 4);
    cursor += entry.length;
  });
  const headerExtra = Buffer.alloc(12 + CONFIG_SIZE);
  headerExtra.writeUInt8(id, 0);
  headerExtra.writeUInt8(0, 1);
  headerExtra.writeUInt32LE(entries.length, 4);
  headerExtra.writeUInt32LE(headerSize + offsets.length, 8);
  configBytes.copy(headerExtra, 12);
  return chunk(0x0201, headerSize, Buffer.concat([offsets, ...entries]), headerExtra);
}

export const ARSC_FIXTURE_STRINGS = [
  "res/drawable-mdpi/icon.png",
  "res/drawable-xhdpi/icon.png",
  "Hello"
];

/**
 * A resources.arsc that exercises everything the proto converter has to do:
 * one entry defined in two density configurations (the config-inside-type →
 * config-inside-entry regrouping), a locale-qualified string, a "res/…" value
 * that must become a FileReference rather than a String, and a compound style
 * with a parent, a reference item and a boolean item.
 */
export function buildProtoArscFixture(packageName = "com.narraleaf.shell.placeholder"): Buffer {
  const typePool = buildPool(["drawable", "string", "style"], true);
  const keyPool = buildPool(["icon", "greeting", "AppTheme"], true);

  const drawableMdpi = typeChunk(
    1,
    config((buffer) => buffer.writeUInt16LE(160, 14)),
    [simpleEntry(0, TYPE_STRING, 0)]
  );
  const drawableXhdpi = typeChunk(
    1,
    config((buffer) => buffer.writeUInt16LE(320, 14)),
    [simpleEntry(0, TYPE_STRING, 1)]
  );
  const stringEnUs = typeChunk(
    2,
    config((buffer) => buffer.write("enUS", 8, "latin1")),
    [simpleEntry(1, TYPE_STRING, 2)]
  );
  const styleDefault = typeChunk(
    3,
    config(() => undefined),
    [
      mapEntry(2, 0x01030000, [
        { name: 0x01010098, dataType: TYPE_REFERENCE, data: 0x7f010000 },
        { name: 0x010100d4, dataType: TYPE_INT_BOOLEAN, data: 0xffffffff }
      ])
    ]
  );

  const packageBody = Buffer.concat([
    typePool,
    keyPool,
    typeSpec(1, 1),
    drawableMdpi,
    drawableXhdpi,
    typeSpec(2, 1),
    stringEnUs,
    typeSpec(3, 1),
    styleDefault
  ]);
  const packageHeaderSize = 288;
  const packageHeaderExtra = Buffer.alloc(packageHeaderSize - 8);
  packageHeaderExtra.writeUInt32LE(0x7f, 0);
  packageHeaderExtra.write(packageName, 4, "utf16le");
  packageHeaderExtra.writeUInt32LE(packageHeaderSize, 260);
  packageHeaderExtra.writeUInt32LE(packageHeaderSize + typePool.length, 268);
  const packageChunk = chunk(0x0200, packageHeaderSize, packageBody, packageHeaderExtra);

  const body = Buffer.concat([buildPool(ARSC_FIXTURE_STRINGS, true), packageChunk]);
  const tableHeaderExtra = Buffer.alloc(4);
  tableHeaderExtra.writeUInt32LE(1, 0);
  return chunk(0x0002, 12, body, tableHeaderExtra);
}
