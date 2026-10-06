import fs from "fs";
import os from "os";
import path from "path";
import { LinuxPackager, type AfterPackContext } from "electron-builder";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LINUX_PROGRAM_SUFFIX, renderLinuxLauncher } from "./linuxLauncher";
import { compute7zCompressArgs } from "app-builder-lib/out/targets/archive";
import { builderConfiguration, electronFuseConfig, extraFilesFor, studioWritesZip, withArchiveCompressionLevel } from "./runGameBuild";
import type { GameBuildWorkerConfig, GameBuildWorkerFuses, GameBuildWorkerTarget } from "./protocol";

const config = {
    appId: "com.narraleaf.games.example",
    productName: "Example",
    electronVersion: "38.0.0",
    outputDir: "out",
    artifactBaseName: "Example",
    electronLanguages: ["en-US"],
    asarUnpack: [],
    targets: [],
} as unknown as GameBuildWorkerConfig;

const target = {
    platform: "windows",
    formats: ["dir"],
    arch: "x64",
    platformKey: "windows-x64",
    fuses: {},
} as unknown as GameBuildWorkerTarget;

/**
 * Whether electron-builder goes looking for a dependency tree to put in the game.
 *
 * It must not: the game has none, and the tree it finds instead is whatever JavaScript repository
 * the project happens to sit inside. electron-builder only skips the search when `beforeBuild`
 * answers false, and only asks `beforeBuild` when `npmRebuild` is not false - so both halves are
 * pinned here, since either one alone puts the search back.
 */
describe("builderConfiguration", () => {
    it("tells electron-builder that node_modules are handled outside it", async () => {
        const built = builderConfiguration(config, target, () => undefined);

        expect(built.npmRebuild).not.toBe(false);
        expect(typeof built.beforeBuild).toBe("function");
        const answer = await (built.beforeBuild as (context: unknown) => Promise<boolean>)({});
        expect(answer).toBe(false);
    });
});

/**
 * The archive level, checked against electron-builder's own argument builder rather than a copy of
 * it: the variable only means what that function makes of it.
 */
describe("studioWritesZip", () => {
    it("takes a Windows zip from electron-builder, whatever else the target asks for", () => {
        expect(studioWritesZip({ platform: "windows", formats: ["zip"] })).toBe(true);
        expect(studioWritesZip({ platform: "windows", formats: ["nsis", "zip", "dir"] })).toBe(true);
        expect(studioWritesZip({ platform: "windows", formats: ["nsis"] })).toBe(false);
    });

    it("takes a macOS or Linux zip too, and leaves their other formats alone", () => {
        expect(studioWritesZip({ platform: "macos", formats: ["dmg", "zip"] })).toBe(true);
        expect(studioWritesZip({ platform: "linux", formats: ["appimage", "zip"] })).toBe(true);
        expect(studioWritesZip({ platform: "macos", formats: ["dmg"] })).toBe(false);
        expect(studioWritesZip({ platform: "linux", formats: ["appimage"] })).toBe(false);
    });
});

describe("withArchiveCompressionLevel", () => {
    it("gives a zip 7-Zip's highest level without electron-builder's fifteen extra passes", async () => {
        const outside = compute7zCompressArgs("zip", { compression: "maximum" });
        const inside = await withArchiveCompressionLevel(async () => compute7zCompressArgs("zip", { compression: "maximum" }));

        expect(outside).toEqual(expect.arrayContaining(["-mx=9", "-mpass=15", "-mfb=258"]));
        expect(inside).toEqual(expect.arrayContaining(["-mx=9", "-mm=Deflate"]));
        expect(inside).not.toContain("-mpass=15");
        expect(inside).not.toContain("-mfb=258");
    });

    it("leaves an installer's payload exactly as it was", async () => {
        // What NsisTarget hands the archiver for its differential-aware payload.
        const payload = { compression: "normal" as const, dictSize: 1, solid: false, installTimeDecodable: true, withoutDir: true };
        const outside = compute7zCompressArgs("7z", payload);
        const inside = await withArchiveCompressionLevel(async () => compute7zCompressArgs("7z", payload));

        expect(inside).toEqual(outside);
    });

    it("puts the environment back afterwards, even when the build fails", async () => {
        const before = process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL;
        await expect(withArchiveCompressionLevel(async () => {
            throw new Error("packaging failed");
        })).rejects.toThrow("packaging failed");
        expect(process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL).toBe(before);
    });

    it("keeps a dmg in the format a maximum build gives it, which the level would otherwise change", () => {
        expect(builderConfiguration(config, targetFor("macos"), () => undefined).dmg).toEqual({ format: "UDBZ" });
        expect(builderConfiguration(config, targetFor("windows"), () => undefined).dmg).toBeUndefined();
        expect(builderConfiguration(config, targetFor("linux"), () => undefined).dmg).toBeUndefined();
    });
});

/**
 * Where the game's own notices land. On macOS a top-level file in `Contents/` is nested code to
 * codesign, which signs it into extended attributes; a zip drops those, and the unpacked app then
 * fails verification. So on macOS they go into `Contents/Resources/`, and nowhere else changes.
 */
