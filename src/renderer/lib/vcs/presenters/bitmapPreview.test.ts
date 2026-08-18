import { describe, expect, it } from "vitest";
import type { DocumentChangeKind, DocumentDiffEntry } from "@shared/documents/diff";
import {
  bitmapMediaType,
  comparableModes,
  FRAME_MAX_HEIGHT,
  framedImageStyle,
  frameStyle,
  isBitmapEntry,
  unionBox
} from "./bitmapPreview";
import type { ComparisonSides } from "./comparisonSide";
import { sidesOfEntry } from "./entrySides";

/**
 * The four decisions an image comparison is made of, each of which is wrong in a way that looks
 * fine on screen: claiming a file this cannot draw, labelling bytes with a type the browser will
 * not decode, offering a comparison the two images do not support, and scaling them so that a
 * change of size disappears.
 */

const entry = (path: string, over: Partial<DocumentDiffEntry> = {}): DocumentDiffEntry => ({
  path,
  kind: "changed",
  diff: { changes: [], complete: true, total: 0, tier: "content" },
  ...over
});

const SIDES: ComparisonSides = {
  before: { at: "revision", revision: "r1" },
  after: { at: "working-tree" }
};

describe("which files this draws", () => {
  it("claims what the comparison classified as a bitmap, name or no name", () => {
    // The case the whole field exists for: an asset's contents live under its id, sharded, and
    // there is no extension anywhere in the path for anything here to read.
    expect(
      isBitmapEntry(
        entry("assets/content/99/55/3d15abb54213bad7203798a1adc4", {
          contentClass: "bitmap"
        })
      )
    ).toBe(true);
    expect(isBitmapEntry(entry("assets/content/sprite.png"))).toBe(true);
  });

  it("declines what it cannot draw, including an image the comparison says is something else", () => {
    expect(isBitmapEntry(entry("assets/content/theme.mp3"))).toBe(false);
    expect(isBitmapEntry(entry("editor/story/index.json"))).toBe(false);
    // An SVG is XML and is compared as text; drawing it here would take it away from a
    // comparison that can say which line changed.
    expect(isBitmapEntry(entry("assets/content/logo.svg"))).toBe(false);
    // The name says PNG, the bytes said otherwise, and the bytes are the evidence.
    expect(isBitmapEntry(entry("assets/content/fake.png", { contentClass: "audio" }))).toBe(false);
  });

  it("claims a sprite that was deleted, which is where the class used to run out", () => {
    // The half of the deletion fix that lives on this side. The comparison could not place a
    // removal - there is nothing on disk to probe - so a deleted sprite arrived as `unknown`,
    // this declined it, and the author was told "removed, 58.7 KB" about the one change where
    // seeing the file matters most. `workingTreeDiff` now places it from the bytes it already
    // pulled, and the only thing left for this to do is claim it.
    const removed = entry("assets/content/99/55/3d15abb54213bad7203798a1adc4", {
      kind: "removed",
      contentClass: "bitmap"
    });

    expect(isBitmapEntry(removed)).toBe(true);
    expect(sidesOfEntry(removed, SIDES)).toEqual({ before: SIDES.before, after: null });
  });

  it("reads one side for a file that exists on one side", () => {
    const added = sidesOfEntry(entry("a", { kind: "added" }), SIDES);
    expect(added).toEqual({ before: null, after: SIDES.after });

    const removed = sidesOfEntry(entry("a", { kind: "removed" }), SIDES);
    expect(removed).toEqual({ before: SIDES.before, after: null });

    // A move is a file with the same bytes under two names: there is nothing to compare, so
    // it is drawn once rather than against itself.
    const moved = sidesOfEntry(entry("a", { kind: "moved" as DocumentChangeKind }), SIDES);
    expect(moved).toEqual({ before: null, after: SIDES.after });
  });

  it("reads nothing when the host named no versions", () => {
    expect(sidesOfEntry(entry("a"), undefined)).toEqual({ before: null, after: null });
  });
});

