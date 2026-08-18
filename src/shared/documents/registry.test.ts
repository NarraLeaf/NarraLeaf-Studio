import { describe, expect, it } from "vitest";
import {
  defineDocumentSpec,
  DocumentRegistrationError,
  DocumentRegistry,
  getDocumentSpec,
  resolveDocumentSpecForPath
} from "@shared/documents/registry";
import { DocumentPathError } from "@shared/documents/documentPath";
import { DocumentKind, DocumentSpec } from "@shared/documents/types";

/**
 * Fixture specs, not the real ones: H1 deliberately registers nothing, so the
 * machinery is exercised against the path shapes ProjectNameConvention actually
 * declares while the eight services stay untouched until H2.
 */
function fixtureSpec(kind: DocumentKind, paths: readonly string[]): DocumentSpec<unknown> {
  return defineDocumentSpec<unknown>({
    kind,
    version: 1,
    paths,
    parse: (raw) => raw,
    summarize: () => ({ title: "", counts: [] })
  });
}

function conventionRegistry(): DocumentRegistry {
  const registry = new DocumentRegistry();
  registry.register(fixtureSpec("project", ["project.json"]));
  registry.register(fixtureSpec("story-index", ["editor/story/index.json"]));
  registry.register(fixtureSpec("story", ["editor/story/stories/<storyId>/storydoc.json"]));
  registry.register(fixtureSpec("story-animation-index", ["editor/story/animations/index.json"]));
  registry.register(fixtureSpec("story-animation", ["editor/story/animations/<animationId>.json"]));
  registry.register(fixtureSpec("ui-document", ["editor/ui/uidoc.json"]));
  registry.register(fixtureSpec("ui-graphs", ["editor/ui/uigraphs.json"]));
  registry.register(fixtureSpec("variables", ["editor/variables.json"]));
  registry.register(fixtureSpec("localization-keys", ["editor/localization/keys.json"]));
  registry.register(fixtureSpec("localization", ["editor/localization/<locale>.json"]));
  registry.register(fixtureSpec("voice", ["editor/voice/<locale>.json"]));
  registry.register(fixtureSpec("assets-metadata", ["assets/assets.metadata.<type>.json"]));
  registry.register(fixtureSpec("assets-groups", ["assets/assets.groups.<type>.json"]));
  return registry;
}

