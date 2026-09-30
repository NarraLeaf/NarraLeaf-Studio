import path from "path";
import { describe, expect, it } from "vitest";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { PREVIEW_AS_SHIPPED_SETTINGS_KEY, resolvePreviewAsShipped } from "./previewAsShipped";

/**
 * Whether a preview takes the protected build's sealing path, read from the machine's own settings.
 *
 * The cases that matter are the ways this can be absent or malformed: every one of them has to be
 * "off", because off is the default and a preview that sealed when nobody asked would be the slow
 * path arriving unannounced.
 */

const projectPath = path.join("D:", "projects", "Tiny Shadows");

function settings(value: unknown) {
    return { get: (key: string) => (key === PREVIEW_AS_SHIPPED_SETTINGS_KEY ? value : undefined) };
}

describe("resolvePreviewAsShipped", () => {
    it("is on only where this machine switched it on for this project", () => {
        expect(resolvePreviewAsShipped(settings({ [normalizeProjectPath(projectPath)]: true }), projectPath)).toBe(true);
        expect(resolvePreviewAsShipped(settings({ [normalizeProjectPath(path.join("D:", "projects", "Other"))]: true }), projectPath)).toBe(false);
    });

    it("does not split one project across two spellings of its path", () => {
        // A native folder picker answers with backslashes, a scripted path usually carries slashes.
        // Both sides key through `normalizeProjectPath`, so what one spelling stored is what the
        // other reads.
        const otherSpelling = projectPath.split(String.fromCharCode(92)).join("/");

        expect(resolvePreviewAsShipped(settings({ [normalizeProjectPath(otherSpelling)]: true }), projectPath)).toBe(true);
    });

    it("is off for every kind of absence", () => {
        expect(resolvePreviewAsShipped(settings(undefined), projectPath)).toBe(false);
        expect(resolvePreviewAsShipped(settings({}), projectPath)).toBe(false);
        expect(resolvePreviewAsShipped(settings(null), projectPath)).toBe(false);
        expect(resolvePreviewAsShipped(settings([normalizeProjectPath(projectPath)]), projectPath)).toBe(false);
        expect(resolvePreviewAsShipped(settings("true"), projectPath)).toBe(false);
    });

    it("counts only a literal true, never a truthy stand-in", () => {
        // The renderer writes `true` and deletes the key to switch off, so any other value is a
        // shape this setting never had - and the safe reading of a shape it never had is off.
        for (const value of ["true", 1, "on", {}, [true]]) {
            expect(resolvePreviewAsShipped(settings({ [normalizeProjectPath(projectPath)]: value }), projectPath)).toBe(false);
        }
        expect(resolvePreviewAsShipped(settings({ [normalizeProjectPath(projectPath)]: false }), projectPath)).toBe(false);
    });
});
