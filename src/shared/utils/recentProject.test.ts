import { describe, expect, it } from "vitest";
import { collapseHomePath, formatRecentProjectLabel } from "./recentProject";

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
