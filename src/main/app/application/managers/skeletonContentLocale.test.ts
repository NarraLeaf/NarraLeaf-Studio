import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The skeleton template ships its content three times: once in English, once in Chinese
 * (`resources/templates/skeleton/content.zh/`) and once in Japanese (`content.ja/`). Both of the
 * later trees are generated from the English one by `scripts/gen-skeleton-locale.mjs`, and this is
 * what keeps them from drifting apart.
 *
 * A tree per language is the price of handing an author a project that is written in their own
 * language rather than translated into it, and drift is the whole risk of paying it: an English
 * screen edited by hand would leave the other two saying the old thing, silently, in a project
 * nobody opens in those languages until an author does. So the generator is the only way a variant
 * is written, and this test says so out loud whenever they stop agreeing.
 *
 * Run `node scripts/gen-skeleton-locale.mjs` to make it pass again — after checking that the
 * English change is one the other copies should be following.
 */
describe("skeleton content variants", () => {
    it("are what the generator produces from the English content", () => {
        const script = path.resolve(__dirname, "../../../../../scripts/gen-skeleton-locale.mjs");

        expect(() => execFileSync(process.execPath, [script, "--check"], { encoding: "utf-8", stdio: "pipe" }))
            .not.toThrow();
    });
});
