import { describe, expect, it } from "vitest";
import { zh } from "./zh";

/**
 * Studio's Chinese interface copy ends without a full stop: labels, hints, empty states,
 * placeholders and confirmations are statements, and a trailing 。 makes a short line read as a
 * paragraph. Sentences inside one string are still joined with 。, ； or ，; only the end is checked.
 *
 * `game` is exempt: those strings are what a player reads inside a shipped game, which follows the
 * game's own prose conventions rather than Studio's.
 */
const EXEMPT_NAMESPACES = new Set(["game"]);

function collectTrailingFullStops(value: unknown, path: string, out: string[]): void {
    if (typeof value === "string") {
        if (value.trimEnd().endsWith("。")) {
            out.push(path);
        }
        return;
    }
    if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            collectTrailingFullStops(child, path ? `${path}.${key}` : key, out);
        }
    }
}

describe("zh catalog punctuation", () => {
    it("ends no interface string with a full stop", () => {
        const offenders: string[] = [];
        for (const [namespace, messages] of Object.entries(zh)) {
            if (!EXEMPT_NAMESPACES.has(namespace)) {
                collectTrailingFullStops(messages, namespace, offenders);
            }
        }
        expect(offenders).toEqual([]);
    });
});
