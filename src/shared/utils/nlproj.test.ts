import { describe, expect, it } from "vitest";
import {
    decodeProjectConfig,
    encodeProjectConfig,
    findNlprojConfigFileName,
    findProjectConfigFileName,
    getProjectConfigFileName,
    legacyAsciiName,
    sanitizeProjectFileName,
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

    it("does not accept the pre-nlproj project.json as a project config", () => {
        expect(findProjectConfigFileName([entry("project", ".json")])).toBeNull();
        // And it is not merely outranked: a directory holding both opens as the `.nlproj` one, which
        // is the same answer it would give if the json were any other file.
        expect(findProjectConfigFileName([entry("project", ".json"), entry("Demo", ".nlproj")]))
            .toBe("Demo.nlproj");
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

/**
 * A name as a file name. It names the `.nlproj` of every new project and every artifact a build
 * writes, so it keeps the author's own script: transliterating it read every Han character as
 * Mandarin and spelled the Japanese 放課後 as `Fang-Ke-Hou`.
 */
// Written as code points: in the source they would be as invisible as they are in a name.
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const IDEOGRAPHIC_SPACE = String.fromCodePoint(0x3000);

describe("sanitizeProjectFileName", () => {
    it("keeps Japanese, Chinese and mixed names in their own script", () => {
        expect(sanitizeProjectFileName("放課後")).toBe("放課後");
        expect(sanitizeProjectFileName("放課後のアリス")).toBe("放課後のアリス");
        expect(sanitizeProjectFileName("你好世界")).toBe("你好世界");
        expect(sanitizeProjectFileName("星の詩 Prologue")).toBe("星の詩-Prologue");
        expect(getProjectConfigFileName("放課後")).toBe("放課後.nlproj");
    });

    it("spells a Latin name exactly as it always did", () => {
        expect(sanitizeProjectFileName("My Game")).toBe("My-Game");
        expect(sanitizeProjectFileName("My: Game / Demo")).toBe("My-Game-Demo");
        expect(sanitizeProjectFileName("fixture.project")).toBe("fixture.project");
        expect(getProjectConfigFileName("Chapter One")).toBe("Chapter-One.nlproj");
    });

    it("replaces what a file system refuses and drops what a reader cannot see", () => {
        expect(sanitizeProjectFileName("a<b>c:d\"e|f?g*h")).toBe("a-b-c-d-e-f-g-h");
        expect(sanitizeProjectFileName("tab\there\u0007bell")).toBe("tab-here-bell");
        // A right-to-left override and a zero-width space: both invisible, both gone.
        expect(sanitizeProjectFileName(`game${RIGHT_TO_LEFT_OVERRIDE}exe.txt`)).toBe("gameexe.txt");
        expect(sanitizeProjectFileName(`放${ZERO_WIDTH_SPACE}課後`)).toBe("放課後");
        // An ideographic space separates words like any other space.
        expect(sanitizeProjectFileName(`夏の終わり${IDEOGRAPHIC_SPACE}第二章`)).toBe("夏の終わり-第二章");
    });

    it("does not leave a name Windows refuses or a file manager hides", () => {
        expect(sanitizeProjectFileName("CON")).toBe("CON_");
        expect(sanitizeProjectFileName("lpt1.save")).toBe("lpt1_.save");
        expect(sanitizeProjectFileName("Console")).toBe("Console");
        expect(sanitizeProjectFileName(".hidden")).toBe("hidden");
        expect(sanitizeProjectFileName("Ends with a dot.")).toBe("Ends-with-a-dot");
        expect(sanitizeProjectFileName("   ")).toBe("project");
        expect(sanitizeProjectFileName("???")).toBe("project");
    });

    it("composes a decomposed name, so a Mac and a PC spell it alike", () => {
        // ガーデン with its voicing mark written as a separate character.
        const decomposed = String.fromCodePoint(0x30ab, 0x3099, 0x30fc, 0x30c7, 0x30f3);
        expect(sanitizeProjectFileName(decomposed)).toBe("ガーデン");
    });

    it("bounds a long name in bytes, cutting between characters", () => {
        const long = "放".repeat(60); // 180 bytes of UTF-8
        const bounded = sanitizeProjectFileName(long);
        expect(bounded).toBe("放".repeat(33));
        expect(new TextEncoder().encode(bounded).length).toBeLessThanOrEqual(100);
        expect(sanitizeProjectFileName("a".repeat(150))).toBe("a".repeat(100));
    });
});

describe("legacyAsciiName", () => {
    it("still transliterates, because the identities built on it must not move", () => {
        expect(legacyAsciiName("放課後")).toBe("Fang-Ke-Hou");
        expect(legacyAsciiName("My Game")).toBe("My-Game");
        expect(legacyAsciiName("fixture.project")).toBe("fixture.project");
    });
});
