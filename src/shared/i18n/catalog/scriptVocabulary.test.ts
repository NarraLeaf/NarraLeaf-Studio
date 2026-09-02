import { describe, expect, it } from "vitest";
import { flattenCatalog } from "../flatten";
import { CATALOGS } from "./index";

/**
 * A script is a script, and a blueprint is a blueprint.
 *
 * The two ways of writing a slot's logic are one distinction an author has to hold, and the
 * interface used to blur it: the button that made a script said "New TypeScript revision", the panel
 * that listed the files called them blueprints, and the tab a script opened in was titled
 * "Blueprint". None of that was reachable by the type system - they are strings - so the rule is
 * held here instead.
 *
 * What is forbidden is one word qualifying the other: "TypeScript blueprint", "script blueprint",
 * and their translations. Saying "a script is written in TypeScript" is fine and stays possible -
 * the languages are still what the files are written in, and help text has to be able to say so.
 */

const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
    {
        pattern: /(TypeScript|JavaScript|script)[\s-]*blueprint/i,
        why: 'a script is not a kind of blueprint - say "script"',
    },
    {
        // No separator: Chinese and Japanese compounds run the two words together.
        pattern: /(TypeScript|JavaScript|脚本)\s*蓝图/i,
        why: "脚本不是蓝图的一种——写「脚本」",
    },
    {
        pattern: /(TypeScript|JavaScript|スクリプト)\s*(の)?\s*ブループリント/i,
        why: "スクリプトはブループリントの一種ではない",
    },
];

describe("script vocabulary", () => {
    it("has strings to check", () => {
        // Guards against a vacuous pass if flattening ever stops producing string leaves.
        const values = [...flattenCatalog(CATALOGS.en!).values()].filter(value => typeof value === "string");
        expect(values.length).toBeGreaterThan(100);
    });

    for (const [locale, catalog] of Object.entries(CATALOGS)) {
        it(`never calls a script a blueprint in ${locale}`, () => {
            const offenders: string[] = [];
            for (const [key, value] of flattenCatalog(catalog).entries()) {
                if (typeof value !== "string") {
                    continue;
                }
                for (const { pattern, why } of FORBIDDEN) {
                    if (pattern.test(value)) {
                        offenders.push(`${key}: ${JSON.stringify(value)} — ${why}`);
                    }
                }
            }
            expect(offenders).toEqual([]);
        });
    }
});
