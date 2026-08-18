import { describe, expect, it } from "vitest";
import {
  collectLive2dReferences,
  collectSpineAtlasPages,
  isAncestorDirectory,
  isRequiredModelRole,
  isSpineAtlasName,
  isSpineSkeletonBinaryName,
  live2dManifestKind,
  looksLikeSpineSkeletonJson,
  parseSpineAtlasPages,
  resolveModelReference,
  stemOf
} from "./modelImportScan";

describe("live2dManifestKind", () => {
  it("names the two generations and nothing else", () => {
    expect(live2dManifestKind("Hiyori.model3.json")).toBe("cubism4");
    expect(live2dManifestKind("HIYORI.MODEL3.JSON")).toBe("cubism4");
    expect(live2dManifestKind("model.json")).toBe("cubism2");
    expect(live2dManifestKind("haru.model.json")).toBe("cubism2");
    expect(live2dManifestKind("Hiyori.physics3.json")).toBeNull();
    expect(live2dManifestKind("skeleton.json")).toBeNull();
  });
});

describe("collectLive2dReferences", () => {
  const cubism4 = {
    Version: 3,
    FileReferences: {
      Moc: "Hiyori.moc3",
      Textures: ["Hiyori.2048/texture_00.png", "Hiyori.2048/texture_01.png"],
      Physics: "Hiyori.physics3.json",
      Pose: "Hiyori.pose3.json",
      DisplayInfo: "Hiyori.cdi3.json",
      UserData: "Hiyori.userdata3.json",
      Expressions: [{ Name: "f01", File: "expressions/f01.exp3.json" }],
      Motions: {
        Idle: [
          { File: "motions/Hiyori_m01.motion3.json", Sound: "sounds/voice.wav" },
          { File: "motions/Hiyori_m02.motion3.json" }
        ],
        TapBody: [{ File: "motions/Hiyori_m03.motion3.json" }]
      }
    }
  };

  it("collects every reference, resolved against the manifest's folder", () => {
    const { references } = collectLive2dReferences(cubism4, "cubism4", "Hiyori");
    expect(references.map((reference) => reference.path)).toEqual([
      "Hiyori/Hiyori.moc3",
      "Hiyori/Hiyori.2048/texture_00.png",
      "Hiyori/Hiyori.2048/texture_01.png",
      "Hiyori/Hiyori.physics3.json",
      "Hiyori/Hiyori.pose3.json",
      "Hiyori/Hiyori.cdi3.json",
      "Hiyori/Hiyori.userdata3.json",
      "Hiyori/expressions/f01.exp3.json",
      "Hiyori/motions/Hiyori_m01.motion3.json",
      "Hiyori/sounds/voice.wav",
      "Hiyori/motions/Hiyori_m02.motion3.json",
      "Hiyori/motions/Hiyori_m03.motion3.json"
    ]);
  });

  it("marks only moc and textures as required", () => {
    const { references } = collectLive2dReferences(cubism4, "cubism4", "");
    const required = references.filter((reference) => isRequiredModelRole(reference.role));
    expect(required.map((reference) => reference.path)).toEqual([
      "Hiyori.moc3",
      "Hiyori.2048/texture_00.png",
      "Hiyori.2048/texture_01.png"
    ]);
  });

  it("reads Cubism 2's lowercase spelling of the same shape", () => {
    const { references } = collectLive2dReferences(
      {
        version: "Sample 1.0.0",
        model: "moc/haru.moc",
        textures: ["moc/haru.1024/texture_00.png"],
        physics: "moc/haru.physics.json",
        expressions: [{ name: "f01", file: "expressions/f01.exp.json" }],
        motions: { idle: [{ file: "motions/idle_00.mtn", sound: "sounds/idle.mp3" }] }
      },
      "cubism2",
      "haru"
    );
    expect(references).toEqual([
      { path: "haru/moc/haru.moc", role: "moc", raw: "moc/haru.moc" },
      {
        path: "haru/moc/haru.1024/texture_00.png",
        role: "texture",
        raw: "moc/haru.1024/texture_00.png"
      },
      { path: "haru/moc/haru.physics.json", role: "physics", raw: "moc/haru.physics.json" },
      {
        path: "haru/expressions/f01.exp.json",
        role: "expression",
        raw: "expressions/f01.exp.json"
      },
      { path: "haru/motions/idle_00.mtn", role: "motion", raw: "motions/idle_00.mtn" },
      { path: "haru/sounds/idle.mp3", role: "sound", raw: "sounds/idle.mp3" }
    ]);
  });

  it("de-duplicates a file named by several motions", () => {
    const { references } = collectLive2dReferences(
      {
        FileReferences: {
          Motions: {
            Idle: [{ File: "m/a.motion3.json", Sound: "s/v.wav" }],
            Tap: [{ File: "m/a.motion3.json", Sound: "s/v.wav" }]
          }
        }
      },
      "cubism4",
      ""
    );
    expect(references).toHaveLength(2);
  });

  it("reports references that point outside the folder instead of resolving them", () => {
    const { references, unusable } = collectLive2dReferences(
      {
        FileReferences: {
          Moc: "../shared/haru.moc3",
          Textures: ["https://cdn.example.com/t.png", "C:/models/t2.png"]
        }
      },
      "cubism4",
      ""
    );
    expect(references).toHaveLength(0);
    expect(unusable).toEqual([
      { raw: "../shared/haru.moc3", role: "moc" },
      { raw: "https://cdn.example.com/t.png", role: "texture" },
      { raw: "C:/models/t2.png", role: "texture" }
    ]);
  });

  it("climbs out of a subfolder when the reference legitimately can", () => {
    const { references, unusable } = collectLive2dReferences(
      {
        FileReferences: { Moc: "../shared/haru.moc3" }
      },
      "cubism4",
      "characters/haru"
    );
    expect(unusable).toHaveLength(0);
    expect(references[0].path).toBe("characters/shared/haru.moc3");
  });

  it("survives a manifest whose fields are the wrong types", () => {
    expect(collectLive2dReferences(null, "cubism4", "").references).toEqual([]);
    expect(collectLive2dReferences({ FileReferences: 7 }, "cubism4", "").references).toEqual([]);
    expect(
      collectLive2dReferences(
        {
          FileReferences: { Moc: 42, Textures: "not-an-array", Motions: [1, 2], Expressions: {} }
        },
        "cubism4",
        ""
      ).references
    ).toEqual([]);
  });
});

