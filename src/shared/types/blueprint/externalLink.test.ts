import { describe, expect, it } from "vitest";
import {
    resolveDeclaredExternalLink,
    resolvePluginExternalLink,
    resolvePluginExternalLinkAmong,
    type ExternalLinkDeclaringPlugin,
} from "./externalLink";

/**
 * The guard every shell runs before it opens a page. It is the boundary, so what it refuses matters
 * more than what it allows.
 */

const DECLARED = ["https://store.example.com/app/480", "http://patch.example.com/notes"];

describe("declared external links", () => {
    it("allows a declared address, in the form it will be opened as", () => {
        const decision = resolveDeclaredExternalLink({ url: " https://store.example.com/app/480 " }, DECLARED);

        expect(decision).toEqual({ allowed: true, url: "https://store.example.com/app/480" });
    });

    it("refuses a lookalike host, a longer path and a swapped scheme", () => {
        for (const url of [
            "https://store.example.com.evil.test/app/480",
            "https://store.example.com/app/480/buy",
            "http://store.example.com/app/480",
        ]) {
            expect(resolveDeclaredExternalLink({ url }, DECLARED).allowed, url).toBe(false);
        }
    });

    it("refuses every scheme that is not http or https, however it is declared", () => {
        for (const url of ["file:///C:/secrets.txt", "javascript:alert(1)", "app://asset/1", "/relative"]) {
            expect(resolveDeclaredExternalLink({ url }, [url]).allowed, url).toBe(false);
        }
    });

    it("refuses everything when the build declares nothing", () => {
        expect(resolveDeclaredExternalLink({ url: "https://store.example.com/app/480" }, undefined).allowed)
            .toBe(false);
        expect(resolveDeclaredExternalLink({ url: "https://store.example.com/app/480" }, []).allowed)
            .toBe(false);
    });

    it("names the refused address, so a log line says which one it was", () => {
        const decision = resolveDeclaredExternalLink({ url: "https://evil.test/" }, DECLARED);

        expect(decision.allowed).toBe(false);
        expect(decision.allowed ? "" : decision.result.outcome).toBe("refused");
        expect(decision.allowed ? "" : decision.result.error).toContain("https://evil.test/");
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
        // A project address is not a plugin's to open...
        expect(resolvePluginExternalLinkAmong(PLUGINS, "acme.steam", { url: DECLARED[0] }).allowed)
            .toBe(false);
        // ...and a plugin's scheme is still refused by the node, whatever a plugin declared.
        expect(resolveDeclaredExternalLink({ url: "steam://run/480" }, ["steam://*"]).allowed).toBe(false);
    });

    it("refuses a blank address without consulting anything", () => {
        expect(resolvePluginExternalLink("acme.steam", { url: "   " }, ["steam://*"]).allowed).toBe(false);
        expect(resolvePluginExternalLink("acme.steam", { url: "" }, ["steam://*"]).allowed).toBe(false);
    });
});
