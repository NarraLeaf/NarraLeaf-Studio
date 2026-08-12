import { describe, expect, it } from "vitest";
import {
    GAME_BUILD_ARCHS_BY_PLATFORM,
    GAME_BUILD_FORMATS_BY_PLATFORM,
    defaultGameBuildArch,
    deriveAndroidVersionCode,
    deriveGameAppId,
    deriveIosBundleVersion,
    gameBuildArtifactBaseName,
    gameBuildArtifactNamePattern,
    hostCanBuildTarget,
    isDesktopBuildPlatform,
    isMobileBuildPlatform,
    mobileExportFileName,
    normalizeAndroidPackageName,
    normalizeGameBuildArch,
    normalizeIosBundleId,
    predictGameBuildArtifacts,
    webExportZipName,
    type GameBuildPlatform,
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

    it("names mobile packages from the version, with no arch", () => {
        // Regression for the desktop fall-through: before the platform union
        // grew, everything that wasn't "web" was cast to desktop, and a mobile
        // target would have crashed in the arch lookup here.
        const predicted = predictGameBuildArtifacts({
            ...base,
            targets: [
                { platform: "android", formats: ["apk"] },
                { platform: "ios", formats: ["ipa"] },
            ],
        });
        expect(predicted).toEqual([
            { name: "MyGame-1.2.0-android.apk", kind: "file", platform: "android", format: "apk" },
            { name: "MyGame-1.2.0-ios.ipa", kind: "file", platform: "ios", format: "ipa" },
        ]);
    });

    it("predicts the AAB alone when that is all the Android target asked for", () => {
        expect(predictGameBuildArtifacts({ ...base, targets: [{ platform: "android", formats: ["aab"] }] }))
            .toEqual([
                { name: "MyGame-1.2.0-android.aab", kind: "file", platform: "android", format: "aab" },
            ]);
    });

    it("predicts one artifact per selected format, not one per mobile platform", () => {
        // The shape the AAB batch turned on: Android is one platform emitting
        // two differently-named packages, so a per-platform prediction would
        // have shown one file where the build writes two.
        const predicted = predictGameBuildArtifacts({
            ...base,
            targets: [{ platform: "android", formats: ["apk", "aab"] }],
        });
        expect(predicted).toEqual([
            { name: "MyGame-1.2.0-android.apk", kind: "file", platform: "android", format: "apk" },
            { name: "MyGame-1.2.0-android.aab", kind: "file", platform: "android", format: "aab" },
        ]);
    });

    it("ignores formats a mobile platform does not offer", () => {
        const predicted = predictGameBuildArtifacts({
            ...base,
            targets: [{ platform: "android", formats: ["zip", "apk", "ipa"] }],
        });
        expect(predicted.map(a => a.name)).toEqual(["MyGame-1.2.0-android.apk"]);
    });

    it("predicts a name for every format a mobile platform offers", () => {
        // The offer table and the naming path are two halves that must not
        // drift: a format added to the table with no extension here would be
        // selectable in the dialog and silently missing from the preview.
        for (const platform of ["android", "ios"] as const) {
            const formats = GAME_BUILD_FORMATS_BY_PLATFORM[platform];
            const predicted = predictGameBuildArtifacts({ ...base, targets: [{ platform, formats }] });
            expect(predicted.map(a => a.format)).toEqual(formats);
            expect(predicted.map(a => a.name)).toEqual(
                formats.map(format => `MyGame-1.2.0-${platform}.${format}`),
            );
        }
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

describe("gameBuildArtifactBaseName", () => {
    it("names a release build from the project alone, exactly as it always did", () => {
        expect(gameBuildArtifactBaseName("My Game", null)).toBe("My-Game");
    });

    it("names a variant's build from the project and the edition", () => {
        // The point of the helper: a variant that overrides nothing used to write the release
        // build's file names, so building both into one folder left one of them.
        expect(gameBuildArtifactBaseName("My Game", "Demo")).toBe("My-Game-Demo");
        expect(gameBuildArtifactBaseName("My Game", null))
            .not.toBe(gameBuildArtifactBaseName("My Game", "Demo"));
    });

    it("sanitizes both halves", () => {
        expect(gameBuildArtifactBaseName("My: Game", "All ages / cut")).toBe("My-Game-All-ages-cut");
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

describe("mobileExportFileName", () => {
    it("ends the name in the requested format, not in the platform's one package", () => {
        // Android emits two packages from one target, so the extension has to
        // come from the format; deriving it from the platform (as this did)
        // would have named the .aab ".apk" and overwritten it.
        expect(mobileExportFileName("android", "apk", "MyGame", "1.2.0")).toBe("MyGame-1.2.0-android.apk");
        expect(mobileExportFileName("android", "aab", "MyGame", "1.2.0")).toBe("MyGame-1.2.0-android.aab");
        expect(mobileExportFileName("ios", "ipa", "MyGame", "1.2.0")).toBe("MyGame-1.2.0-ios.ipa");
    });
});

describe("platform membership predicates", () => {
    it("classifies every platform exactly once", () => {
        const all: GameBuildPlatform[] = ["windows", "macos", "linux", "web", "android", "ios"];
        expect(all.filter(isDesktopBuildPlatform)).toEqual(["windows", "macos", "linux"]);
        expect(all.filter(isMobileBuildPlatform)).toEqual(["android", "ios"]);
        // web is neither - the old `platform !== "web"` desktop test would
        // have claimed android/ios here.
        expect(all.filter(p => !isDesktopBuildPlatform(p) && !isMobileBuildPlatform(p))).toEqual(["web"]);
    });
});

describe("hostCanBuildTarget", () => {
    const hosts: GameBuildPlatform[] = ["windows", "macos", "linux"];

    it("builds web and mobile targets from every host", () => {
        for (const host of hosts) {
            expect(hostCanBuildTarget(host, "web")).toBe(true);
            expect(hostCanBuildTarget(host, "android")).toBe(true);
            expect(hostCanBuildTarget(host, "ios")).toBe(true);
        }
    });

    it("keeps the desktop cross-build rules", () => {
        expect(hostCanBuildTarget("macos", "macos")).toBe(true);
        expect(hostCanBuildTarget("windows", "macos")).toBe(false);
        expect(hostCanBuildTarget("linux", "macos")).toBe(false);
        expect(hostCanBuildTarget("windows", "linux")).toBe(false);
        expect(hostCanBuildTarget("macos", "linux")).toBe(true);
        for (const host of hosts) {
            expect(hostCanBuildTarget(host, "windows")).toBe(true);
        }
    });
});

describe("deriveAndroidVersionCode", () => {
    it("packs the semver triple into a monotonic integer", () => {
        expect(deriveAndroidVersionCode("1.2.3")).toBe(1_002_003);
        expect(deriveAndroidVersionCode("0.13.0")).toBe(13_000);
        expect(deriveAndroidVersionCode("2099.999.999")).toBe(2_099_999_999);
    });

    it("stays monotonic across successive releases", () => {
        const codes = ["0.9.9", "0.10.0", "1.0.0", "1.0.1", "1.1.0", "2.0.0"]
            .map(v => deriveAndroidVersionCode(v)!);
        expect([...codes].sort((a, b) => a - b)).toEqual(codes);
    });

    it("floors 0.0.0 to 1 (installers reject versionCode 0)", () => {
        expect(deriveAndroidVersionCode("0.0.0")).toBe(1);
    });

    it("ignores the pre-release/build suffix, sharing the release's code", () => {
        expect(deriveAndroidVersionCode("1.2.0-beta.3")).toBe(deriveAndroidVersionCode("1.2.0"));
        expect(deriveAndroidVersionCode("1.2.0+build.7")).toBe(deriveAndroidVersionCode("1.2.0"));
    });

    it("returns null when a component cannot be encoded", () => {
        // The caps are Google Play's versionCode ceiling, adopted deliberately.
        expect(deriveAndroidVersionCode("2100.0.0")).toBeNull();
        expect(deriveAndroidVersionCode("1.1000.0")).toBeNull();
        expect(deriveAndroidVersionCode("1.0.1000")).toBeNull();
    });

    it("returns null for junk instead of guessing", () => {
        expect(deriveAndroidVersionCode("")).toBeNull();
        expect(deriveAndroidVersionCode("1.2")).toBeNull();
        expect(deriveAndroidVersionCode("not-a-version")).toBeNull();
    });
});

describe("normalizeAndroidPackageName", () => {
    it("keeps an already-valid package name unchanged", () => {
        expect(normalizeAndroidPackageName("com.studio.mygame")).toBe("com.studio.mygame");
    });

    it("replaces hyphens and prefixes digit-leading segments", () => {
        // Android is stricter than reverse-domain: deriveGameAppId happily
        // produces both of these shapes.
        expect(normalizeAndroidPackageName("com.studio.my-game")).toBe("com.studio.my_game");
        expect(normalizeAndroidPackageName("com.studio.9lives")).toBe("com.studio.n9lives");
    });

    it("namespaces a single-segment id defensively", () => {
        expect(normalizeAndroidPackageName("game")).toBe("com.narraleaf.games.game");
    });
});

describe("normalizeIosBundleId", () => {
    it("keeps an already-valid bundle id unchanged", () => {
        expect(normalizeIosBundleId("com.studio.my-game")).toBe("com.studio.my-game");
    });

    it("replaces underscores (invalid on iOS, unlike Android)", () => {
        expect(normalizeIosBundleId("com.studio.my_game")).toBe("com.studio.my-game");
    });
});

describe("deriveIosBundleVersion", () => {
    it("passes a plain three-part version through", () => {
        expect(deriveIosBundleVersion("1.2.3")).toBe("1.2.3");
    });

    it("strips the pre-release and build metadata iOS rejects", () => {
        // CFBundleShortVersionString takes digits and dots only; semver's
        // suffixes would make the bundle invalid.
        expect(deriveIosBundleVersion("1.2.0-beta.3")).toBe("1.2.0");
        expect(deriveIosBundleVersion("1.2.0+build.7")).toBe("1.2.0");
        expect(deriveIosBundleVersion("2.0.0-rc.1+exp")).toBe("2.0.0");
    });

    it("falls back for a version it cannot parse", () => {
        expect(deriveIosBundleVersion("not-a-version")).toBe("0.0.0");
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

describe("GAME_BUILD_ARCHS_BY_PLATFORM", () => {
    // This guards against a specific plausible edit, not against a typo.
    //
    // Studio itself is no longer shipped for Intel Macs (no @lore-vcs darwin-x64 backend, no zsign
    // macOS x64 asset, no x86_64 LGPL FFmpeg build). Someone tidying up after that decision could
    // very reasonably read "we dropped Intel Mac" and delete this row too - which would silently
    // strip a large installed base of *players* from every game built with Studio.
    //
    // Host and target are different questions. Nothing in the pipeline needs an Intel Mac to
    // produce an Intel-Mac game: @narraleaf/encryption vendors a prebuilt darwin-x64
    // nlcrypto.node, and electron-builder downloads Electron's x64 runtime. If this assertion is
    // in your way, the answer is not to delete it.
    it("still offers x64 and universal for macOS, because a game's host is not Studio's host", () => {
        expect(GAME_BUILD_ARCHS_BY_PLATFORM.macos).toContain("x64");
        expect(GAME_BUILD_ARCHS_BY_PLATFORM.macos).toContain("universal");
    });

    it("normalizes an explicit macOS x64 choice to itself rather than dropping it", () => {
        expect(normalizeGameBuildArch("macos", "x64")).toBe("x64");
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
