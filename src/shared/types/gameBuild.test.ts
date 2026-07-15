import { describe, expect, it } from "vitest";
import {
    defaultGameBuildArch,
    deriveGameAppId,
    gameBuildArtifactNamePattern,
    normalizeGameBuildArch,
    predictGameBuildArtifacts,
    webExportZipName,
} from "./gameBuild";

describe("deriveGameAppId", () => {
    it("namespaces an identifier that is not reverse-domain", () => {
        // Regression: the dialog once mirrored this rule without the
        // reverse-domain test and displayed a bare "demo" as the shipped app id.
        expect(deriveGameAppId("demo", "Demo")).toBe("com.narraleaf.games.demo");
    });

    it("uses a reverse-domain identifier verbatim", () => {
        expect(deriveGameAppId("com.studio.my-game", "My Game")).toBe("com.studio.my-game");
    });
});

/**
 * These names are a promise the build dialog makes to the user, so they are
 * pinned against electron-builder's actual macro expansion (macroExpander.ts +
 * builder-util's getArtifactArchName) rather than against what looks plausible.
 */
describe("predictGameBuildArtifacts", () => {
    const base = { artifactBaseName: "MyGame", version: "1.2.0" };

    it("names installers and archives with the os and arch macros", () => {
        const predicted = predictGameBuildArtifacts({
            ...base,
            targets: [{ platform: "macos", formats: ["dmg", "zip"], arch: "arm64" }],
        });
        expect(predicted.map(a => a.name)).toEqual([
            "MyGame-1.2.0-mac-arm64.dmg",
            "MyGame-1.2.0-mac-arm64.zip",
        ]);
    });

    it("uses win, not windows, as the os token", () => {
        const [predicted] = predictGameBuildArtifacts({
            ...base,
            targets: [{ platform: "windows", formats: ["nsis"], arch: "x64" }],
        });
        expect(predicted.name).toBe("MyGame-1.2.0-win-x64.exe");
    });

    it("renames x64 to x86_64 for AppImage only", () => {
        const predicted = predictGameBuildArtifacts({
            ...base,
            targets: [{ platform: "linux", formats: ["appimage", "zip"], arch: "x64" }],
        });
        // builder-util's getArtifactArchName special-cases AppImage; the sibling
        // zip from the same target keeps the plain arch.
        expect(predicted.map(a => a.name)).toEqual([
            "MyGame-1.2.0-linux-x86_64.AppImage",
            "MyGame-1.2.0-linux-x64.zip",
        ]);
    });

    it("keeps arm64 verbatim for AppImage", () => {
        const [predicted] = predictGameBuildArtifacts({
            ...base,
            targets: [{ platform: "linux", formats: ["appimage"], arch: "arm64" }],
        });
        expect(predicted.name).toBe("MyGame-1.2.0-linux-arm64.AppImage");
    });

    it("names unpacked folders with an arch suffix only when not x64", () => {
        const predicted = predictGameBuildArtifacts({
            ...base,
            targets: [
                { platform: "macos", formats: ["dir"], arch: "x64" },
                { platform: "macos", formats: ["dir"], arch: "arm64" },
                { platform: "macos", formats: ["dir"], arch: "universal" },
                { platform: "windows", formats: ["dir"], arch: "x64" },
                { platform: "windows", formats: ["dir"], arch: "arm64" },
                { platform: "linux", formats: ["dir"], arch: "x64" },
            ],
        });
        expect(predicted.map(a => a.name)).toEqual([
            "mac",
            "mac-arm64",
            "mac-universal",
            "win-unpacked",
            "win-arm64-unpacked",
            "linux-unpacked",
        ]);
        expect(predicted.every(a => a.kind === "folder")).toBe(true);
    });

    it("names the web export from the version, with no arch", () => {
        const predicted = predictGameBuildArtifacts({
            ...base,
            targets: [{ platform: "web", formats: ["zip", "dir"] }],
        });
        expect(predicted).toEqual([
            { name: "MyGame-1.2.0-web.zip", kind: "file", platform: "web", format: "zip" },
            { name: "MyGame-1.2.0-web", kind: "folder", platform: "web", format: "dir" },
        ]);
    });

    it("falls back to the platform's first arch when none was chosen", () => {
        const [predicted] = predictGameBuildArtifacts({
            ...base,
            targets: [{ platform: "macos", formats: ["dmg"] }],
        });
        // macOS offers arm64 first.
        expect(predicted.name).toBe("MyGame-1.2.0-mac-arm64.dmg");
    });
});

describe("gameBuildArtifactNamePattern", () => {
    it("emits electron-builder macros, not interpolated values", () => {
        expect(gameBuildArtifactNamePattern("MyGame")).toBe("MyGame-${version}-${os}-${arch}.${ext}");
    });

    it("agrees with what the predictor produces", () => {
        // The pattern and the predictor are the two halves that must not drift:
        // expanding the pattern by hand must land on the predicted name.
        const pattern = gameBuildArtifactNamePattern("MyGame");
        const expanded = pattern
            .replace("${version}", "1.2.0")
            .replace("${os}", "win")
            .replace("${arch}", "x64")
            .replace("${ext}", "exe");
        const [predicted] = predictGameBuildArtifacts({
            artifactBaseName: "MyGame",
            version: "1.2.0",
            targets: [{ platform: "windows", formats: ["nsis"], arch: "x64" }],
        });
        expect(predicted.name).toBe(expanded);
    });
});

describe("webExportZipName", () => {
    it("matches the dir name plus .zip", () => {
        expect(webExportZipName("MyGame", "1.2.0")).toBe("MyGame-1.2.0-web.zip");
    });
});

describe("defaultGameBuildArch", () => {
    it("follows the host arch when packaging for the host platform", () => {
        expect(defaultGameBuildArch("macos", "macos", "arm64")).toBe("arm64");
        expect(defaultGameBuildArch("macos", "macos", "x64")).toBe("x64");
    });

    it("uses x64 for a cross build regardless of host arch", () => {
        expect(defaultGameBuildArch("windows", "macos", "arm64")).toBe("x64");
    });
});

describe("normalizeGameBuildArch", () => {
    it("drops an arch the platform does not offer", () => {
        // universal is macOS-only.
        expect(normalizeGameBuildArch("windows", "universal")).toBe("x64");
        expect(normalizeGameBuildArch("macos", "universal")).toBe("universal");
    });

    it("falls back to the first offered arch for junk", () => {
        expect(normalizeGameBuildArch("linux", undefined)).toBe("x64");
        expect(normalizeGameBuildArch("macos", 42)).toBe("arm64");
    });
});
