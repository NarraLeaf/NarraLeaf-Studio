import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The skeleton template ships its content twice: once in English, once in Chinese
 * (`resources/templates/skeleton/content.zh/`). The second tree is generated from the first by
 * `scripts/gen-skeleton-locale.mjs`, and this is what keeps the two from drifting apart.
 *
 * Two trees is the price of handing a Chinese author a project that is written in Chinese rather
 * than translated into it, and drift is the whole risk of paying it: an English screen edited by
 * hand would leave the Chinese one saying the old thing, silently, in a project nobody opens in
 * this language until an author does. So the generator is the only way the variant is written, and
 * this test says so out loud whenever the two stop agreeing.
 *
 * Run `node scripts/gen-skeleton-locale.mjs` to make it pass again — after checking that the
 * English change is one the Chinese copy should be following.
 */
describe("skeleton content variants", () => {
    it("are what the generator produces from the English content", () => {
        const script = path.resolve(__dirname, "../../../../../scripts/gen-skeleton-locale.mjs");

        expect(() => execFileSync(process.execPath, [script, "--check"], { encoding: "utf-8", stdio: "pipe" }))
            .not.toThrow();
    });
});