describe("DocumentRegistry.resolve", () => {
  const registry = conventionRegistry();

  it("resolves every fixed path from ProjectNameConvention", () => {
    expect(registry.resolve("project.json")?.spec.kind).toBe("project");
    expect(registry.resolve("editor/story/index.json")?.spec.kind).toBe("story-index");
    expect(registry.resolve("editor/ui/uidoc.json")?.spec.kind).toBe("ui-document");
    expect(registry.resolve("editor/ui/uigraphs.json")?.spec.kind).toBe("ui-graphs");
    expect(registry.resolve("editor/variables.json")?.spec.kind).toBe("variables");
  });

  it("resolves parameterised paths and reports the captured id", () => {
    expect(registry.resolve("editor/story/stories/1f0a-77/storydoc.json")).toEqual({
      spec: expect.objectContaining({ kind: "story" }),
      parameters: { storyId: "1f0a-77" }
    });
    expect(registry.resolve("editor/voice/zh-CN.json")).toEqual({
      spec: expect.objectContaining({ kind: "voice" }),
      parameters: { locale: "zh-CN" }
    });
    expect(registry.resolve("assets/assets.metadata.image.json")).toEqual({
      spec: expect.objectContaining({ kind: "assets-metadata" }),
      parameters: { type: "image" }
    });
    expect(registry.resolve("assets/assets.groups.video.json")?.spec.kind).toBe("assets-groups");
  });

  it("accepts Windows separators, which is how callers will hand paths over", () => {
    expect(registry.resolve("editor\\ui\\uidoc.json")?.spec.kind).toBe("ui-document");
    expect(registry.resolve("editor\\story\\stories\\abc\\storydoc.json")).toEqual({
      spec: expect.objectContaining({ kind: "story" }),
      parameters: { storyId: "abc" }
    });
    expect(registry.resolve("assets\\assets.metadata.audio.json")?.spec.kind).toBe(
      "assets-metadata"
    );
  });

  it("gives a literal path priority over a parameterised one that also matches it", () => {
    expect(registry.resolve("editor/story/animations/index.json")?.spec.kind).toBe(
      "story-animation-index"
    );
    expect(registry.resolve("editor/story/animations/fade-in.json")?.spec.kind).toBe(
      "story-animation"
    );
    expect(registry.resolve("editor/localization/keys.json")?.spec.kind).toBe("localization-keys");
    expect(registry.resolve("editor/localization/en-US.json")?.spec.kind).toBe("localization");
  });

  it("does not depend on registration order for that priority", () => {
    const reversed = new DocumentRegistry();
    reversed.register(fixtureSpec("localization", ["editor/localization/<locale>.json"]));
    reversed.register(fixtureSpec("localization-keys", ["editor/localization/keys.json"]));

    expect(reversed.resolve("editor/localization/keys.json")?.spec.kind).toBe("localization-keys");
    expect(reversed.resolve("editor/localization/fr.json")?.spec.kind).toBe("localization");
  });

  it("returns undefined for project files that are not documents", () => {
    expect(registry.resolve("assets/content/ab/cd/ef")).toBeUndefined();
    expect(registry.resolve("editor/cache/thumbnail/ab/cd/asset-1.png")).toBeUndefined();
    expect(registry.resolve("resources/icons/derived/icon-512.png")).toBeUndefined();
    expect(registry.resolve(".nlstudio/editor.json")).toBeUndefined();
    expect(registry.resolve("editor/story/stories/abc/notes.json")).toBeUndefined();
  });

  it("throws rather than silently missing when handed a path that is not project-relative", () => {
    // Lore reports absolute paths; an absolute path resolving to undefined would look
    // like a project with no documents in it at all.
    expect(() => registry.resolve("D:/Projects/game/editor/ui/uidoc.json")).toThrow(
      DocumentPathError
    );
    expect(() => registry.resolve("../outside/project.json")).toThrow(DocumentPathError);
  });
});

describe("DocumentRegistry.register", () => {
  it("refuses the same path twice", () => {
    const registry = new DocumentRegistry();
    registry.register(fixtureSpec("ui-document", ["editor/ui/uidoc.json"]));

    expect(() => registry.register(fixtureSpec("ui-graphs", ["editor/ui/uidoc.json"]))).toThrow(
      DocumentRegistrationError
    );
  });

  it("refuses the same path expressed through equivalent patterns", () => {
    const registry = new DocumentRegistry();
    registry.register(fixtureSpec("localization", ["editor/localization/<locale>.json"]));

    expect(() =>
      registry.register(fixtureSpec("voice", ["editor/localization/<code>.json"]))
    ).toThrow(DocumentRegistrationError);
  });

  it("refuses an overlap where neither pattern is more specific", () => {
    const registry = new DocumentRegistry();
    registry.register(fixtureSpec("story", ["editor/story/story.<rest>"]));

    expect(() => registry.register(fixtureSpec("voice", ["editor/story/<name>.json"]))).toThrow(
      /neither is more specific/
    );
  });

  it("refuses a spec declaring one path twice", () => {
    const registry = new DocumentRegistry();

    expect(() =>
      registry.register(
        fixtureSpec("story", [
          "editor/story/stories/<storyId>/storydoc.json",
          "editor/story/stories/<id>/storydoc.json"
        ])
      )
    ).toThrow(DocumentRegistrationError);
  });

  it("refuses a second spec for the same kind", () => {
    const registry = new DocumentRegistry();
    registry.register(fixtureSpec("voice", ["editor/voice/<locale>.json"]));

    expect(() => registry.register(fixtureSpec("voice", ["editor/voice/legacy.json"]))).toThrow(
      /already registered/
    );
  });

  it("refuses a spec with no paths", () => {
    expect(() => new DocumentRegistry().register(fixtureSpec("voice", []))).toThrow(
      DocumentRegistrationError
    );
  });

  it("accepts a spec owning several unrelated paths", () => {
    const registry = new DocumentRegistry();
    registry.register(
      fixtureSpec("story", [
        "editor/story/index.json",
        "editor/story/stories/<storyId>/storydoc.json"
      ])
    );

    expect(registry.resolve("editor/story/index.json")?.spec.kind).toBe("story");
    expect(registry.resolve("editor/story/stories/x/storydoc.json")?.parameters).toEqual({
      storyId: "x"
    });
  });

  it("makes registration failure leave the registry usable", () => {
    const registry = new DocumentRegistry();
    registry.register(fixtureSpec("ui-document", ["editor/ui/uidoc.json"]));
    expect(() => registry.register(fixtureSpec("ui-graphs", ["editor/ui/uidoc.json"]))).toThrow();

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("ui-graphs")).toBeUndefined();
    expect(registry.resolve("editor/ui/uidoc.json")?.spec.kind).toBe("ui-document");
  });
});

