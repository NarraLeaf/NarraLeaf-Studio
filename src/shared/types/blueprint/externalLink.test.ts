import { describe, expect, it } from "vitest";
import { resolveDeclaredExternalLink } from "./externalLink";

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
