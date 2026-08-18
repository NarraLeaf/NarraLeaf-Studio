import { describe, expect, it } from "vitest";
import { fnv1a64BytesHex, fnv1aHex } from "@shared/utils/contentHash";
import {
  DEFAULT_OPAQUE_BACKGROUND,
  MAX_ICON_INSET,
  PROJECT_ICON_BAKE_FORMAT,
  PROJECT_ICON_OUTPUTS,
  PROJECT_ICON_TARGET_DEFAULTS,
  createProjectIconSet,
  findProjectIconOutput,
  normalizeProjectIconSet,
  outputsForTarget,
  projectIconFingerprint,
  resolveIconBackground,
  resolveIconSource
} from "./projectIcons";

const legacyIcon = (path: string) => ({
  path,
  sourceName: "logo.png",
  mediaType: "image/png",
  updatedAt: "2026-07-01T00:00:00.000Z"
});

describe("project icon set", () => {
  it("starts from the per-target defaults", () => {
    const set = createProjectIconSet();
    expect(set.master).toBeNull();
    expect(set.specs.macos.inset).toBe(PROJECT_ICON_TARGET_DEFAULTS.macos.inset);
    expect(set.specs.ios.background).toBe(DEFAULT_OPAQUE_BACKGROUND);
    expect(set.specs.windows.background).toBeNull();
  });

  it("reads an absent or malformed manifest as an empty set", () => {
    for (const value of [undefined, null, 42, "icons", []]) {
      expect(normalizeProjectIconSet(value).master).toBeNull();
    }
  });

  describe("legacy migration", () => {
    it("promotes the first configured slot to master and keeps the rest as overrides", () => {
      const set = normalizeProjectIconSet({
        macos: legacyIcon("resources/icons/app-icon-macos.icns"),
        windows: legacyIcon("resources/icons/app-icon-windows.ico")
      });

      expect(set.version).toBe(2);
      expect(set.master?.path).toBe("resources/icons/app-icon-windows.ico");
      expect(set.specs.macos.override?.path).toBe("resources/icons/app-icon-macos.icns");
      expect(set.specs.windows.override).toBeNull();
      expect(resolveIconSource(set, "linux")?.path).toBe("resources/icons/app-icon-windows.ico");
    });

    it("freezes every inset to zero so migrated projects ship what they shipped before", () => {
      const set = normalizeProjectIconSet({
        macos: legacyIcon("resources/icons/app-icon-macos.png")
      });
      expect(set.specs.macos.inset).toBe(0);
      expect(set.specs.android.inset).toBe(0);
      expect(PROJECT_ICON_TARGET_DEFAULTS.macos.inset).toBeGreaterThan(0);
    });

    it("still gives iOS its opaque background, because shipping alpha there was the bug", () => {
      const set = normalizeProjectIconSet({ ios: legacyIcon("resources/icons/app-icon-ios.png") });
      expect(set.specs.ios.background).toBe(DEFAULT_OPAQUE_BACKGROUND);
    });

    it("treats a slot with no usable path as unconfigured", () => {
      const set = normalizeProjectIconSet({
        windows: { path: "   " },
        linux: legacyIcon("resources/icons/l.png")
      });
      expect(set.master?.path).toBe("resources/icons/l.png");
    });

    it("carries no baked entries - a migrated project has never baked", () => {
      const set = normalizeProjectIconSet({ windows: legacyIcon("resources/icons/w.png") });
      expect(set.baked).toEqual({});
    });
  });

  describe("v2 normalization", () => {
    const v2 = (overrides: Record<string, unknown>) =>
      normalizeProjectIconSet({
        version: 2,
        master: legacyIcon("resources/icons/source/master.png"),
        ...overrides
      });

    it("clamps an inset into range and rounds it to the panel's step", () => {
      expect(v2({ specs: { macos: { inset: 9 } } }).specs.macos.inset).toBe(MAX_ICON_INSET);
      expect(v2({ specs: { macos: { inset: -1 } } }).specs.macos.inset).toBe(0);
      expect(v2({ specs: { macos: { inset: 0.10000000000000003 } } }).specs.macos.inset).toBe(0.1);
    });

    it("falls back to the default inset when the value is not a number", () => {
      expect(v2({ specs: { android: { inset: "0.2" } } }).specs.android.inset).toBe(
        PROJECT_ICON_TARGET_DEFAULTS.android.inset
      );
    });

    it("accepts an explicit null background but rejects a malformed colour", () => {
      expect(v2({ specs: { ios: { background: null } } }).specs.ios.background).toBeNull();
      expect(v2({ specs: { ios: { background: "white" } } }).specs.ios.background).toBe(
        DEFAULT_OPAQUE_BACKGROUND
      );
      expect(v2({ specs: { ios: { background: "#aabbcc" } } }).specs.ios.background).toBe(
        "#AABBCC"
      );
    });

    it("normalizes source paths to forward slashes", () => {
      const set = normalizeProjectIconSet({
        version: 2,
        master: { path: "resources\\icons\\source\\master.png" }
      });
      expect(set.master?.path).toBe("resources/icons/source/master.png");
      expect(set.master?.sourceName).toBe("master.png");
    });

    it("drops a baked entry that is missing its path or fingerprint", () => {
      const set = v2({
        baked: {
          macos: { path: "resources/icons/derived/macos.png", fingerprint: "abc" },
          ios: { path: "resources/icons/derived/ios.png" },
          windows: { fingerprint: "def" }
        }
      });
      expect(Object.keys(set.baked)).toEqual(["macos"]);
    });
  });

  describe("outputs", () => {
    it("covers every target", () => {
      for (const target of ["macos", "windows", "linux", "android", "ios", "web"] as const) {
        expect(outputsForTarget(target).length).toBeGreaterThan(0);
      }
    });

    it("declares web's two named sizes and makes only apple-touch opaque", () => {
      expect(outputsForTarget("web").map((output) => output.id)).toEqual([
        "web-favicon",
        "web-apple-touch"
      ]);
      expect(findProjectIconOutput("web-apple-touch").opaque).toBe(true);
      expect(findProjectIconOutput("web-favicon").opaque).toBe(false);
    });

    it("forces an opaque output onto white when the spec keeps transparency", () => {
      const spec = { override: null, inset: 0, background: null };
      expect(resolveIconBackground(spec, findProjectIconOutput("ios"))).toBe(
        DEFAULT_OPAQUE_BACKGROUND
      );
      expect(resolveIconBackground(spec, findProjectIconOutput("windows"))).toBeNull();
    });

    it("lets an explicit background win on an opaque output", () => {
      const spec = { override: null, inset: 0, background: "#101010" };
      expect(resolveIconBackground(spec, findProjectIconOutput("ios"))).toBe("#101010");
    });

    it("names every file uniquely", () => {
      const names = PROJECT_ICON_OUTPUTS.map((output) => output.fileName);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe("fingerprint", () => {
    const spec = { override: null, inset: 0.1, background: null };
    const output = findProjectIconOutput("macos");

    it("is stable for the same inputs", () => {
      expect(projectIconFingerprint({ sourceHash: "aa", spec, output })).toBe(
        projectIconFingerprint({ sourceHash: "aa", spec, output })
      );
    });

    it("moves when the source, the recipe, or the output changes", () => {
      const base = projectIconFingerprint({ sourceHash: "aa", spec, output });
      expect(projectIconFingerprint({ sourceHash: "bb", spec, output })).not.toBe(base);
      expect(
        projectIconFingerprint({ sourceHash: "aa", spec: { ...spec, inset: 0.2 }, output })
      ).not.toBe(base);
      expect(
        projectIconFingerprint({ sourceHash: "aa", spec, output: findProjectIconOutput("linux") })
      ).not.toBe(base);
    });

    it("ignores the source's timestamp and display name", () => {
      const withMeta = {
        sourceHash: "aa",
        spec: {
          override: {
            path: "a.png",
            sourceName: "a.png",
            mediaType: "image/png",
            updatedAt: "2026-01-01"
          },
          inset: 0.1,
          background: null
        },
        output
      };
      const later = {
        ...withMeta,
        spec: {
          ...withMeta.spec,
          override: { ...withMeta.spec.override, updatedAt: "2027-01-01", sourceName: "b.png" }
        }
      };
      expect(projectIconFingerprint(later)).toBe(projectIconFingerprint(withMeta));
    });

    it("carries the bake format, so an encoder change invalidates old output", () => {
      expect(projectIconFingerprint({ sourceHash: "aa", spec, output })).toContain(
        fnv1aHex(
          [`v${PROJECT_ICON_BAKE_FORMAT}`, output.id, output.size, "alpha", "0.1000", "none"].join(
            "|"
          )
        )
      );
    });

    it("tracks the resolved background, so an opaque output re-bakes when its colour changes", () => {
      const transparent = { override: null, inset: 0, background: null };
      const white = { override: null, inset: 0, background: DEFAULT_OPAQUE_BACKGROUND };
      const ios = findProjectIconOutput("ios");
      expect(projectIconFingerprint({ sourceHash: "aa", spec: transparent, output: ios })).toBe(
        projectIconFingerprint({ sourceHash: "aa", spec: white, output: ios })
      );
      expect(
        projectIconFingerprint({
          sourceHash: "aa",
          spec: { ...white, background: "#000000" },
          output: ios
        })
      ).not.toBe(projectIconFingerprint({ sourceHash: "aa", spec: white, output: ios }));
    });
  });
});

describe("fnv1a64BytesHex", () => {
  it("matches the reference vectors for FNV-1a 64", () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(fnv1a64BytesHex(encode(""))).toBe("cbf29ce484222325");
    expect(fnv1a64BytesHex(encode("a"))).toBe("af63dc4c8601ec8c");
    expect(fnv1a64BytesHex(encode("foobar"))).toBe("85944171f73967e8");
  });

  it("separates payloads that a 32-bit hash would have to squeeze", () => {
    const a = fnv1a64BytesHex(new Uint8Array([1, 2, 3, 4]));
    const b = fnv1a64BytesHex(new Uint8Array([1, 2, 3, 5]));
    expect(a).not.toBe(b);
    expect(a).toHaveLength(16);
  });
});
