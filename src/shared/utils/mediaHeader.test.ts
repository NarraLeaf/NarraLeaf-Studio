import { describe, expect, it } from "vitest";
import { readFontHeader, readMediaHeader } from "./mediaHeader";

/**
 * The header readers, against headers built here byte by byte.
 *
 * Synthesised rather than checked-in fixtures, because a fixture would be a binary blob nobody
 * can review: the interesting part of each of these tests is the LAYOUT written down in the
 * builder, which is the same thing the reader claims to know. A wrong offset shows up as a
 * wrong number in both places only if someone copies the mistake twice.
 *
 * The truncation cases matter as much as the happy ones. Every caller of this module hands over
 * a bounded prefix, so "the header is not all here" is the ordinary input, not the edge case.
 */

function concat(...parts: (Buffer | number[])[]): Buffer {
  return Buffer.concat(parts.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part))));
}

function u32be(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value);
  return out;
}

function u32le(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function u16le(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function u16be(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(value);
  return out;
}

/* -------------------------------------------------------------------------------------- */

/** 2 seconds of 44.1 kHz 16-bit stereo, as the RIFF chunks that say so. */
function wav(): Buffer {
  const byteRate = 44100 * 2 * 2;
  return concat(
    Buffer.from("RIFF"),
    u32le(0),
    Buffer.from("WAVE"),
    Buffer.from("fmt "),
    u32le(16),
    u16le(1),
    u16le(2),
    u32le(44100),
    u32le(byteRate),
    u16le(4),
    u16le(16),
    Buffer.from("data"),
    u32le(byteRate * 2)
  );
}

describe("WAVE", () => {
  it("reads the rate, the channels and a duration from the data chunk's declared length", () => {
    expect(readMediaHeader(wav())).toEqual({
      container: "wav",
      sampleRate: 44100,
      channels: 2,
      durationMs: 2000
    });
  });

  it("walks past a chunk it does not know rather than giving up on the file", () => {
    const withList = concat(
      Buffer.from("RIFF"),
      u32le(0),
      Buffer.from("WAVE"),
      Buffer.from("LIST"),
      u32le(4),
      Buffer.from("INFO"),
      wav().subarray(12)
    );
    expect(readMediaHeader(withList)?.sampleRate).toBe(44100);
  });

  it("reports the rate with no duration when the prefix stops before the data chunk", () => {
    const header = wav().subarray(0, 36);
    expect(readMediaHeader(header)).toEqual({ container: "wav", sampleRate: 44100, channels: 2 });
  });
});

/* -------------------------------------------------------------------------------------- */

/** STREAMINFO says the total sample count outright, so a FLAC duration is exact. */
function flac(sampleRate: number, channels: number, samples: number): Buffer {
  const packed =
    (BigInt(sampleRate) << 44n) | (BigInt(channels - 1) << 41n) | (15n << 36n) | BigInt(samples);
  const tail = Buffer.alloc(8);
  tail.writeBigUInt64BE(packed);
  return concat(
    Buffer.from("fLaC"),
    [0x00, 0x00, 0x00, 0x22],
    Buffer.alloc(10),
    tail,
    Buffer.alloc(16)
  );
}

describe("FLAC", () => {
  it("reads an exact duration out of STREAMINFO", () => {
    expect(readMediaHeader(flac(44100, 2, 88200))).toEqual({
      container: "flac",
      sampleRate: 44100,
      channels: 2,
      durationMs: 2000
    });
  });

  it("answers nothing at all for a truncated one", () => {
    expect(readMediaHeader(flac(44100, 2, 88200).subarray(0, 20))).toBeNull();
  });
});

/* -------------------------------------------------------------------------------------- */

function oggVorbis(): Buffer {
  return concat(
    Buffer.from("OggS"),
    [0x00, 0x02],
    Buffer.alloc(8),
    u32le(1),
    u32le(0),
    u32le(0),
    [0x01, 30],
    [0x01],
    Buffer.from("vorbis"),
    u32le(0),
    [0x02],
    u32le(48000),
    Buffer.alloc(8)
  );
}

describe("Ogg", () => {
  it("reads the rate and channels, and never invents a duration", () => {
    // An Ogg stream's length is the granule position of its LAST page, which is nowhere near
    // the front of the file. An estimate from the bitrate hint would be wrong for every
    // variable-bitrate file, which is most of them.
    expect(readMediaHeader(oggVorbis())).toEqual({
      container: "ogg",
      sampleRate: 48000,
      channels: 2
    });
  });

  it("reports Opus at the rate it decodes to, not the rate it was encoded from", () => {
    const opus = concat(
      Buffer.from("OggS"),
      [0x00, 0x02],
      Buffer.alloc(8),
      u32le(1),
      u32le(0),
      u32le(0),
      [0x01, 19],
      Buffer.from("OpusHead"),
      [0x01, 0x01],
      u16le(312),
      u32le(16000),
      Buffer.alloc(8)
    );
    expect(readMediaHeader(opus)).toEqual({ container: "ogg", sampleRate: 48000, channels: 1 });
  });
});

/* -------------------------------------------------------------------------------------- */

/** MPEG-1 Layer III, 44.1 kHz, stereo, 128 kbit/s, with the frame count an encoder writes. */
function mp3(withXing: boolean): Buffer {
  const frame = concat([0xff, 0xfb, 0x90, 0x00]);
  if (!withXing) {
    return concat(frame, Buffer.alloc(64));
  }
  return concat(
    frame,
    Buffer.alloc(32),
    Buffer.from("Xing"),
    u32be(0x01),
    u32be(1000),
    Buffer.alloc(16)
  );
}

describe("MPEG audio", () => {
  it("takes the frame count from a Xing header when the encoder wrote one", () => {
    expect(readMediaHeader(mp3(true))).toEqual({
      container: "mp3",
      sampleRate: 44100,
      channels: 2,
      // 1000 frames of 1152 samples at 44.1 kHz.
      durationMs: 26122
    });
  });

  it("estimates from the bitrate only when the caller passed a total size", () => {
    // The estimate is exact for constant bitrate and wrong for variable, so it is the
    // caller's decision: no size, no number.
    expect(readMediaHeader(mp3(false))?.durationMs).toBeUndefined();
    expect(readMediaHeader(mp3(false), 128_000)?.durationMs).toBe(8000);
  });

  it("skips an ID3 tag to find the first frame", () => {
    const tagged = concat(
      Buffer.from("ID3"),
      [0x04, 0x00, 0x00],
      // Syncsafe: seven bits a byte, so a length can never look like a frame sync.
      [0x00, 0x00, 0x01, 0x00],
      Buffer.alloc(128),
      mp3(true)
    );
    expect(readMediaHeader(tagged)?.sampleRate).toBe(44100);
  });

  it("refuses the reserved version and layer encodings rather than guessing", () => {
    expect(readMediaHeader(concat([0xff, 0xf3, 0x90, 0x00], Buffer.alloc(64)))?.container).toBe(
      "mp3"
    );
    // Layer 00 is reserved.
    expect(readMediaHeader(concat([0xff, 0xf9, 0x90, 0x00], Buffer.alloc(64)))).toBeNull();
  });
});

/* -------------------------------------------------------------------------------------- */

function box(type: string, body: Buffer): Buffer {
  return concat(u32be(body.length + 8), Buffer.from(type), body);
}

/** `mvhd` version 0, then one `trak` whose `tkhd` carries the presentation size. */
function mp4(timescale: number, duration: number, width: number, height: number): Buffer {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(duration, 16);

  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);

  return concat(
    box("ftyp", Buffer.from("isom\0\0\0\0isom")),
    box("moov", concat(box("mvhd", mvhd), box("trak", box("tkhd", tkhd))))
  );
}

describe("ISO base media", () => {
  it("reads the duration from mvhd and the size from the largest tkhd", () => {
    expect(readMediaHeader(mp4(1000, 5000, 1920, 1080))).toEqual({
      container: "iso-bmff",
      durationMs: 5000,
      width: 1920,
      height: 1080
    });
  });

  it("names the container and nothing else when moov is not in the prefix", () => {
    // A file written without a faststart pass keeps its index behind the media data, which
    // on a real video is hundreds of megabytes past anything a header read will see.
    const noIndex = concat(
      box("ftyp", Buffer.from("isom\0\0\0\0isom")),
      box("mdat", Buffer.alloc(256))
    );
    expect(readMediaHeader(noIndex)).toEqual({ container: "iso-bmff" });
  });

  it("treats a sound track's zero size as no size", () => {
    // How an `.m4a` is told from a video without reading its sample descriptions.
    expect(readMediaHeader(mp4(1000, 3000, 0, 0))).toEqual({
      container: "iso-bmff",
      durationMs: 3000
    });
  });
});

/* -------------------------------------------------------------------------------------- */

function ebml(id: number[], body: Buffer): Buffer {
  expect(body.length, "the builder only writes one-byte sizes").toBeLessThan(127);
  return concat(id, [0x80 | body.length], body);
}

function webm(durationTicks: number, width: number, height: number): Buffer {
  const duration = Buffer.alloc(4);
  duration.writeFloatBE(durationTicks);
  const info = ebml(
    [0x15, 0x49, 0xa9, 0x66],
    concat(ebml([0x2a, 0xd7, 0xb1], concat([0x0f, 0x42, 0x40])), ebml([0x44, 0x89], duration))
  );
  const tracks = ebml(
    [0x16, 0x54, 0xae, 0x6b],
    ebml([0xae], ebml([0xe0], concat(ebml([0xb0], u16be(width)), ebml([0xba], u16be(height)))))
  );
  return concat(
    ebml([0x1a, 0x45, 0xdf, 0xa3], Buffer.alloc(4)),
    ebml([0x18, 0x53, 0x80, 0x67], concat(info, tracks))
  );
}

describe("Matroska", () => {
  it("descends into Segment for the duration and the pixel size", () => {
    expect(readMediaHeader(webm(8000, 1280, 720))).toEqual({
      container: "matroska",
      durationMs: 8000,
      width: 1280,
      height: 720
    });
  });

  it("reads a Segment whose size is written as unknown", () => {
    // What a streaming muxer writes. Refusing those would mean reporting nothing at all
    // about every live-recorded WebM.
    const built = webm(8000, 1280, 720);
    const segmentSizeAt = built.indexOf(Buffer.from([0x18, 0x53, 0x80, 0x67])) + 4;
    built[segmentSizeAt] = 0xff;
    expect(readMediaHeader(built)?.width).toBe(1280);
  });
});

/* -------------------------------------------------------------------------------------- */

/** An sfnt with exactly one table, whose `name` holds a Windows UTF-16BE family. */
function font(family: string): Buffer {
  const text = Buffer.from(family, "utf16le").swap16();
  const nameTable = concat(
    u16be(0),
    u16be(1),
    u16be(18),
    u16be(3),
    u16be(1),
    u16be(0x0409),
    u16be(1),
    u16be(text.length),
    u16be(0),
    text
  );
  return concat(
    u32be(0x00010000),
    u16be(1),
    u16be(16),
    u16be(0),
    u16be(0),
    Buffer.from("name"),
    u32be(0),
    u32be(28),
    u32be(nameTable.length),
    nameTable
  );
}

describe("fonts", () => {
  it("reads the family out of the name table", () => {
    expect(readFontHeader(font("Inter"))).toEqual({ container: "truetype", family: "Inter" });
  });

  it("names the flavour with no family when the name table is past the prefix", () => {
    // Not a failure: an sfnt may write its tables in any order, so a large font can put its
    // outlines first and its names beyond any bounded read.
    expect(readFontHeader(font("Inter").subarray(0, 28))).toEqual({ container: "truetype" });
  });

  it("never inflates a compressed font to read a string", () => {
    expect(readFontHeader(concat(Buffer.from("wOFF"), Buffer.alloc(60)))).toEqual({
      container: "woff"
    });
    expect(readFontHeader(concat(Buffer.from("wOF2"), Buffer.alloc(60)))).toEqual({
      container: "woff2"
    });
  });

  it("answers nothing for bytes that are not a font", () => {
    expect(readFontHeader(Buffer.from("not a font at all"))).toBeNull();
  });
});

describe("bytes that are not any of these", () => {
  it("answer null rather than a guess", () => {
    expect(readMediaHeader(Buffer.from("plain text, and quite a lot of it"))).toBeNull();
    expect(readMediaHeader(Buffer.alloc(0))).toBeNull();
  });
});