describe("what a browser will decode", () => {
  const head = (...bytes: number[]): Uint8Array => new Uint8Array([...bytes, ...Array(16).fill(0)]);
  const ascii = (text: string, ...rest: number[]): Uint8Array =>
    new Uint8Array([
      ...[...text].map((character) => character.charCodeAt(0)),
      ...rest,
      ...Array(16).fill(0)
    ]);

  it("names the type of every still Chromium can draw", () => {
    expect(bitmapMediaType(head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(bitmapMediaType(head(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(bitmapMediaType(ascii("GIF89a"))).toBe("image/gif");
    expect(bitmapMediaType(ascii("RIFF", 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe("image/webp");
    expect(bitmapMediaType(new Uint8Array([0x42, 0x4d, 1, 1, 1, 1, 0, 0, 0, 0, 1]))).toBe(
      "image/bmp"
    );
    expect(bitmapMediaType(ascii("\0\0\0\0ftypavif"))).toBe("image/avif");
    expect(bitmapMediaType(new Uint8Array([0, 0, 1, 0, 2, 0, 0, 0]))).toBe("image/x-icon");
  });

  it("declines a still Chromium has no decoder for, rather than guessing a type", () => {
    // TIFF is a bitmap by every other measure in this codebase and an `<img>` cannot show one,
    // so the honest answer here is nothing at all. A guessed type is a broken-image icon with
    // no sentence beside it.
    expect(bitmapMediaType(new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]))).toBeNull();
    expect(bitmapMediaType(ascii("\0\0\0\0ftypheic"))).toBeNull();
    expect(bitmapMediaType(ascii('{"a": 1}'))).toBeNull();
    expect(bitmapMediaType(new Uint8Array([0x89]))).toBeNull();
  });
});

describe("which comparisons two images support", () => {
  it("offers all three when the two are the same size", () => {
    expect(comparableModes({ width: 1024, height: 1024 }, { width: 1024, height: 1024 })).toEqual([
      "side-by-side",
      "swipe",
      "difference"
    ]);
  });

  it("leaves difference out when the sizes changed", () => {
    // Subtracting one image from another needs the same pixels in the same places. Stretched
    // to a common frame, two sizes differ nearly everywhere and the mode would light the whole
    // picture up - a screen full of signal that means nothing.
    expect(comparableModes({ width: 1088, height: 1984 }, { width: 1024, height: 1024 })).toEqual([
      "side-by-side",
      "swipe"
    ]);
    expect(comparableModes({ width: 1024, height: 1024 }, { width: 1024, height: 512 })).toEqual([
      "side-by-side",
      "swipe"
    ]);
  });

  it("offers nothing at all when there is only one image", () => {
    expect(comparableModes(null, { width: 8, height: 8 })).toEqual([]);
    expect(comparableModes({ width: 8, height: 8 }, null)).toEqual([]);
  });
});

describe("how the two are scaled", () => {
  it("draws both against one box, so a smaller image is smaller on screen", () => {
    const before = { width: 1024, height: 1024 };
    const after = { width: 512, height: 512 };
    const box = unionBox(before, after);

    expect(box).toEqual({ width: 1024, height: 1024 });
    expect(framedImageStyle(before, box!)).toMatchObject({ width: "100%", height: "100%" });
    // The whole point: fitted to its own frame this would also be 100%, and a sprite that
    // halved would look identical to one that did not change at all.
    expect(framedImageStyle(after, box!)).toMatchObject({ width: "50%", height: "50%" });
  });

  it("takes the larger of each direction, which is neither image on its own", () => {
    expect(unionBox({ width: 1088, height: 512 }, { width: 640, height: 1984 })).toEqual({
      width: 1088,
      height: 1984
    });
  });

  it("is the one image's own box when there is only one", () => {
    expect(unionBox(null, { width: 300, height: 200 })).toEqual({ width: 300, height: 200 });
    expect(unionBox({ width: 300, height: 200 }, null)).toEqual({ width: 300, height: 200 });
  });

  it("caps a tall frame by its width, so the picture gets smaller rather than squashed", () => {
    // A max-height beside an aspect ratio shortens the frame and not the images inside it,
    // which are a share of it - the one way this layout can distort what it is showing.
    const tall = frameStyle({ width: 1024, height: 4096 });

    expect(tall.aspectRatio).toBe("1024 / 4096");
    expect(tall.maxWidth).toBe(`${Math.round((1024 / 4096) * FRAME_MAX_HEIGHT)}px`);
    expect(tall.maxHeight).toBeUndefined();
  });
});
