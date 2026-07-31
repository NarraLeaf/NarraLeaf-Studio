import { describe, expect, it } from "vitest";
import {
    collapseHomePath,
    formatRecentProjectLabel,
    recentProjectDisplayName,
    withRecentProjectNames,
} from "./recentProject";

describe("collapseHomePath", () => {
    it("collapses an exact home prefix to ~", () => {
        expect(collapseHomePath("/Users/aria/Projects/Game", "/Users/aria")).toBe("~/Projects/Game");
    });

    it("collapses the home directory itself", () => {
        expect(collapseHomePath("/Users/aria", "/Users/aria")).toBe("~");
    });

    it("does not treat a sibling with a shared prefix as a child", () => {
        expect(collapseHomePath("/Users/aria-notes/Game", "/Users/aria")).toBe("/Users/aria-notes/Game");
    });

    it("tolerates a trailing slash on the home dir", () => {
        expect(collapseHomePath("/Users/aria/Game", "/Users/aria/")).toBe("~/Game");
    });

    it("handles Windows-style separators", () => {
        expect(collapseHomePath("C:\\Users\\aria\\Game", "C:\\Users\\aria")).toBe("~\\Game");
    });

    it("leaves the path untouched when no home dir is given", () => {
        expect(collapseHomePath("/Users/aria/Game")).toBe("/Users/aria/Game");
    });
});

describe("formatRecentProjectLabel", () => {
    const project = { name: "My Game", path: "/Users/aria/Projects/My Game", openedAt: 0 };

    it("renders name (path)", () => {
        expect(formatRecentProjectLabel(project)).toBe("My Game (/Users/aria/Projects/My Game)");
    });

    it("collapses the home dir when provided", () => {
        expect(formatRecentProjectLabel(project, "/Users/aria")).toBe("My Game (~/Projects/My Game)");
    });
});

/**
 * The record that used to quit the app: `.nlproj` recovered from corruption has no `name`, the
 * workspace stores the history entry anyway, and every later launch died in the launcher's avatar
 * helper before a window appeared.
 */
describe("recentProjectDisplayName", () => {
    it("prefers the stored name", () => {
        expect(recentProjectDisplayName({ name: "My Game", path: "/p/other" })).toBe("My Game");
    });

    it("falls back to the folder when the name is missing, empty or blank", () => {
        expect(recentProjectDisplayName({ path: "/Users/aria/Projects/My Game" })).toBe("My Game");
        expect(recentProjectDisplayName({ name: "", path: "/Users/aria/Projects/My Game" })).toBe("My Game");
        expect(recentProjectDisplayName({ name: "   ", path: "/Users/aria/Projects/My Game" })).toBe("My Game");
        expect(recentProjectDisplayName({ name: null, path: "/Users/aria/Projects/My Game" })).toBe("My Game");
    });

    it("reads the folder off a Windows path, trailing separator or not", () => {
        expect(recentProjectDisplayName({ path: "C:\\Dev\\Game One" })).toBe("Game One");
        expect(recentProjectDisplayName({ path: "C:\\Dev\\Game One\\" })).toBe("Game One");
    });

    it("never returns empty, whatever it is handed", () => {
        expect(recentProjectDisplayName({})).toBe("Untitled Project");
        expect(recentProjectDisplayName({ name: null, path: null })).toBe("Untitled Project");
        expect(recentProjectDisplayName({ name: "", path: "" })).toBe("Untitled Project");
        expect(recentProjectDisplayName({ path: "/" })).toBe("Untitled Project");
    });

    it("trims a name rather than rendering the padding", () => {
        expect(recentProjectDisplayName({ name: "  My Game  ", path: "/p" })).toBe("My Game");
    });
});

describe("withRecentProjectNames", () => {
    it("fills in every missing name and leaves the rest of the record alone", () => {
        const repaired = withRecentProjectNames([
            { name: "Kept", path: "/a/kept", openedAt: 2, icon: "icon.png" },
            { path: "/a/derived", openedAt: 1 } as never,
        ]);

        expect(repaired.map(project => project.name)).toEqual(["Kept", "derived"]);
        expect(repaired[0].icon).toBe("icon.png");
        expect(repaired[1].openedAt).toBe(1);
    });

    it("handles an empty history", () => {
        expect(withRecentProjectNames([])).toEqual([]);
    });
});
