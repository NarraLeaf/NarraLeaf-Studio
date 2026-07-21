import { describe, expect, it } from "vitest";
import { actionTrigger, isActionCommandLine, toCanonicalCommandLine } from "./commandTrigger";

describe("actionTrigger", () => {
    it("reads a leading slash regardless of the alias setting", () => {
        expect(actionTrigger("/bg forest", false)).toBe("/");
        expect(actionTrigger("/bg forest", true)).toBe("/");
    });

    it("reads a leading @ only when the alias is on", () => {
        expect(actionTrigger("@bg forest", true)).toBe("@");
        expect(actionTrigger("@bg forest", false)).toBe(null);
    });

    it("returns null for a hash line or prose", () => {
        expect(actionTrigger("#Alice", true)).toBe(null);
        expect(actionTrigger("hello@world", true)).toBe(null);
        expect(actionTrigger("", true)).toBe(null);
    });
});

describe("isActionCommandLine", () => {
    it("treats @ as an action trigger only under the alias", () => {
        expect(isActionCommandLine("@set x = 1", true)).toBe(true);
        expect(isActionCommandLine("@set x = 1", false)).toBe(false);
        expect(isActionCommandLine("/set x = 1", false)).toBe(true);
        expect(isActionCommandLine("# Alice", true)).toBe(false);
    });
});

describe("toCanonicalCommandLine", () => {
    it("folds only a leading @ (alias on) onto /", () => {
        expect(toCanonicalCommandLine("@bg forest", true)).toBe("/bg forest");
        expect(toCanonicalCommandLine("@", true)).toBe("/");
    });

    it("leaves a leading @ untouched when the alias is off", () => {
        expect(toCanonicalCommandLine("@bg forest", false)).toBe("@bg forest");
    });

    it("never rewrites a slash line, a hash line, prose, or a non-leading @", () => {
        expect(toCanonicalCommandLine("/bg forest", true)).toBe("/bg forest");
        expect(toCanonicalCommandLine("#Alice", true)).toBe("#Alice");
        expect(toCanonicalCommandLine("mail me @home", true)).toBe("mail me @home");
        expect(toCanonicalCommandLine("/set to = @a", true)).toBe("/set to = @a");
    });

    it("preserves length so caret offsets stay valid", () => {
        const display = "@bg forest_day t=fade";
        expect(toCanonicalCommandLine(display, true)).toHaveLength(display.length);
    });
});
