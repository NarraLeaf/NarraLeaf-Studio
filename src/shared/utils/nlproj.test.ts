import { describe, expect, it } from "vitest";
import {
    decodeProjectConfig,
    encodeProjectConfig,
    findLegacyProjectConfigFileName,
    findNlprojConfigFileName,
    findProjectConfigFileName,
    type DirEntry,
    type ProjectConfigData,
} from "./nlproj";
import { PROJECT_DEPENDENCY_SCHEMA_VERSION } from "../types/pluginDependencies";

describe("nlproj codec", () => {
    it("round-trips a config that carries a dependency table", () => {
        const config: ProjectConfigData = {
            name: "Demo",
            identifier: "com.example.demo",
            metadata: { version: "0.1.0" },
            dependencies: {
                schemaVersion: PROJECT_DEPENDENCY_SCHEMA_VERSION,
                plugins: [
                    {
                        id: "narraleaf.gallery",
                        name: "NarraLeaf Gallery",
                        builtIn: true,
                        authoredVersion: "1.0.0",
                        hard: true,
                        usedBy: { blueprintNode: ["narraleaf.gallery.add"] },
                    },
                ],
            },
        };

        const decoded = decodeProjectConfig(encodeProjectConfig(config));
        expect(decoded.dependencies).toEqual(config.dependencies);
    });

    it("round-trips a config with no dependency table", () => {
        const config: ProjectConfigData = {
            name: "Bare",
            identifier: "com.example.bare",
            metadata: {},
        };
        const decoded = decodeProjectConfig(encodeProjectConfig(config));
        expect(decoded.dependencies).toBeUndefined();
    });
});

/**
 * These finders are the reassembly point for every caller that locates a project config from a
 * directory listing (`ProjectService`, the launcher's relocate flow, and the main-process
 * recent-project check). The listing splits filenames into a stem plus a separate `ext`, so a
 * finder that returned the stem alone would hand back a path that opens nothing.
 */
describe("project config finders", () => {
    const entry = (name: string, ext: string | null, type = "file"): DirEntry => ({ name, ext, type });

    it("returns the nlproj filename with its extension put back on", () => {
        const entries = [entry("assets", null, "directory"), entry("My Game", ".nlproj")];
        expect(findNlprojConfigFileName(entries)).toBe("My Game.nlproj");
        expect(findProjectConfigFileName(entries)).toBe("My Game.nlproj");
    });

    it("keeps a dotted project name intact", () => {
        // `path.parse("com.example.game.nlproj").name` is "com.example.game" - only the last
        // segment moves to `ext`, so the stem still carries the rest.
        expect(findNlprojConfigFileName([entry("com.example.game", ".nlproj")]))
            .toBe("com.example.game.nlproj");
    });

    it("returns the legacy config filename with its extension", () => {
        const entries = [entry("project", ".json")];
        expect(findLegacyProjectConfigFileName(entries)).toBe("project.json");
        expect(findProjectConfigFileName(entries)).toBe("project.json");
    });

    it("prefers nlproj over the legacy config when both are present", () => {
        const entries = [entry("project", ".json"), entry("Demo", ".nlproj")];
        expect(findProjectConfigFileName(entries)).toBe("Demo.nlproj");
    });

    it("ignores directories and unrelated files", () => {
        const entries = [
            entry("Demo", ".nlproj", "directory"),
            entry("notes", ".txt"),
            entry("project", null),
        ];
        expect(findProjectConfigFileName(entries)).toBeNull();
    });

    it("reports nothing for an empty listing", () => {
        expect(findProjectConfigFileName([])).toBeNull();
    });
});
