import { describe, expect, it } from "vitest";
import type { BrandColor } from "@shared/types/brand";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { resolveGameRuntimeInitialBackgroundColor } from "./gameRuntimeEntrySurface";

/**
 * The colour the shell paints before the renderer's first paint.
 *
 * The brand cases are the reason this file exists: a link is stored in the same field a hex used to
 * be, and the failure mode of getting it wrong is not an error anywhere - it is a black flash on
 * boot, which nobody reports as a bug in a colour resolver.
 */

function packWith(overrides: {
  surfaces?: Array<{ id: string; kind: string; settings?: { backgroundColor?: string } }>;
  entrySurfaceId?: string;
  brand?: BrandColor[];
}): GameRuntimePackV1 {
  return {
    schemaVersion: 2,
    generatedAt: "2026-08-09T00:00:00.000Z",
    mode: "production",
    runtimeVersion: "1.0.0",
    project: { name: "My Game" },
    entry: { kind: "surface", surfaceId: (overrides.entrySurfaceId ?? "s1") as never },
    bundle: {
      bundleId: "bundle-1",
      revision: 1,
      ui: {
        uidoc: {
          surfaces: overrides.surfaces ?? [{ id: "s1", kind: "appSurface" }]
        }
      },
      ...(overrides.brand ? { brand: overrides.brand } : {})
    } as never,
    assets: { items: {} },
    plugins: []
  } as GameRuntimePackV1;
}

function packWithBackground(backgroundColor: string, brand?: BrandColor[]): GameRuntimePackV1 {
  return packWith({
    surfaces: [{ id: "s1", kind: "appSurface", settings: { backgroundColor } }],
    ...(brand ? { brand } : {})
  });
}

describe("resolveGameRuntimeInitialBackgroundColor without brand links", () => {
  // Pinned verbatim: the link support must be additive, and a regression here would change the
  // pre-boot frame of every game that has never touched the Brand surface.
  it("defaults app surfaces to white and stage surfaces to black", () => {
    expect(resolveGameRuntimeInitialBackgroundColor(packWith({}))).toBe("#ffffff");
    expect(
      resolveGameRuntimeInitialBackgroundColor(
        packWith({
          surfaces: [{ id: "s1", kind: "stageSurface" }]
        })
      )
    ).toBe("#000000");
  });

  it("takes a configured literal, in every spelling the shell accepts", () => {
    expect(resolveGameRuntimeInitialBackgroundColor(packWithBackground("#123456"))).toBe("#123456");
    expect(resolveGameRuntimeInitialBackgroundColor(packWithBackground("#ABC"))).toBe("#aabbcc");
    expect(resolveGameRuntimeInitialBackgroundColor(packWithBackground("rgb(64, 168, 196)"))).toBe(
      "#40a8c4"
    );
    expect(resolveGameRuntimeInitialBackgroundColor(packWithBackground("rebeccapurple"))).toBe(
      "rebeccapurple"
    );
  });

  it("falls back to black for a transparent or unreadable literal", () => {
    expect(resolveGameRuntimeInitialBackgroundColor(packWithBackground("transparent"))).toBe(
      "#000000"
    );
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("rgba(255, 255, 255, 0)"))
    ).toBe("#000000");
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("color-mix(in srgb, red, blue)"))
    ).toBe("#000000");
  });
});

describe("resolveGameRuntimeInitialBackgroundColor with brand links", () => {
  const brand: BrandColor[] = [
    { id: "background", value: "#F7F9FB" },
    { id: "primary", value: "#40A8C4" },
    { id: "container.background", value: "nlbrand:background" },
    { id: "ring", value: "nlbrand:container.background" },
    { id: "translucent", value: "nlbrand:primary/0.5" },
    { id: "orphan", value: "nlbrand:gone" },
    { id: "loop", value: "nlbrand:loop" }
  ];

  // The motivating case. Before the pack's palette was consulted this returned #000000, i.e. a
  // black flash in front of a light game.
  it("resolves a link to the palette's literal", () => {
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("nlbrand:background", brand))
    ).toBe("#f7f9fb");
  });

  it("follows a chain of links to the literal at the end", () => {
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("nlbrand:ring", brand))
    ).toBe("#f7f9fb");
  });

  it("keeps the RGB channels of a translucent link and drops a fully transparent one", () => {
    // The shell cannot blend against anything, so half of a colour is still that colour...
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("nlbrand:primary/0.5", brand))
    ).toBe("#40a8c4");
    // ...but none of it is the surface asking for no background at all, which has no opaque form.
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("nlbrand:primary/0", brand))
    ).toBe("#000000");
  });

  /**
   * The shell drops the alpha either way, so this pins the *value* the shared resolver produced,
   * not the colour that reaches the window: the stored segment replaces the entry's own opacity
   * rather than being multiplied by it, which is the rule the canvas and the runtime now share.
   * This path used to reach it through a synthetic palette entry, and multiplied.
   */
  it("resolves a stored alpha segment against a translucent entry by replacing it", () => {
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("nlbrand:translucent/0.8", brand))
    ).toBe("#40a8c4");
    // Zero is the one alpha the shell can act on, and it must survive an entry that is itself
    // translucent: under multiplication nothing here would have been fully transparent.
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("nlbrand:translucent/0", brand))
    ).toBe("#000000");
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("nlbrand:translucent", brand))
    ).toBe("#40a8c4");
  });

  it("reads the seeded palette when the pack predates the brand field", () => {
    // `BUILTIN_BRAND_COLORS.background`. An old pack still resolves, because its project would
    // have held exactly these colours.
    expect(resolveGameRuntimeInitialBackgroundColor(packWithBackground("nlbrand:background"))).toBe(
      "#101317"
    );
  });

  it("keeps the original fallback for a link that resolves to nothing", () => {
    // An id nothing defines, a link to a broken link, and a self-reference: all three used to
    // land on black by falling out of the colour parser, and still do.
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("nlbrand:missing", brand))
    ).toBe("#000000");
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("nlbrand:orphan", brand))
    ).toBe("#000000");
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("nlbrand:loop", brand))
    ).toBe("#000000");
  });

  it("leaves a malformed link alone rather than repairing it", () => {
    // `parseBrandLink` refuses an out-of-range alpha, so this is not a link at all and must not
    // become one - the same reasoning that keeps the parser from clamping.
    expect(
      resolveGameRuntimeInitialBackgroundColor(packWithBackground("nlbrand:primary/5", brand))
    ).toBe("#000000");
  });
});
