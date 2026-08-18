import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetExtras } from "@/lib/workspace/services/assets/types";
import { platformDefaultLineEnding } from "./textEditableFiles";
import {
  fromPersistedEol,
  readTextDocumentPreferences,
  resolveLineEnding,
  resolveOpenEncoding,
  textPreferencePatch,
  toPersistedEol
} from "./textDocumentPreferences";

/** Pretend this process is running on `platform` for the duration of one assertion. */
function onPlatform<T>(platform: string, run: () => T): T {
  const spy = vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("platformDefaultLineEnding", () => {
  it("answers with the OS the file is being created on", () => {
    expect(onPlatform("Win32", platformDefaultLineEnding)).toBe("CRLF");
    expect(onPlatform("MacIntel", platformDefaultLineEnding)).toBe("LF");
    expect(onPlatform("Linux x86_64", platformDefaultLineEnding)).toBe("LF");
  });

  it("is what an empty document falls back to, since there is nothing to detect", () => {
    expect(onPlatform("Win32", () => resolveLineEnding("", null))).toBe("CRLF");
    expect(onPlatform("Linux x86_64", () => resolveLineEnding("", null))).toBe("LF");
  });
});

describe("resolveLineEnding", () => {
  it("takes the content's answer over the record's when they disagree", () => {
    // The record says this file is CRLF; every line in it ends `\n`. Something outside Studio
    // converted it, and honouring the record would rewrite the whole file on the next keystroke.
    expect(resolveLineEnding("one\ntwo\nthree\n", "CRLF")).toBe("LF");
    expect(resolveLineEnding("one\r\ntwo\r\n", "LF")).toBe("CRLF");
  });

  it("reports the majority for a mixed file", () => {
    expect(resolveLineEnding("a\r\nb\r\nc\n", null)).toBe("CRLF");
    expect(resolveLineEnding("a\nb\nc\r\n", null)).toBe("LF");
  });

  it("falls back to the record only when the content cannot answer", () => {
    expect(resolveLineEnding("", "CRLF")).toBe("CRLF");
    expect(resolveLineEnding("no line breaks here", "LF")).toBe("LF");
  });
});

describe("resolveOpenEncoding", () => {
  it("takes the record over a byte-order mark", () => {
    // Deliberate: an author who said "this is GB18030" has stated a fact about the file, and a
    // stray UTF-8 mark in front of GB18030 bytes is exactly what they are correcting.
    expect(resolveOpenEncoding("gb18030", "utf8bom")).toBe("gb18030");
    expect(resolveOpenEncoding("gbk", "utf16le")).toBe("gbk");
  });

  it("falls back to the mark, then to UTF-8", () => {
    expect(resolveOpenEncoding(null, "utf16be")).toBe("utf16be");
    expect(resolveOpenEncoding(null, null)).toBe("utf8");
  });
});

describe("readTextDocumentPreferences", () => {
  it("reads what the record holds", () => {
    expect(readTextDocumentPreferences({ textEncoding: "big5", textEol: "crlf" })).toEqual({
      encoding: "big5",
      lineEnding: "CRLF"
    });
  });

  it("ignores values the record should not have held", () => {
    // Hand-editable project file: an unknown id has to degrade to "nothing recorded" rather
    // than reach the decoder.
    const junk = { textEncoding: "latin-42", textEol: "cr" } as unknown as AssetExtras;
    expect(readTextDocumentPreferences(junk)).toEqual({ encoding: null, lineEnding: null });
    expect(readTextDocumentPreferences(undefined)).toEqual({ encoding: null, lineEnding: null });
  });

  it("round-trips the persisted line-ending vocabulary", () => {
    expect(fromPersistedEol(toPersistedEol("CRLF"))).toBe("CRLF");
    expect(fromPersistedEol(toPersistedEol("LF"))).toBe("LF");
    expect(toPersistedEol("CRLF")).toBe("crlf");
  });
});

describe("textPreferencePatch", () => {
  it("writes nothing when a file is merely opened", () => {
    // The whole point: `assets.metadata.other.json` is under version control, so reading a
    // colleague's plan file must not produce a change to commit - not even one that agrees
    // with what is already recorded, and not even for a file with no record at all.
    expect(
      textPreferencePatch("open", undefined, { encoding: "gbk", lineEnding: "CRLF" })
    ).toBeNull();
    expect(
      textPreferencePatch("open", { textEncoding: "utf8" }, { encoding: "gbk", lineEnding: "LF" })
    ).toBeNull();
  });

  it("writes an explicit choice", () => {
    expect(textPreferencePatch("reopen-with", undefined, { encoding: "gbk" })).toEqual({
      textEncoding: "gbk"
    });
    expect(
      textPreferencePatch("save-with", { textEncoding: "utf8" }, { encoding: "shiftjis" })
    ).toEqual({
      textEncoding: "shiftjis"
    });
    expect(textPreferencePatch("set-eol", { textEol: "crlf" }, { lineEnding: "LF" })).toEqual({
      textEol: "lf"
    });
  });

  it("writes nothing when the record already says this", () => {
    expect(
      textPreferencePatch(
        "reopen-with",
        { textEncoding: "gbk", textEol: "lf" },
        { encoding: "gbk" }
      )
    ).toBeNull();
    expect(textPreferencePatch("set-eol", { textEol: "crlf" }, { lineEnding: "CRLF" })).toBeNull();
  });

  it("carries only the keys that moved", () => {
    // The encoding is unchanged, so it stays out of the patch: `patchAssetExtras` merges, and a
    // patch that restates an untouched key is a line in someone's next commit for nothing.
    expect(
      textPreferencePatch(
        "set-eol",
        { textEncoding: "gbk", textEol: "crlf" },
        { encoding: "gbk", lineEnding: "LF" }
      )
    ).toEqual({ textEol: "lf" });
  });
});
