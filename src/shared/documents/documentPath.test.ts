import { describe, expect, it } from "vitest";
import {
  compileDocumentPathPattern,
  documentPathPatternsOverlap,
  documentPathPatternSubsumes,
  DocumentPathError,
  matchDocumentPath,
  normalizeDocumentPath
} from "@shared/documents/documentPath";

describe("normalizeDocumentPath", () => {
  it("converts Windows separators", () => {
    expect(normalizeDocumentPath("editor\\story\\index.json")).toBe("editor/story/index.json");
    expect(normalizeDocumentPath("editor/ui\\uidoc.json")).toBe("editor/ui/uidoc.json");
  });

  it("leaves an already-normalised path alone", () => {
    expect(normalizeDocumentPath("project.json")).toBe("project.json");
  });

  it("rejects absolute paths in both host flavours", () => {
    expect(() => normalizeDocumentPath("D:/Projects/game/project.json")).toThrow(DocumentPathError);
    expect(() => normalizeDocumentPath("D:\\Projects\\game\\project.json")).toThrow(
      DocumentPathError
    );
    expect(() => normalizeDocumentPath("/home/me/game/project.json")).toThrow(DocumentPathError);
  });

  it("rejects traversal, empty segments and blanks", () => {
    expect(() => normalizeDocumentPath("editor/../../etc/passwd")).toThrow(DocumentPathError);
    expect(() => normalizeDocumentPath("./editor/story/index.json")).toThrow(DocumentPathError);
    expect(() => normalizeDocumentPath("editor//index.json")).toThrow(DocumentPathError);
    expect(() => normalizeDocumentPath("editor/story/")).toThrow(DocumentPathError);
    expect(() => normalizeDocumentPath("")).toThrow(DocumentPathError);
    expect(() => normalizeDocumentPath("   ")).toThrow(DocumentPathError);
  });

  it("rejects a NUL byte", () => {
    expect(() => normalizeDocumentPath("editor/story\0/index.json")).toThrow(DocumentPathError);
  });
});

describe("compileDocumentPathPattern", () => {
  it("accepts one parameter per segment, with literal text either side", () => {
    expect(
      compileDocumentPathPattern("editor/story/stories/<storyId>/storydoc.json").segments
    ).toHaveLength(5);
    expect(compileDocumentPathPattern("assets/assets.metadata.<type>.json").segments[1]).toEqual({
      kind: "parameter",
      name: "type",
      prefix: "assets.metadata.",
      suffix: ".json"
    });
  });

  it("rejects two parameters in one segment and malformed parameter names", () => {
    expect(() => compileDocumentPathPattern("assets/<a>.<b>.json")).toThrow(DocumentPathError);
    expect(() => compileDocumentPathPattern("assets/<>.json")).toThrow(DocumentPathError);
    expect(() => compileDocumentPathPattern("assets/<1st>.json")).toThrow(DocumentPathError);
    expect(() => compileDocumentPathPattern("assets/<a-b>.json")).toThrow(DocumentPathError);
  });
});

