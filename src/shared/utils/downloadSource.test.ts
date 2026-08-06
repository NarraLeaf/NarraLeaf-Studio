import { describe, expect, it } from "vitest";
import type { DownloadRewriteRule } from "@shared/types/downloadSource";
import {
    describeRewrite,
    normalizeRewriteRules,
    resolveDownloadSource,
    rewriteDownloadUrl,
} from "@shared/utils/downloadSource";

const rule = (from: string, to: string, enabled = true): DownloadRewriteRule => ({ from, to, enabled });

const GITHUB_ZIP =
    "https://github.com/NarraLeaf/Plugins/releases/download/narraleaf.tagged-log@1.0.0/plugin.zip";

describe("rewriteDownloadUrl", () => {
    it("returns the original URL when there are no rules", () => {
        expect(rewriteDownloadUrl(GITHUB_ZIP, []).url).toBe(GITHUB_ZIP);
        expect(rewriteDownloadUrl(GITHUB_ZIP, undefined).url).toBe(GITHUB_ZIP);
        expect(rewriteDownloadUrl(GITHUB_ZIP, null).url).toBe(GITHUB_ZIP);
    });

    it("substitutes the matched prefix and reports the rule", () => {
        const rules = [rule("https://github.com/", "https://mirror.example/gh/")];
        const outcome = rewriteDownloadUrl(GITHUB_ZIP, rules);
        expect(outcome.url).toBe(
            "https://mirror.example/gh/NarraLeaf/Plugins/releases/download/narraleaf.tagged-log@1.0.0/plugin.zip",
        );
        expect(outcome.applied).toBe(rules[0]);
        expect(outcome.refused).toBeUndefined();
    });

    it("leaves a non-matching URL alone", () => {
        const outcome = rewriteDownloadUrl("https://cdn.example.com/icon.png", [
            rule("https://github.com/", "https://mirror.example/gh/"),
        ]);
        expect(outcome.url).toBe("https://cdn.example.com/icon.png");
        expect(outcome.applied).toBeUndefined();
    });

    it("takes the first enabled match, so order is match order", () => {
        const outcome = rewriteDownloadUrl(GITHUB_ZIP, [
            rule("https://github.com/NarraLeaf/", "https://first.example/"),
            rule("https://github.com/", "https://second.example/"),
        ]);
        expect(outcome.url).toBe(
            "https://first.example/Plugins/releases/download/narraleaf.tagged-log@1.0.0/plugin.zip",
        );
    });

    it("skips a disabled rule and falls through to the next", () => {
        const outcome = rewriteDownloadUrl(GITHUB_ZIP, [
            rule("https://github.com/", "https://disabled.example/", false),
            rule("https://github.com/", "https://enabled.example/"),
        ]);
        expect(outcome.url.startsWith("https://enabled.example/")).toBe(true);
    });

    it("skips a rule with a blank side rather than mapping everything to nothing", () => {
        const outcome = rewriteDownloadUrl(GITHUB_ZIP, [rule("https://github.com/", "   ")]);
        expect(outcome.url).toBe(GITHUB_ZIP);
        expect(outcome.applied).toBeUndefined();
        expect(outcome.refused).toBeUndefined();
    });

    // The security floor: a rewrite may move a download to another https host and nothing else.
    it("refuses a downgrade to http", () => {
        const outcome = rewriteDownloadUrl(GITHUB_ZIP, [rule("https://github.com/", "http://mirror.example/")]);
        expect(outcome.url).toBe(GITHUB_ZIP);
        expect(outcome.refused).toBe("not-https");
    });

    it.each(["file:///C:/evil/", "data:text/plain;base64,", "javascript:void 0"])(
        "refuses the %s scheme",
        (target) => {
            const outcome = rewriteDownloadUrl(GITHUB_ZIP, [rule("https://github.com/", target)]);
            expect(outcome.url).toBe(GITHUB_ZIP);
            expect(outcome.refused).toBe("not-https");
        },
    );

    it("refuses a replacement that does not compose into a URL", () => {
        const outcome = rewriteDownloadUrl(GITHUB_ZIP, [rule("https://github.com/", "mirror.example/")]);
        expect(outcome.url).toBe(GITHUB_ZIP);
        expect(outcome.refused).toBe("unparseable");
    });

    it("trims stored whitespace on both sides", () => {
        const outcome = rewriteDownloadUrl(GITHUB_ZIP, [
            rule("  https://github.com/  ", "  https://mirror.example/  "),
        ]);
        expect(outcome.url.startsWith("https://mirror.example/NarraLeaf/")).toBe(true);
    });
});

describe("normalizeRewriteRules", () => {
    it("returns an empty list for anything that is not an array", () => {
        expect(normalizeRewriteRules(undefined)).toEqual([]);
        expect(normalizeRewriteRules({ from: "a", to: "b" })).toEqual([]);
        expect(normalizeRewriteRules("nonsense")).toEqual([]);
    });

    it("drops entries missing a side and defaults `enabled` to true", () => {
        expect(
            normalizeRewriteRules([
                { from: "https://a/", to: "https://b/" },
                { from: "https://c/" },
                { to: "https://d/" },
                null,
                { from: "  ", to: "https://e/" },
                { from: "https://f/", to: "https://g/", enabled: false },
            ]),
        ).toEqual([
            { from: "https://a/", to: "https://b/", enabled: true },
            { from: "https://f/", to: "https://g/", enabled: false },
        ]);
    });
});

describe("resolveDownloadSource", () => {
    it("falls back to the official default when unset, blank or not a string", () => {
        expect(resolveDownloadSource("", "https://official/")).toBe("https://official/");
        expect(resolveDownloadSource("   ", "https://official/")).toBe("https://official/");
        expect(resolveDownloadSource(undefined, "https://official/")).toBe("https://official/");
        expect(resolveDownloadSource(42, "https://official/")).toBe("https://official/");
    });

    it("uses the configured value, trimmed", () => {
        expect(resolveDownloadSource("  https://mirror/  ", "https://official/")).toBe("https://mirror/");
    });
});

describe("describeRewrite", () => {
    it("says nothing when nothing happened", () => {
        expect(describeRewrite(GITHUB_ZIP, { url: GITHUB_ZIP })).toBeNull();
    });

    it("names both addresses when a rule applied", () => {
        const line = describeRewrite(GITHUB_ZIP, {
            url: "https://mirror.example/x",
            applied: rule("https://github.com/", "https://mirror.example/"),
        });
        expect(line).toContain(GITHUB_ZIP);
        expect(line).toContain("https://mirror.example/x");
    });

    it("explains a refusal, so an ignored mirror is not silent", () => {
        expect(describeRewrite(GITHUB_ZIP, { url: GITHUB_ZIP, refused: "not-https" })).toContain("not https");
        expect(describeRewrite(GITHUB_ZIP, { url: GITHUB_ZIP, refused: "unparseable" })).toContain("valid URL");
    });
});