describe("defineDocumentSpec", () => {
  it("derives matches() from the declared paths", () => {
    const spec = fixtureSpec("story", ["editor/story/stories/<storyId>/storydoc.json"]);

    expect(spec.matches("editor/story/stories/abc/storydoc.json")).toBe(true);
    expect(spec.matches("editor\\story\\stories\\abc\\storydoc.json")).toBe(true);
    expect(spec.matches("editor/story/index.json")).toBe(false);
  });

  it("builds paths from parameters, and agrees with matches()", () => {
    const story = fixtureSpec("story", ["editor/story/stories/<storyId>/storydoc.json"]);
    const locale = fixtureSpec("localization", ["editor/localization/<locale>.json"]);
    const assets = fixtureSpec("assets-metadata", ["assets/assets.metadata.<type>.json"]);

    expect(story.pathFor({ storyId: "1f0a-77" })).toBe(
      "editor/story/stories/1f0a-77/storydoc.json"
    );
    expect(locale.pathFor({ locale: "zh-CN" })).toBe("editor/localization/zh-CN.json");
    expect(assets.pathFor({ type: "image" })).toBe("assets/assets.metadata.image.json");

    for (const [spec, parameters] of [
      [story, { storyId: "x" }],
      [locale, { locale: "fr" }],
      [assets, { type: "audio" }]
    ] as const) {
      expect(spec.matches(spec.pathFor(parameters))).toBe(true);
    }
  });

  /**
   * The optional members have to be FORWARDED, not merely declared.
   *
   * D1 declared `diff` on the spec interface and left it out of `DocumentSpecDefinition`, so
   * `defineDocumentSpec` dropped every implementation on the floor - and nothing reported it,
   * because `undefined` there is a legitimate answer the diff engine reads to fall back a tier.
   * `merge3` fails worse: its fallback is not a lesser change list, it is the author resolving
   * the whole file from one side. Absence must stay absence and presence must survive.
   */
  it("forwards diff and merge3, and leaves them absent when the definition has none", () => {
    const bare = fixtureSpec("story", ["editor/story/index.json"]);
    expect(bare.diff).toBeUndefined();
    expect(bare.merge3).toBeUndefined();

    const diff = { changes: [], complete: true, total: 0, tier: "semantic" } as const;
    const merge = { document: "merged", decisions: [], conflicts: 0 } as const;
    const full = defineDocumentSpec<string>({
      kind: "story",
      version: 1,
      paths: ["editor/story/index.json"],
      parse: (raw) => String(raw),
      summarize: () => ({ title: "", counts: [] }),
      diff: () => diff,
      merge3: () => merge
    });

    expect(full.diff?.("a", "b", { limit: 10 })).toBe(diff);
    expect(full.merge3?.(undefined, "a", "b")).toBe(merge);
  });

  it("builds a fixed path when the spec takes no parameters", () => {
    const spec = fixtureSpec("ui-document", ["editor/ui/uidoc.json"]);

    expect(spec.pathFor()).toBe("editor/ui/uidoc.json");
    expect(spec.pathFor({})).toBe("editor/ui/uidoc.json");
  });

  it("picks the pattern matching exactly the parameters supplied", () => {
    const spec = fixtureSpec("story", [
      "editor/story/index.json",
      "editor/story/stories/<storyId>/storydoc.json"
    ]);

    expect(spec.pathFor()).toBe("editor/story/index.json");
    expect(spec.pathFor({ storyId: "abc" })).toBe("editor/story/stories/abc/storydoc.json");
  });

  it("refuses a missing, misspelled, extra or empty parameter", () => {
    const spec = fixtureSpec("story", ["editor/story/stories/<storyId>/storydoc.json"]);

    expect(() => spec.pathFor()).toThrow(DocumentPathError);
    expect(() => spec.pathFor({})).toThrow(/No path of the "story" document/);
    expect(() => spec.pathFor({ storyID: "abc" })).toThrow(DocumentPathError);
    expect(() => spec.pathFor({ storyId: "abc", extra: "x" })).toThrow(DocumentPathError);
    expect(() => spec.pathFor({ storyId: "" })).toThrow(/missing or empty/);
  });

  it("refuses a parameter value that would forge a different path", () => {
    const spec = fixtureSpec("story", ["editor/story/stories/<storyId>/storydoc.json"]);

    expect(() => spec.pathFor({ storyId: "a/b" })).toThrow(DocumentPathError);
    expect(() => spec.pathFor({ storyId: "a\\b" })).toThrow(DocumentPathError);
    expect(() => spec.pathFor({ storyId: ".." })).toThrow(DocumentPathError);
    expect(() => spec.pathFor({ storyId: "x\0y" })).toThrow(DocumentPathError);
  });

  it("refuses to guess between two paths taking the same parameters", () => {
    const spec = fixtureSpec("assets-metadata", [
      "assets/assets.metadata.<type>.json",
      "assets/assets.groups.<type>.json"
    ]);

    expect(() => spec.pathFor({ type: "image" })).toThrow(/split into separate kinds/);
  });

  it("round-trips against resolve for every convention path shape", () => {
    const registry = conventionRegistry();
    const cases: [string, Record<string, string>][] = [
      ["project", {}],
      ["ui-document", {}],
      ["variables", {}],
      ["localization-keys", {}],
      ["story", { storyId: "1f0a" }],
      ["story-animation", { animationId: "fade-in" }],
      ["localization", { locale: "zh-CN" }],
      ["voice", { locale: "en-US" }],
      ["assets-metadata", { type: "image" }],
      ["assets-groups", { type: "video" }]
    ];

    for (const [kind, parameters] of cases) {
      const spec = registry.get(kind as DocumentKind);
      const path = spec?.pathFor(parameters) ?? "";
      const resolved = registry.resolve(path);

      expect(resolved?.spec.kind, path).toBe(kind);
      expect(resolved?.parameters, path).toEqual(parameters);
    }
  });

  it("serialises to canonical JSON unless the spec says otherwise", () => {
    expect(fixtureSpec("story", ["editor/story/index.json"]).serialize({ b: 1, a: 2 })).toBe(
      '{\n  "a": 2,\n  "b": 1\n}\n'
    );

    const custom = defineDocumentSpec<string>({
      kind: "project",
      version: 1,
      paths: ["project.json"],
      parse: (raw) => String(raw),
      serialize: (document) => document,
      summarize: () => ({ title: "", counts: [] })
    });
    expect(custom.serialize("raw")).toBe("raw");
  });
});

describe("the process-wide registry", () => {
  it("has no specs registered in H1, so nothing resolves yet", () => {
    // H2 is what fills this in. If this test starts failing, a spec has been
    // registered as a module side effect and the migration has begun early.
    expect(getDocumentSpec("story")).toBeUndefined();
    expect(resolveDocumentSpecForPath("editor/story/index.json")).toBeUndefined();
  });
});
