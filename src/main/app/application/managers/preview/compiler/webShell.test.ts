import { describe, expect, it } from "vitest";
import { WEB_SHELL_VARIANT_META, type GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { buildWebIndexHtml } from "./webShell";

function packWith(overrides: {
  name?: string;
  surfaces?: Array<{ id: string; kind: string; settings?: { backgroundColor?: string } }>;
  entrySurfaceId?: string;
}): GameRuntimePackV1 {
  return {
    schemaVersion: 2,
    generatedAt: "2026-07-15T00:00:00.000Z",
    mode: "production",
    runtimeVersion: "1.0.0",
    project: { name: overrides.name ?? "My Game" },
    entry: { kind: "surface", surfaceId: (overrides.entrySurfaceId ?? "s1") as never },
    bundle: {
      bundleId: "bundle-1",
      revision: 1,
      ui: {
        uidoc: {
          surfaces: overrides.surfaces ?? [{ id: "s1", kind: "appSurface" }]
        }
      }
    } as never,
    assets: { items: {} },
    plugins: []
  } as GameRuntimePackV1;
}

describe("buildWebIndexHtml", () => {
  it("references every runtime file with a relative URL", () => {
    const html = buildWebIndexHtml(packWith({}), { hasFavicon: false });
    expect(html).toContain("./renderer.css");
    expect(html).toContain("./renderer.js");
    expect(html).toContain("./web.js");
    expect(html).toContain('"./plugin-api/runtime.js"');
    expect(html).toContain('"./plugin-api/react.js"');
    expect(html).not.toContain("nlgame://");
    expect(html).not.toContain("favicon");
  });

  it("loads the bridge synchronously before the deferred renderer", () => {
    const html = buildWebIndexHtml(packWith({}), { hasFavicon: false });
    const bridgeAt = html.indexOf('<script src="./web.js"></script>');
    const rendererAt = html.indexOf('<script defer src="./renderer.js"></script>');
    expect(bridgeAt).toBeGreaterThan(-1);
    expect(bridgeAt).toBeLessThan(rendererAt);
  });

  it("escapes the project name in the title", () => {
    const html = buildWebIndexHtml(packWith({ name: '<Game> & "Co"' }), { hasFavicon: false });
    expect(html).toContain("<title>&lt;Game&gt; &amp; &quot;Co&quot;</title>");
  });

  it("bakes the entry surface background color in", () => {
    const html = buildWebIndexHtml(
      packWith({
        surfaces: [{ id: "s1", kind: "appSurface", settings: { backgroundColor: "#123456" } }]
      }),
      { hasFavicon: false }
    );
    expect(html).toContain("background: #123456");
  });

  it("defaults app surfaces to white and stage surfaces to black", () => {
    const app = buildWebIndexHtml(packWith({}), { hasFavicon: false });
    expect(app).toContain("background: #ffffff");
    const stage = buildWebIndexHtml(packWith({ surfaces: [{ id: "s1", kind: "stageSurface" }] }), {
      hasFavicon: false
    });
    expect(stage).toContain("background: #000000");
  });

  it("links the favicon only when one was emitted", () => {
    const html = buildWebIndexHtml(packWith({}), { hasFavicon: true });
    expect(html).toContain('<link rel="icon" type="image/png" href="./favicon.png" />');
  });

  it("links the apple-touch icon, which iOS uses instead of rel=icon", () => {
    const html = buildWebIndexHtml(packWith({}), { hasFavicon: true, hasAppleTouchIcon: true });
    expect(html).toContain('<link rel="apple-touch-icon" href="./apple-touch-icon.png" />');
  });

  it("marks the mobile variant so the runtime knows which shell is serving it", () => {
    // The pack is built once and the mobile repack serves this same site, so this meta is the
    // only thing that distinguishes a phone — and it is what gates the stage crop. A rename on
    // one side alone would turn cropping off on every handset with nothing else to notice.
    const mobile = buildWebIndexHtml(packWith({}), { hasFavicon: false, variant: "mobile" });
    expect(mobile).toContain(`<meta name="${WEB_SHELL_VARIANT_META}" content="mobile" />`);
    expect(mobile).toContain("viewport-fit=cover");

    for (const options of [{ hasFavicon: false }, { hasFavicon: false, variant: "web" as const }]) {
      const web = buildWebIndexHtml(packWith({}), options);
      expect(web).not.toContain(WEB_SHELL_VARIANT_META);
      expect(web).not.toContain("viewport-fit=cover");
    }
  });

  it("omits each icon link independently", () => {
    const faviconOnly = buildWebIndexHtml(packWith({}), {
      hasFavicon: true,
      hasAppleTouchIcon: false
    });
    expect(faviconOnly).toContain('rel="icon"');
    expect(faviconOnly).not.toContain("apple-touch-icon");

    const appleOnly = buildWebIndexHtml(packWith({}), {
      hasFavicon: false,
      hasAppleTouchIcon: true
    });
    expect(appleOnly).toContain("apple-touch-icon");
    expect(appleOnly).not.toContain('rel="icon"');
  });
});