describe("matchDocumentPath", () => {
  const storyDocument = compileDocumentPathPattern("editor/story/stories/<storyId>/storydoc.json");
  const locale = compileDocumentPathPattern("editor/localization/<locale>.json");
  const assetsMetadata = compileDocumentPathPattern("assets/assets.metadata.<type>.json");
  const uiDocument = compileDocumentPathPattern("editor/ui/uidoc.json");

  it("captures parameters from real project paths", () => {
    expect(matchDocumentPath(storyDocument, "editor/story/stories/9f1c/storydoc.json")).toEqual({
      storyId: "9f1c"
    });
    expect(matchDocumentPath(locale, "editor/localization/zh-CN.json")).toEqual({
      locale: "zh-CN"
    });
    expect(matchDocumentPath(assetsMetadata, "assets/assets.metadata.image.json")).toEqual({
      type: "image"
    });
    expect(matchDocumentPath(uiDocument, "editor/ui/uidoc.json")).toEqual({});
  });

  it("accepts Windows separators", () => {
    expect(matchDocumentPath(storyDocument, "editor\\story\\stories\\9f1c\\storydoc.json")).toEqual(
      { storyId: "9f1c" }
    );
  });

  it("is case-sensitive, because a repository records the case a file was committed with", () => {
    expect(matchDocumentPath(uiDocument, "Editor/UI/uidoc.json")).toBeNull();
  });

  it("requires a parameter to capture at least one character", () => {
    expect(matchDocumentPath(locale, "editor/localization/.json")).toBeNull();
    expect(matchDocumentPath(assetsMetadata, "assets/assets.metadata..json")).toBeNull();
  });

  it("does not let a parameter swallow a separator", () => {
    expect(matchDocumentPath(locale, "editor/localization/nested/en.json")).toBeNull();
    expect(matchDocumentPath(storyDocument, "editor/story/stories/a/b/storydoc.json")).toBeNull();
  });

  it("rejects near misses on the literal segments", () => {
    expect(matchDocumentPath(storyDocument, "editor/story/stories/9f1c/index.json")).toBeNull();
    expect(matchDocumentPath(assetsMetadata, "assets/assets.groups.image.json")).toBeNull();
    expect(matchDocumentPath(uiDocument, "editor/ui/uigraphs.json")).toBeNull();
  });
});

describe("pattern overlap and specificity", () => {
  const animationIndex = compileDocumentPathPattern("editor/story/animations/index.json");
  const animationDocument = compileDocumentPathPattern(
    "editor/story/animations/<animationId>.json"
  );
  const localizationKeys = compileDocumentPathPattern("editor/localization/keys.json");
  const localizationLocale = compileDocumentPathPattern("editor/localization/<locale>.json");
  const assetsMetadata = compileDocumentPathPattern("assets/assets.metadata.<type>.json");
  const assetsGroups = compileDocumentPathPattern("assets/assets.groups.<type>.json");

  it("sees a literal path inside a parameterised one, and calls the literal more specific", () => {
    // Both of these pairs are real: ProjectNameConvention puts index.json beside the
    // per-animation documents and keys.json beside the per-locale ones.
    expect(documentPathPatternsOverlap(animationIndex, animationDocument)).toBe(true);
    expect(documentPathPatternSubsumes(animationIndex, animationDocument)).toBe(true);
    expect(documentPathPatternSubsumes(animationDocument, animationIndex)).toBe(false);

    expect(documentPathPatternsOverlap(localizationKeys, localizationLocale)).toBe(true);
    expect(documentPathPatternSubsumes(localizationKeys, localizationLocale)).toBe(true);
  });

  it("sees no overlap between patterns with different literal text", () => {
    expect(documentPathPatternsOverlap(assetsMetadata, assetsGroups)).toBe(false);
    expect(documentPathPatternsOverlap(animationIndex, localizationKeys)).toBe(false);
  });

  it("sees no overlap between patterns of different lengths", () => {
    expect(
      documentPathPatternsOverlap(
        compileDocumentPathPattern("editor/<a>.json"),
        compileDocumentPathPattern("editor/story/<a>.json")
      )
    ).toBe(false);
  });

  it("compares two parameterised patterns by prefix and suffix", () => {
    const wide = compileDocumentPathPattern("assets/<name>.json");
    const narrow = compileDocumentPathPattern("assets/assets.<type>.json");
    const other = compileDocumentPathPattern("assets/<name>.metadata");

    expect(documentPathPatternSubsumes(narrow, wide)).toBe(true);
    expect(documentPathPatternSubsumes(wide, narrow)).toBe(false);
    expect(documentPathPatternsOverlap(wide, other)).toBe(false);
  });

  it("treats crossing parameterised patterns as an overlap neither side contains", () => {
    const byPrefix = compileDocumentPathPattern("assets/story.<rest>");
    const bySuffix = compileDocumentPathPattern("assets/<name>.json");

    // "story.x.json" matches both, yet neither pattern is inside the other.
    expect(documentPathPatternsOverlap(byPrefix, bySuffix)).toBe(true);
    expect(documentPathPatternSubsumes(byPrefix, bySuffix)).toBe(false);
    expect(documentPathPatternSubsumes(bySuffix, byPrefix)).toBe(false);
  });
});
