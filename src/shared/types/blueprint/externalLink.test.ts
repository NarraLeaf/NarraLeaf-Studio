import { describe, expect, it } from "vitest";
import {
    normalizeCoreExternalLinkUrl,
    resolveCoreExternalLink,
    resolvePluginExternalLink,
    resolvePluginExternalLinkAmong,
    type ExternalLinkDeclaringPlugin,
} from "./externalLink";

/**
 * The guard every shell runs before it opens a page. There is no list here to consult - the author
 * wrote the address - so the whole of what this decides is the scheme, and what it refuses is the
 * only thing worth testing.
 */

describe("core external links", () => {
    it("opens an address the author wrote, in the form it will be opened as", () => {
        expect(resolveCoreExternalLink({ url: " https://store.example.com/app/480 " }))
            .toEqual({ allowed: true, url: "https://store.example.com/app/480" });
    });

    it("opens any host, because nothing here is a list", () => {
        for (const url of [
            "https://store.example.com/app/480",
            "http://patch.example.com/notes",
            "https://a.host.nobody.declared.test/anything?q=1#x",
            "mailto:support@example.com",
        ]) {
            expect(resolveCoreExternalLink({ url }).allowed, url).toBe(true);
        }
    });

    it("refuses the schemes that turn opening a page into running something", () => {
        for (const url of [
            "file:///C:/secrets.txt",
            "file://server/share/payload.lnk",
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "vbscript:msgbox(1)",
        ]) {
            expect(resolveCoreExternalLink({ url }).allowed, url).toBe(false);
        }
    });

    it("refuses a scheme outside the set even when it is harmless-looking", () => {
        // `steam:` is reachable, but through a plugin that declares it and an install-time approval
        // - not through this node. See the note at the top of externalLink.ts.
        for (const url of ["steam://run/480", "app://asset/1", "nlgame://assets/a.png", "ms-settings:"]) {
            expect(resolveCoreExternalLink({ url }).allowed, url).toBe(false);
        }
    });

    it("refuses anything that is not an absolute address", () => {
        for (const url of ["", "   ", "/relative", "store.example.com", "not a url"]) {
            expect(resolveCoreExternalLink({ url }).allowed, url).toBe(false);
        }
    });

    it("refuses an address carrying credentials, which reads as one host and goes to another", () => {
        expect(resolveCoreExternalLink({ url: "https://store.example.com@evil.test/" }).allowed).toBe(false);
        expect(normalizeCoreExternalLinkUrl("https://user:pw@example.com/")).toBeNull();
    });

    it("names the refused address, so a log line says which one it was", () => {
        const decision = resolveCoreExternalLink({ url: "file:///C:/payload.exe" });

        expect(decision.allowed).toBe(false);
        expect(decision.allowed ? "" : decision.result.outcome).toBe("refused");
        expect(decision.allowed ? "" : decision.result.error).toContain("file:///C:/payload.exe");
    });
});

/**
 * The plugin regime, and the seam between the two.
 *
 * The pattern language itself is exercised next door in `externalLinkPattern.test.ts`. What is
 * checked here is the thing every shell depends on: an id selects one plugin's declaration, an id
 * that names nothing selects nothing, and neither regime can answer the other's question.
 */

const PLUGINS: ExternalLinkDeclaringPlugin[] = [
    {
        manifest: {
            id: "acme.steam",
            contributes: { externalLinks: ["steam://*", "https://store.steampowered.com/app/*"] },
        },
    },
    { manifest: { id: "acme.itch", contributes: { externalLinks: ["https://itch.io/game/*"] } } },
    { manifest: { id: "acme.quiet", contributes: {} } },
];

describe("plugin external links", () => {
    it("opens an address the named plugin declared, in the form it was asked for", () => {
        expect(resolvePluginExternalLinkAmong(PLUGINS, "acme.steam", { url: " steam://run/480 " }))
            .toEqual({ allowed: true, url: "steam://run/480" });
        expect(resolvePluginExternalLinkAmong(PLUGINS, "acme.itch", { url: "https://itch.io/game/7" }))
            .toEqual({ allowed: true, url: "https://itch.io/game/7" });
    });

    it("refuses one plugin the addresses another declared", () => {
        // The property the whole feature rests on. `acme.itch` asking for a Steam address is not a
        // different outcome from `acme.itch` asking for anything else undeclared.
        expect(resolvePluginExternalLinkAmong(PLUGINS, "acme.itch", { url: "steam://run/480" }).allowed)
            .toBe(false);
        expect(resolvePluginExternalLinkAmong(
            PLUGINS,
            "acme.steam",
            { url: "https://itch.io/game/7" },
        ).allowed).toBe(false);
    });

    it("refuses a plugin that declared nothing, and an id naming no plugin at all", () => {
        expect(resolvePluginExternalLinkAmong(PLUGINS, "acme.quiet", { url: "steam://run/480" }).allowed)
            .toBe(false);
        expect(resolvePluginExternalLinkAmong(PLUGINS, "acme.invented", { url: "steam://run/480" }).allowed)
            .toBe(false);
        expect(resolvePluginExternalLinkAmong(PLUGINS, "", { url: "steam://run/480" }).allowed).toBe(false);
        expect(resolvePluginExternalLinkAmong(undefined, "acme.steam", { url: "steam://run/480" }).allowed)
            .toBe(false);
        expect(resolvePluginExternalLinkAmong([], "acme.steam", { url: "steam://run/480" }).allowed)
            .toBe(false);
    });

    it("names the plugin and the address when it refuses", () => {
        const decision = resolvePluginExternalLinkAmong(PLUGINS, "acme.itch", { url: "https://evil.test/" });

        expect(decision.allowed).toBe(false);
        expect(decision.allowed ? "" : decision.result.outcome).toBe("refused");
        expect(decision.allowed ? "" : decision.result.error).toContain("https://evil.test/");
        expect(decision.allowed ? "" : decision.result.error).toContain("acme.itch");
    });

    it("keeps the two regimes from answering each other's question", () => {
        // An address the node opens freely is still not this plugin's to open...
        expect(resolvePluginExternalLinkAmong(PLUGINS, "acme.itch", { url: "https://anywhere.test/" }).allowed)
            .toBe(false);
        // ...and a scheme a plugin declared is still not one the node reaches.
        expect(resolveCoreExternalLink({ url: "steam://run/480" }).allowed).toBe(false);
    });

    it("refuses a blank address without consulting anything", () => {
        expect(resolvePluginExternalLink("acme.steam", { url: "   " }, ["steam://*"]).allowed).toBe(false);
        expect(resolvePluginExternalLink("acme.steam", { url: "" }, ["steam://*"]).allowed).toBe(false);
    });
});
