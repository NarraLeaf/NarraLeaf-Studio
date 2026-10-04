import { execFileSync } from "node:child_process";
import fs from "node:fs";
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

    /**
     * A project made from the template starts with every language it carries fully translated, so
     * the dashboard and the localization panel show nothing to do on a project nobody has touched.
     * The generator copies the English content's translations into the other trees, so a unit one of
     * those files lacks - the character names were missing from the English content's Japanese file -
     * is missing from a language in all three trees at once.
     */
    it.each(["content", "content.zh", "content.ja"])("translate the same units into every language in %s", tree => {
        const dir = path.resolve(__dirname, "../../../../../resources/templates/skeleton", tree, "editor/localization");
        const files = fs.readdirSync(dir).filter(name => name.endsWith(".json") && name !== "keys.json");
        expect(files).toHaveLength(2);
        const units = files.map(name => {
            const document = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")) as {
                units: Record<string, { target?: string }>;
            };
            for (const [id, unit] of Object.entries(document.units)) {
                expect(unit.target?.trim(), `${tree}/${name} has no words for ${id}`).toBeTruthy();
            }
            return Object.keys(document.units).sort();
        });
        expect(units[0]).toEqual(units[1]);
    });
});