describe("extraFilesFor", () => {
    const withNotices = {
        ...config,
        copyrightFile: "/project/COPYRIGHT.txt",
        thirdPartyNoticesFile: "/build/THIRD-PARTY-NOTICES.txt",
    } as GameBuildWorkerConfig;

    it("puts the notices in the bundle's Resources on macOS", () => {
        expect(extraFilesFor(withNotices, "macos")).toEqual([
            { from: "/project/COPYRIGHT.txt", to: "Resources/COPYRIGHT.txt" },
            { from: "/build/THIRD-PARTY-NOTICES.txt", to: "Resources/THIRD-PARTY-NOTICES.txt" },
        ]);
    });

    it("puts them beside the executable on Windows and Linux", () => {
        for (const platform of ["windows", "linux"] as const) {
            expect(extraFilesFor(withNotices, platform).map(file => file.to))
                .toEqual(["COPYRIGHT.txt", "THIRD-PARTY-NOTICES.txt"]);
        }
    });

    it("ships nothing the project does not have", () => {
        expect(extraFilesFor(config, "macos")).toEqual([]);
    });
});

/** A fuse set with both answers in it, so a position swapped in the conversion shows up. */
const FUSES: GameBuildWorkerFuses = {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: true,
    enableEmbeddedAsarIntegrityValidation: false,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
    resetAdHocDarwinSignature: false,
};

const targetFor = (platform: GameBuildWorkerTarget["platform"]) =>
    ({ ...target, platform, platformKey: `${platform}-x64`, fuses: FUSES }) as GameBuildWorkerTarget;

/**
 * What a Linux target asks of electron-builder that no other target does.
 *
 * The launcher has to be in the app directory before any artifact is made from it, and it takes the
 * executable's name - which is the file electron-builder flips the fuses on, after `afterPack`. So a
 * Linux target flips its own fuses inside `afterPack`, on the binary, before the launcher goes in,
 * and electron-builder is handed none. Every other platform is left exactly as it was.
 */
describe("a Linux target", () => {
    it("brings the launcher and the static AppImage runtime, and leaves the fuses to its own step", () => {
        const built = builderConfiguration(config, targetFor("linux"), () => undefined);
        expect(typeof built.afterPack).toBe("function");
        expect(built.toolsets).toEqual({ appimage: "1.0.3" });
        expect(built.electronFuses).toBeUndefined();
    });

    it("changes nothing for Windows or macOS", () => {
        for (const platform of ["windows", "macos"] as const) {
            const built = builderConfiguration(config, targetFor(platform), () => undefined);
            expect(built.electronFuses).toEqual(FUSES);
            expect(built.afterPack).toBeUndefined();
            expect(built.toolsets).toBeUndefined();
        }
    });
});

describe("electronFuseConfig", () => {
    it("is what electron-builder itself would have flipped for the same settings", async () => {
        // The conversion electron-builder runs on `electronFuses` is private to it; this reaches it
        // directly so the copy here cannot drift from it unnoticed.
        const theirs = await (LinuxPackager.prototype as unknown as {
            generateFuseConfig(fuses: GameBuildWorkerFuses): Promise<unknown>;
        }).generateFuseConfig(FUSES);
        expect(electronFuseConfig(FUSES)).toEqual(theirs);
    });
});

/**
 * The step itself, against a stand-in binary that carries a real fuse wire, flipped by
 * electron-builder's own `addElectronFuses` - the order is the point: the fuses land on the binary,
 * and the launcher takes its name afterwards.
 */
describe("the Linux afterPack step", () => {
    const SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
    let appOutDir: string;

    beforeEach(() => {
        appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "nl-after-pack-"));
    });

    afterEach(() => {
        fs.rmSync(appOutDir, { recursive: true, force: true });
    });

    it("flips the fuses on the binary, then puts the launcher in front of it", async () => {
        // ELF magic, some padding, then the wire: version 1, eight fuses, each the opposite of what the
        // set asks for, so every position the set names has to change.
        const wire = Buffer.from("10101011");
        fs.writeFileSync(path.join(appOutDir, "demo"), Buffer.concat([
            Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64), SENTINEL, Buffer.from([1, 8]), wire, Buffer.alloc(16),
        ]));
        const packager = Object.assign(Object.create(LinuxPackager.prototype) as LinuxPackager, { executableName: "demo" });
        const logged: string[] = [];
        const built = builderConfiguration(config, targetFor("linux"), (_level, message) => logged.push(message));
        const afterPack = built.afterPack as (context: AfterPackContext) => Promise<void>;

        await afterPack({ appOutDir, electronPlatformName: "linux", packager } as unknown as AfterPackContext);

        const binary = fs.readFileSync(path.join(appOutDir, `demo${LINUX_PROGRAM_SUFFIX}`));
        const at = binary.indexOf(SENTINEL) + SENTINEL.length + 2;
        // Positions 0-5 and 7 as the set says; 6, which the set does not name, as the binary had it.
        expect(binary.subarray(at, at + 8).toString()).toBe("01010110");
        expect(fs.readFileSync(path.join(appOutDir, "demo"), "utf-8")).toBe(renderLinuxLauncher("demo"));
        expect(logged.some(line => line.includes(`demo${LINUX_PROGRAM_SUFFIX}`))).toBe(true);
    });
});
