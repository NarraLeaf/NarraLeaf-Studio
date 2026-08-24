import { describe, expect, it } from "vitest";
import { WEB_SHELL_VARIANT_META, type GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { buildWebIndexHtml } from "./webShell";

function packWith(overrides: {
    name?: string;
    surfaces?: Array<{ id: string; kind: string; settings?: { backgroundColor?: string } }>;
    entrySurfaceId?: string;
    sourceLocale?: string;
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
            ...(overrides.sourceLocale === undefined
                ? {}
                : { localization: { sourceLocale: overrides.sourceLocale } }),
            ui: {
                uidoc: {
                    surfaces: (overrides.surfaces ?? [{ id: "s1", kind: "appSurface" }]),
                },
            },
        } as never,
        assets: { items: {} },
        plugins: [],
    } as GameRuntimePackV1;
}

describe("buildWebIndexHtml", () => {
    it("references every runtime file with a relative URL", () => {
        const html = buildWebIndexHtml(packWith({}), { hasFavicon: false });
        expect(html).toContain("./renderer.css");
        expect(html).toContain("./renderer.js");
        expect(html).toContain("./web.js");
        expect(html).toContain("\"./plugin-api/runtime.js\"");
        expect(html).toContain("\"./plugin-api/react.js\"");
        expect(html).not.toContain("nlgame://");
        expect(html).not.toContain("favicon");
    });

    it("loads the bridge synchronously before the deferred renderer", () => {
        const html = buildWebIndexHtml(packWith({}), { hasFavicon: false });
        const bridgeAt = html.indexOf("<script src=\"./web.js\"></script>");
        const rendererAt = html.indexOf("<script defer src=\"./renderer.js\"></script>");
        expect(bridgeAt).toBeGreaterThan(-1);
        expect(bridgeAt).toBeLessThan(rendererAt);
    });

    it("escapes the project name in the title", () => {
        const html = buildWebIndexHtml(packWith({ name: "<Game> & \"Co\"" }), { hasFavicon: false });
        expect(html).toContain("<title>&lt;Game&gt; &amp; &quot;Co&quot;</title>");
    });

    it("bakes the entry surface background color in", () => {
        const html = buildWebIndexHtml(
            packWith({ surfaces: [{ id: "s1", kind: "appSurface", settings: { backgroundColor: "#123456" } }] }),
            { hasFavicon: false },
        );
        expect(html).toContain("background: #123456");
    });

    it("defaults app surfaces to white and stage surfaces to black", () => {
        const app = buildWebIndexHtml(packWith({}), { hasFavicon: false });
        expect(app).toContain("background: #ffffff");
        const stage = buildWebIndexHtml(
            packWith({ surfaces: [{ id: "s1", kind: "stageSurface" }] }),
            { hasFavicon: false },
        );
        expect(stage).toContain("background: #000000");
    });

    it("links the favicon only when one was emitted", () => {
        const html = buildWebIndexHtml(packWith({}), { hasFavicon: true });
        expect(html).toContain("<link rel=\"icon\" type=\"image/png\" href=\"./favicon.png\" />");
    });

    it("links the apple-touch icon, which iOS uses instead of rel=icon", () => {
        const html = buildWebIndexHtml(packWith({}), { hasFavicon: true, hasAppleTouchIcon: true });
        expect(html).toContain("<link rel=\"apple-touch-icon\" href=\"./apple-touch-icon.png\" />");
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

    it("states the language the project is written in", () => {
        // The attribute decides which Han forms a fallback font draws, so a Japanese title served
        // as an English page is set in the wrong face before a line of script has run.
        expect(buildWebIndexHtml(packWith({ sourceLocale: "ja" }), { hasFavicon: false }))
            .toContain("<html lang=\"ja\">");
        expect(buildWebIndexHtml(packWith({ sourceLocale: "zh-CN" }), { hasFavicon: false }))
            .toContain("<html lang=\"zh-CN\">");
    });

    it("says nothing about the language it does not know", () => {
        // No localization at all, and a locale field holding something that is not a language tag:
        // an attribute the browser cannot parse selects a worse font than an absent one.
        expect(buildWebIndexHtml(packWith({}), { hasFavicon: false })).toContain("<html>");
        expect(buildWebIndexHtml(packWith({ sourceLocale: "Japanese (Kansai)" }), { hasFavicon: false }))
            .toContain("<html>");
    });

    it("takes the browser's own gestures off the document", () => {
        // A game window, not a page. Each of these has a way of ending a session: a pinch leaves the
        // stage misaligned with no chrome to undo it in, a downward drag on Chrome for Android
        // reloads the running game, and a long press puts the iOS magnifier over the dialogue.
        const html = buildWebIndexHtml(packWith({}), { hasFavicon: false });
        expect(html).toContain("touch-action: pan-x pan-y;");
        expect(html).toContain("overscroll-behavior: none;");
        expect(html).toContain("-webkit-touch-callout: none;");
        expect(html).toContain("-webkit-text-size-adjust: 100%;");
        expect(html).toContain("-webkit-tap-highlight-color: transparent;");
        expect(html).toContain("overflow: hidden;");
    });

    it("lets an editable field keep its callout", () => {
        // Without this a name-entry box on iOS has no Paste, which is a worse trade than the long
        // press was.
        const html = buildWebIndexHtml(packWith({}), { hasFavicon: false });
        expect(html).toContain("input, textarea, select, [contenteditable] { -webkit-touch-callout: default; }");
    });

    it("asks the mobile WebViews not to scale, and asks nobody else", () => {
        // The WebViews both shells embed still honour user-scalable; Safari has ignored it since
        // iOS 10, so on the web target it would say nothing that touch-action has not already said.
        const mobile = buildWebIndexHtml(packWith({}), { hasFavicon: false, variant: "mobile" });
        expect(mobile).toContain("user-scalable=no");
        expect(buildWebIndexHtml(packWith({}), { hasFavicon: false })).not.toContain("user-scalable");
    });

    it("omits each icon link independently", () => {
        const faviconOnly = buildWebIndexHtml(packWith({}), { hasFavicon: true, hasAppleTouchIcon: false });
        expect(faviconOnly).toContain("rel=\"icon\"");
        expect(faviconOnly).not.toContain("apple-touch-icon");

        const appleOnly = buildWebIndexHtml(packWith({}), { hasFavicon: false, hasAppleTouchIcon: true });
        expect(appleOnly).toContain("apple-touch-icon");
        expect(appleOnly).not.toContain("rel=\"icon\"");
    });
});
