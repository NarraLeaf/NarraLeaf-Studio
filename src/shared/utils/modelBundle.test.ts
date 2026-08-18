import { describe, expect, it } from "vitest";
import {
  bundleListingFingerprint,
  detectModelBundleEntry,
  listModelEntryChoices,
  normalizeBundlePath,
  sortBundlePaths
} from "./modelBundle";

/** The real Hiyori tree, path-for-path (18 files, three levels). */
const HIYORI = [
  "Hiyori.2048/texture_00.png",
  "Hiyori.2048/texture_01.png",
  "Hiyori.cdi3.json",
  "Hiyori.moc3",
  "Hiyori.model3.json",
  "Hiyori.physics3.json",
  "Hiyori.pose3.json",
  "Hiyori.userdata3.json",
  ...Array.from(
    { length: 10 },
    (_, i) => `motions/Hiyori_m${String(i + 1).padStart(2, "0")}.motion3.json`
  )
];

/** The real spineboy export: two atlases, and a skeleton shipped in both encodings. */
const SPINEBOY = [
  "spineboy-pma.atlas",
  "spineboy-pma.png",
  "spineboy-pro.json",
  "spineboy-pro.skel",
  "spineboy.atlas",
  "spineboy.png"
];

describe("normalizeBundlePath", () => {
  it("unifies separators and strips no-op segments", () => {
    expect(normalizeBundlePath("Hiyori.2048\\texture_00.png")).toBe("Hiyori.2048/texture_00.png");
    expect(normalizeBundlePath("./motions/a.json")).toBe("motions/a.json");
    expect(normalizeBundlePath("/leading/slash.json")).toBe("leading/slash.json");
  });

  it("refuses anything that leaves the bundle root", () => {
    // Not "skip the file": a bundle missing one texture renders wrong, and a silent skip is how
    // that becomes untraceable.
    expect(normalizeBundlePath("../outside.png")).toBeNull();
    expect(normalizeBundlePath("a/../../outside.png")).toBeNull();
    expect(normalizeBundlePath("")).toBeNull();
  });
});

describe("detectModelBundleEntry", () => {
  it("picks the Cubism 4 manifest out of Hiyori", () => {
    const detection = detectModelBundleEntry(HIYORI);
    expect(detection.entry).toBe("Hiyori.model3.json");
    expect(detection.candidates[0].format).toBe("live2d-cubism4");
  });

  it("never mistakes a Live2D sidecar for the entry", () => {
    // `physics3`/`cdi3`/`pose3`/`userdata3` are all `*.json` sitting next to the manifest.
    const detection = detectModelBundleEntry(HIYORI);
    expect(detection.candidates.map((candidate) => candidate.path)).toEqual(["Hiyori.model3.json"]);
  });

  it("prefers the binary Spine skeleton, and does not treat its JSON twin as a rival", () => {
    // Both files are the same skeleton in two encodings; a tie between them is not ambiguity.
    const detection = detectModelBundleEntry(SPINEBOY);
    expect(detection.entry).toBe("spineboy-pro.skel");
    expect(detection.reason).toBeUndefined();
  });

  it("falls back to the Spine JSON skeleton when no .skel was exported", () => {
    const detection = detectModelBundleEntry([
      "spineboy.atlas",
      "spineboy.png",
      "spineboy-pro.json"
    ]);
    expect(detection.entry).toBe("spineboy-pro.json");
    expect(detection.candidates[0].format).toBe("spine-json");
  });

  it("asks rather than guesses when a folder holds two models", () => {
    const detection = detectModelBundleEntry([...HIYORI, "Other.model3.json", "Other.moc3"]);
    expect(detection.entry).toBeNull();
    expect(detection.reason).toBe("ambiguous");
    expect(detection.candidates).toHaveLength(2);
  });

  it("prefers a manifest at the root over one nested deeper", () => {
    const detection = detectModelBundleEntry(["Hiyori.model3.json", "variants/Hiyori.model3.json"]);
    expect(detection.entry).toBe("Hiyori.model3.json");
  });

  it("reports 'none' for a tree with nothing manifest-shaped", () => {
    const detection = detectModelBundleEntry(["readme.txt", "textures/a.png"]);
    expect(detection.entry).toBeNull();
    expect(detection.reason).toBe("none");
    expect(detection.candidates).toEqual([]);
  });
});

describe("listModelEntryChoices", () => {
  it("offers every file, ranked guesses first", () => {
    // The one case the override exists for - a format Studio has never seen - must not be the
    // one case the picker cannot express.
    const choices = listModelEntryChoices(HIYORI);
    expect(choices[0]).toBe("Hiyori.model3.json");
    expect(choices).toHaveLength(HIYORI.length);
    expect(new Set(choices)).toEqual(new Set(HIYORI));
  });
});

describe("sortBundlePaths / bundleListingFingerprint", () => {
  it("orders independently of discovery order", () => {
    expect(sortBundlePaths([...HIYORI].reverse())).toEqual(sortBundlePaths(HIYORI));
  });

  it("is stable across enumeration order but moves when the file set changes", () => {
    // `files` lands in a version-controlled project file; an order-dependent digest would put a
    // spurious diff in every re-import of the same folder.
    expect(bundleListingFingerprint([...HIYORI].reverse())).toBe(bundleListingFingerprint(HIYORI));
    expect(bundleListingFingerprint([...HIYORI, "extra.png"])).not.toBe(
      bundleListingFingerprint(HIYORI)
    );
    expect(bundleListingFingerprint(HIYORI.slice(1))).not.toBe(bundleListingFingerprint(HIYORI));
  });
});