describe("parseSpineAtlasPages", () => {
  it("reads one page and stops at the region entries", () => {
    const atlas = [
      "raptor.png",
      "size: 2048,1024",
      "format: RGBA8888",
      "filter: Linear,Linear",
      "repeat: none",
      "back_arm",
      "  rotate: false",
      "  xy: 1, 1",
      "  size: 100, 50",
      "front_arm",
      "  rotate: true",
      "  xy: 103, 1"
    ].join("\n");
    expect(parseSpineAtlasPages(atlas)).toEqual(["raptor.png"]);
  });

  it("reads every page of a multi-page atlas", () => {
    const atlas = [
      "",
      "raptor.png",
      "size: 2048,1024",
      "region_a",
      "  xy: 1, 1",
      "",
      "raptor2.png",
      "size: 2048,1024",
      "region_b",
      "  xy: 1, 1",
      ""
    ].join("\n");
    expect(parseSpineAtlasPages(atlas)).toEqual(["raptor.png", "raptor2.png"]);
  });

  it("reads the 4.x colon-tight header and CRLF line endings", () => {
    const atlas =
      "spineboy.png\r\nsize:1024,256\r\nfilter:Linear,Linear\r\nhead\r\nbounds:2,2,100,100\r\n";
    expect(parseSpineAtlasPages(atlas)).toEqual(["spineboy.png"]);
  });

  it("yields nothing for an empty or blank file", () => {
    expect(parseSpineAtlasPages("")).toEqual([]);
    expect(parseSpineAtlasPages("\n\n   \n")).toEqual([]);
  });

  it("resolves pages against the atlas's own folder", () => {
    const { references } = collectSpineAtlasPages("images/raptor.png\nsize: 1,1\n", "spine/raptor");
    expect(references).toEqual([
      { path: "spine/raptor/images/raptor.png", role: "page", raw: "images/raptor.png" }
    ]);
  });
});

describe("spine skeleton recognition", () => {
  it("keys binary skeletons and atlases off their extension", () => {
    expect(isSpineSkeletonBinaryName("raptor.skel")).toBe(true);
    expect(isSpineSkeletonBinaryName("raptor.json")).toBe(false);
    expect(isSpineAtlasName("raptor.atlas")).toBe(true);
    expect(isSpineAtlasName("raptor.atlas.txt")).toBe(true);
    expect(isSpineAtlasName("raptor.png")).toBe(false);
  });

  it("recognises a JSON skeleton by its header or its bones/slots pair", () => {
    expect(
      looksLikeSpineSkeletonJson({ skeleton: { spine: "4.1.24", hash: "abc" }, bones: [] })
    ).toBe(true);
    expect(looksLikeSpineSkeletonJson({ skeleton: { hash: "abc" } })).toBe(true);
    expect(looksLikeSpineSkeletonJson({ bones: [{ name: "root" }], slots: [] })).toBe(true);
  });

  it("does not claim unrelated JSON", () => {
    expect(looksLikeSpineSkeletonJson({ Version: 3, FileReferences: {} })).toBe(false);
    expect(looksLikeSpineSkeletonJson({ skeleton: "yes" })).toBe(false);
    expect(looksLikeSpineSkeletonJson([1, 2, 3])).toBe(false);
    expect(looksLikeSpineSkeletonJson(null)).toBe(false);
    expect(looksLikeSpineSkeletonJson("{}")).toBe(false);
  });
});

describe("path helpers", () => {
  it("takes the stem up to the first dot so a skeleton and its atlas agree", () => {
    expect(stemOf("raptor.atlas.txt")).toBe("raptor");
    expect(stemOf("raptor.skel")).toBe("raptor");
    expect(stemOf("Hiyori.model3.json")).toBe("Hiyori");
    expect(stemOf("noextension")).toBe("noextension");
  });

  it("treats the scan root as an ancestor of everything but itself", () => {
    expect(isAncestorDirectory("", "haru")).toBe(true);
    expect(isAncestorDirectory("", "")).toBe(false);
    expect(isAncestorDirectory("a", "a/b")).toBe(true);
    expect(isAncestorDirectory("a", "ab")).toBe(false);
    expect(isAncestorDirectory("a/b", "a")).toBe(false);
  });

  it("refuses references that would leave the scanned folder", () => {
    expect(resolveModelReference("", "../out.png")).toBeNull();
    expect(resolveModelReference("a", "../../out.png")).toBeNull();
    expect(resolveModelReference("", "/abs/out.png")).toBeNull();
    expect(resolveModelReference("", "file:///out.png")).toBeNull();
    expect(resolveModelReference("", "  ")).toBeNull();
    expect(resolveModelReference("a", "./b/../c.png")).toBe("a/c.png");
    expect(resolveModelReference("a", "sub\\c.png")).toBe("a/sub/c.png");
  });
});
