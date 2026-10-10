import { describe, expect, it } from "vitest";
import { findAllowedImportRoot, isPathInside } from "./agentPaths";

/** Which files `assets_import` may read: inside the project or an allowed root, after normalisation. */
describe("isPathInside", () => {
    it("accepts the root itself and anything under it", () => {
        expect(isPathInside("/art", "/art", false)).toBe(true);
        expect(isPathInside("/art/bg/day.png", "/art", false)).toBe(true);
    });

    it("refuses a path that only starts with the root's spelling", () => {
        expect(isPathInside("/artwork/day.png", "/art", false)).toBe(false);
    });

    it("refuses a path that climbs out after normalisation", () => {
        expect(isPathInside("/art/../secrets/key.pem", "/art", false)).toBe(false);
        expect(isPathInside("/art/bg/../../etc/passwd", "/art", false)).toBe(false);
    });

    it("keeps a directory whose name merely begins with two dots", () => {
        expect(isPathInside("/art/..hidden/day.png", "/art", false)).toBe(true);
    });

    it("refuses relative paths outright", () => {
        expect(isPathInside("art/day.png", "/art", false)).toBe(false);
    });

    it("folds case only when asked to", () => {
        expect(isPathInside("/Art/day.png", "/art", false)).toBe(false);
        expect(isPathInside("/Art/day.png", "/art", true)).toBe(true);
    });
});

describe("findAllowedImportRoot", () => {
    it("always allows the project directory, then the listed roots", () => {
        expect(findAllowedImportRoot("/project/_import/a.png", "/project", [], false)).toBe("/project");
        expect(findAllowedImportRoot("/downloads/a.png", "/project", ["/art", "/downloads"], false)).toBe("/downloads");
        expect(findAllowedImportRoot("/elsewhere/a.png", "/project", ["/art"], false)).toBeNull();
    });
});
