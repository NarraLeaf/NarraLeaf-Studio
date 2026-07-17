import { describe, expect, it } from "vitest";
import { resolveActionCommandToken } from "./storyActionCommands";

describe("resolveActionCommandToken", () => {
    it("resolves a command by its id", () => {
        expect(resolveActionCommandToken("/note")).toBe("note");
    });

    it("resolves a command by an alias", () => {
        expect(resolveActionCommandToken("//")).toBe("note");
    });

    it("ignores case", () => {
        expect(resolveActionCommandToken("/NoTe")).toBe("note");
    });

    it("only looks at the first token, so arguments do not defeat it", () => {
        expect(resolveActionCommandToken("/note some text here")).toBe("note");
    });

    // These are the lines that become invalid rows rather than quietly becoming prose.
    it.each([
        ["an unknown command", "/bgg"],
        ["prose that happens to start with a slash", "/this is not a command"],
        ["a bare slash", "/"],
        ["a line with no slash at all", "note"],
        ["an empty line", ""],
    ])("does not resolve %s", (_label, line) => {
        expect(resolveActionCommandToken(line)).toBeNull();
    });
});
