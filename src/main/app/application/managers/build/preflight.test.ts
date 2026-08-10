import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import type {
    NormalizedPluginManifestV2,
    PluginSidecarContribution,
    PluginSidecarTargetContribution,
} from "@shared/types/plugins";
import type { BuildPreflightFinding, GameBuildTarget } from "@shared/types/gameBuild";
import type { SigningCredential, SigningCredentialKind } from "@shared/types/signing";
import { GameBuildManager } from "./GameBuildManager";
import {
    checkIcon,
    collectSidecarRequirements,
    daysUntil,
    findGpgBinary,
    readMobileOrientation,
    readProjectSigningIds,
    sidecarLosesExecBit,
    signingCredentialSupportedOnHost,
    signingExpiryCode,
    signingPlatformForTarget,
    signingReachesNetwork,
} from "./preflight";

const config = (app: unknown): ProjectConfigData => ({ app, metadata: {} } as ProjectConfigData);

describe("readMobileOrientation", () => {
    it("reads each configured orientation", () => {
        for (const orientation of ["landscape", "portrait", "auto"] as const) {
            expect(readMobileOrientation(config({ mobile: { orientation } }))).toBe(orientation);
        }
    });

    it("defaults to landscape for projects saved before the setting existed", () => {
        // Every pre-existing project has no app.mobile at all; they must keep
        // building the way visual novels overwhelmingly play.
        expect(readMobileOrientation(config({}))).toBe("landscape");
        expect(readMobileOrientation(config(undefined))).toBe("landscape");
        expect(readMobileOrientation(null)).toBe("landscape");
    });

    it("falls back rather than pass an unknown value to the shell", () => {
        // The shell config is a contract; a hand-edited or newer-Studio value
        // must not reach it unchecked.
        expect(readMobileOrientation(config({ mobile: { orientation: "sideways" } }))).toBe("landscape");
        expect(readMobileOrientation(config({ mobile: { orientation: 42 } }))).toBe("landscape");
        expect(readMobileOrientation(config({ mobile: "portrait" }))).toBe("landscape");
    });
});

describe("sidecar preflight", () => {
    const target: PluginSidecarTargetContribution = {
        entry: "bin/tool",
        include: ["bin/tool"],
        sha256: { "bin/tool": "a".repeat(64) },
    };

    function manifestWith(
        pluginId: string,
        sidecars: Array<Partial<PluginSidecarContribution> & { id: string }>,
    ): NormalizedPluginManifestV2 {
        return {
            manifestVersion: 2,
            id: pluginId,
            name: pluginId,
            version: "1.0.0",
            entries: { runtime: "runtime.js" },
            contributes: {
                blueprintNodes: [],
                widgets: [],
                tests: [],
                runtimeData: [],
                locales: [],
                runtimeCapabilities: [],
                buildDependencies: [],
                sidecars: sidecars.map(sidecar => ({
                    kind: "executable",
                    transport: "stdio-jsonl",
                    autostart: "onGameStart",
                    startupTimeoutMs: 5000,
                    shutdownTimeoutMs: 3000,
                    restart: { maxRetries: 3, backoffMs: 1000 },
                    targets: {},
                    ...sidecar,
                })),
            },
            permissions: [],
        };
    }

    it("reports a pair for every platform being built, target or not", () => {
        const manifest = manifestWith("acme.p", [{
            id: "acme.p.bridge",
            targets: { "windows-x64": target },
        }]);

        const requirements = collectSidecarRequirements([manifest], ["windows-x64", "linux-x64"]);

        // The missing pair is the whole point: a plugin with no Linux binary
        // still packages, and whatever it provided is simply gone there.
        expect(requirements).toEqual([
            { pluginId: "acme.p", sidecarId: "acme.p.bridge", kind: "executable", platformKey: "windows-x64", target },
            { pluginId: "acme.p", sidecarId: "acme.p.bridge", kind: "executable", platformKey: "linux-x64" },
        ]);
    });

    it("yields nothing for plugins that contribute no sidecar at all", () => {
        expect(collectSidecarRequirements([manifestWith("acme.p", [])], ["windows-x64"])).toEqual([]);
    });

    it("blocks an executable sidecar cross-built from Windows for macOS or Linux", () => {
        const requirements = collectSidecarRequirements(
            [manifestWith("acme.p", [{
                id: "acme.p.bridge",
                targets: { "macos-arm64": target, "linux-x64": target, "windows-x64": target },
            }])],
            ["macos-arm64", "linux-x64", "windows-x64"],
        );

        // NTFS has no executable bit, so the copy inside the dmg/AppImage would
        // not be runnable. Only the Windows target itself is unaffected.
        expect(requirements.filter(requirement => sidecarLosesExecBit(requirement, "windows"))
            .map(requirement => requirement.platformKey))
            .toEqual(["macos-arm64", "linux-x64"]);
        // A Unix host carries the mode through, so nothing is blocked there.
        expect(requirements.some(requirement => sidecarLosesExecBit(requirement, "macos"))).toBe(false);
        expect(requirements.some(requirement => sidecarLosesExecBit(requirement, "linux"))).toBe(false);
    });

    it("does not block a node sidecar, which needs no executable bit", () => {
        const [requirement] = collectSidecarRequirements(
            [manifestWith("acme.p", [{
                id: "acme.p.bridge",
                kind: "node",
                targets: { "macos-arm64": target },
            }])],
            ["macos-arm64"],
        );
        expect(sidecarLosesExecBit(requirement, "windows")).toBe(false);
    });

    it("does not block a platform the plugin ships nothing for", () => {
        // Nothing is copied, so nothing loses its mode; that pair is the
        // warning's business, not the error's.
        const [requirement] = collectSidecarRequirements(
            [manifestWith("acme.p", [{ id: "acme.p.bridge", targets: { "windows-x64": target } }])],
            ["macos-arm64"],
        );
        expect(sidecarLosesExecBit(requirement, "windows")).toBe(false);
    });
});

describe("checkIcon", () => {
    let projectPath: string;

    beforeEach(async () => {
        projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "nls-preflight-icon-"));
        await fs.mkdir(path.join(projectPath, "resources", "icons", "derived"), { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(projectPath, { recursive: true, force: true });
    });

    /** A PNG header is all checkIcon reads, so that is all these files hold. */
    async function writePng(relativePath: string, width: number, height: number): Promise<void> {
        const bytes = Buffer.alloc(24);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
        bytes.write("IHDR", 12, "ascii");
        bytes.writeUInt32BE(width, 16);
        bytes.writeUInt32BE(height, 20);
        await fs.writeFile(path.join(projectPath, relativePath), bytes);
    }

    const configWith = (icons: unknown) => ({ metadata: { icons } }) as never;

    it("reports no icon at all as missing", async () => {
        expect(await checkIcon(projectPath, configWith({}), "windows")).toEqual({ status: "missing" });
    });

    it("reports a configured icon that is not on disk as missing", async () => {
        const config = configWith({ version: 2, master: { path: "resources/icons/source/master.png" } });
        expect(await checkIcon(projectPath, config, "windows")).toEqual({ status: "missing" });
    });

    it("prefers the baked file over the raw source", async () => {
        await writePng("resources/icons/derived/windows.png", 1024, 1024);
        const check = await checkIcon(projectPath, configWith({
            version: 2,
            master: { path: "resources/icons/source/master.png" },
            baked: { windows: { path: "resources/icons/derived/windows.png", fingerprint: "abc" } },
        }), "windows");
        expect(check).toMatchObject({ status: "ok", baked: true, lowResolution: false });
    });

    it("falls back to the raw source and flags it as un-baked", async () => {
        await fs.mkdir(path.join(projectPath, "resources", "icons", "source"), { recursive: true });
        await writePng("resources/icons/source/master.png", 1024, 1024);
        const check = await checkIcon(projectPath, configWith({
            version: 2,
            master: { path: "resources/icons/source/master.png" },
        }), "windows");
        expect(check).toMatchObject({ status: "ok", baked: false });
    });

    it("ships a small icon and flags it, rather than swapping in a default", async () => {
        await writePng("resources/icons/derived/windows.png", 256, 256);
        const check = await checkIcon(projectPath, configWith({
            version: 2,
            master: { path: "resources/icons/source/master.png" },
            baked: { windows: { path: "resources/icons/derived/windows.png", fingerprint: "abc" } },
        }), "windows");
        expect(check).toMatchObject({ status: "ok", lowResolution: true });
    });

    it("reports a corrupt PNG as unusable", async () => {
        await fs.writeFile(path.join(projectPath, "resources/icons/derived/windows.png"), Buffer.from("not a png"));
        const check = await checkIcon(projectPath, configWith({
            version: 2,
            master: { path: "resources/icons/source/master.png" },
            baked: { windows: { path: "resources/icons/derived/windows.png", fingerprint: "abc" } },
        }), "windows");
        expect(check).toEqual({ status: "unusable" });
    });

    it("resolves a legacy five-slot project through its promoted master", async () => {
        await fs.mkdir(path.join(projectPath, "resources", "icons"), { recursive: true });
        await writePng("resources/icons/app-icon-windows.png", 1024, 1024);
        const config = configWith({ windows: { path: "resources/icons/app-icon-windows.png" } });
        expect(await checkIcon(projectPath, config, "windows")).toMatchObject({ status: "ok", baked: false });
        // Linux never had its own slot here; it now inherits the master.
        expect(await checkIcon(projectPath, config, "linux")).toMatchObject({ status: "ok" });
    });
});

describe("readProjectSigningIds", () => {
    it("reads a credential id per platform", () => {
        expect(readProjectSigningIds(config({
            signing: { windows: "cred-win", android: "cred-droid" },
        }))).toEqual({ windows: "cred-win", android: "cred-droid" });
    });

    it("reports nothing for projects saved before signing existed", () => {
        expect(readProjectSigningIds(config({}))).toEqual({});
        expect(readProjectSigningIds(config(undefined))).toEqual({});
        expect(readProjectSigningIds(null)).toEqual({});
    });

    it("drops blanks, non-strings and platforms it does not know", () => {
        // "absent" is the meaningful state - it means "build this one unsigned" -
        // so a malformed entry must land there rather than become an id of "".
        // "web" is the unknown one: it is a real build target with no signing
        // slot, so a hand-edited or newer-Studio config could name it.
        expect(readProjectSigningIds(config({
            signing: { windows: "  ", linux: 42, web: "cred-web", ios: " cred-ios " },
        }))).toEqual({ ios: "cred-ios" });
    });

    it("survives a signing key that is not an object at all", () => {
        expect(readProjectSigningIds(config({ signing: "cred-win" }))).toEqual({});
    });
});

/**
 * The one signing finding that depends on the *formats* a target selected
 * rather than on the credential alone. It is driven through the real
 * signingPreflight - the rule reads the selection, and a test of the predicate
 * alone would not notice the rule being asked the wrong question.
 *
 * The vault is a hand-written credentials.json rather than a stub: `get` is what
 * decides whether the android slot is reached at all, and its on-disk shape is
 * the thing worth pinning. The other findings the same pass produces (the
 * password cannot be unsealed without a keyring here) are not this test's
 * business, so it asserts on one code.
 */
describe("the Google Play finding", () => {
    let vaultRoot: string;

    beforeEach(async () => {
        vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nls-preflight-play-"));
        await fs.writeFile(
            path.join(vaultRoot, "credentials.json"),
            JSON.stringify({
                version: 1,
                credentials: [{
                    id: "cred-droid",
                    kind: "android-keystore",
                    label: "Release key",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    file: "release.p12",
                    alias: "release",
                }],
            }),
        );
    });

    afterEach(async () => {
        await fs.rm(vaultRoot, { recursive: true, force: true });
    });

    async function findingsFor(formats: GameBuildTarget["formats"]): Promise<BuildPreflightFinding[]> {
        const manager = new GameBuildManager({
            storageManager: { getNamespacePath: () => vaultRoot },
        } as unknown as ConstructorParameters<typeof GameBuildManager>[0]);
        // signingPreflight is private: it is the unit under test precisely
        // because it is the only place the rule lives, and exporting it to be
        // testable would widen the manager's surface for a test's convenience.
        const preflight = (manager as unknown as {
            signingPreflight(
                projectConfig: ProjectConfigData | null,
                targets: GameBuildTarget[],
                hostPlatform: "windows",
                iosBundleId: string,
            ): Promise<BuildPreflightFinding[]>;
        }).signingPreflight;
        return preflight.call(
            manager,
            config({ signing: { android: "cred-droid" } }),
            [{ platform: "android", formats }],
            "windows",
            "com.example.game",
        );
    }

    const hasFinding = (findings: BuildPreflightFinding[]) =>
        findings.some(finding => finding.code === "signing-android-not-play");

    it("fires for an APK-only selection, as a warning", async () => {
        const findings = await findingsFor(["apk"]);
        expect(hasFinding(findings)).toBe(true);
        // It ships; it just cannot go to Play. The build is not blocked.
        expect(findings.find(finding => finding.code === "signing-android-not-play")).toMatchObject({
            severity: "warning",
            section: "signing",
        });
    });

    it("says nothing once the AAB is selected alongside", async () => {
        // The remedy the message names has been taken; repeating it would be
        // the kind of standing warning authors learn to scroll past.
        expect(hasFinding(await findingsFor(["apk", "aab"]))).toBe(false);
    });

    it("says nothing for an AAB-only selection", async () => {
        expect(hasFinding(await findingsFor(["aab"]))).toBe(false);
    });
});

describe("signingPlatformForTarget", () => {
    it("maps each build target onto the slot it signs from", () => {
        expect(signingPlatformForTarget("windows")).toBe("windows");
        expect(signingPlatformForTarget("macos")).toBe("macos");
        expect(signingPlatformForTarget("linux")).toBe("linux");
        expect(signingPlatformForTarget("android")).toBe("android");
        expect(signingPlatformForTarget("ios")).toBe("ios");
    });

    it("gives the web export no slot", () => {
        // Not "forgotten": a web export is files on a server, with nothing to
        // sign and nothing that would check a signature.
        expect(signingPlatformForTarget("web")).toBeNull();
    });
});

describe("signingCredentialSupportedOnHost", () => {
    it("confines the Windows certificate store to Windows hosts", () => {
        // electron-builder throws "supported only on Windows" rather than
        // producing an unsigned artifact, so preflight has to catch it first.
        expect(signingCredentialSupportedOnHost("windows-store", "windows")).toBe(true);
        expect(signingCredentialSupportedOnHost("windows-store", "macos")).toBe(false);
        expect(signingCredentialSupportedOnHost("windows-store", "linux")).toBe(false);
    });

    it("confines both macOS kinds to macOS hosts", () => {
        // Not just the keychain one: signing with a .p12 still goes through
        // Apple's codesign, which exists nowhere else. app-builder-lib's
        // isSignAllowed returns false off darwin and skips signing silently.
        for (const kind of ["macos-keychain", "macos-apple"] as const) {
            expect(signingCredentialSupportedOnHost(kind, "macos")).toBe(true);
            expect(signingCredentialSupportedOnHost(kind, "windows")).toBe(false);
            expect(signingCredentialSupportedOnHost(kind, "linux")).toBe(false);
        }
    });

    it("lets every other kind sign from any host", () => {
        for (const kind of ["windows-pfx", "windows-azure", "android-keystore", "ios-apple", "linux-gpg"] as const) {
            for (const host of ["windows", "macos", "linux"] as const) {
                expect(signingCredentialSupportedOnHost(kind, host)).toBe(true);
            }
        }
    });
});

describe("signingReachesNetwork", () => {
    const credential = (kind: SigningCredentialKind, extra: Record<string, string> = {}): SigningCredential =>
        ({ id: "x", label: "x", createdAt: "2026-01-01T00:00:00.000Z", kind, ...extra }) as SigningCredential;

    it("flags the Windows paths, which timestamp or sign remotely", () => {
        expect(signingReachesNetwork(credential("windows-pfx"))).toBe(true);
        expect(signingReachesNetwork(credential("windows-store"))).toBe(true);
        expect(signingReachesNetwork(credential("windows-azure"))).toBe(true);
    });

    it("keeps the local paths offline", () => {
        // The mobile repack and gpg never leave the machine; the offline
        // guarantee the build pipeline makes still holds for them.
        expect(signingReachesNetwork(credential("android-keystore"))).toBe(false);
        expect(signingReachesNetwork(credential("ios-apple"))).toBe(false);
        expect(signingReachesNetwork(credential("linux-gpg"))).toBe(false);
    });

    it("flags a macOS credential only when it actually notarizes", () => {
        // The distinction this function was widened for: codesign is local, and
        // notarization uploads the app to Apple. Two credentials of the same
        // kind can differ, which is why the whole credential comes in.
        expect(signingReachesNetwork(credential("macos-keychain", { identity: "Developer ID Application: X" })))
            .toBe(false);
        expect(signingReachesNetwork(credential("macos-apple", { p12File: "cert.p12" }))).toBe(false);
        expect(signingReachesNetwork(credential("macos-apple", {
            p12File: "cert.p12",
            notaryKeyFile: "key.p8",
            notaryKeyId: "ABC123",
            notaryIssuerId: "11111111-2222-3333-4444-555555555555",
        }))).toBe(true);
    });

    it("does not treat a half-filled notary set as notarizing", () => {
        // The vault refuses such an import, but credentials.json is a file on
        // the author's disk: a hand-edited one must not be read as "notarizes"
        // and warned about, nor silently as "does not" if it were complete.
        expect(signingReachesNetwork(credential("macos-apple", {
            p12File: "cert.p12",
            notaryKeyId: "ABC123",
        }))).toBe(false);
    });
});

describe("signingExpiryCode", () => {
    it("blocks on a certificate outside its validity window, either edge", () => {
        expect(signingExpiryCode("expired")).toBe("signing-credential-expired");
        // Not "expiring": a start date in the future fails signing today, just
        // like an end date in the past.
        expect(signingExpiryCode("not-yet-valid")).toBe("signing-credential-expired");
    });

    it("warns inside the expiry window and says nothing outside it", () => {
        expect(signingExpiryCode("expiring")).toBe("signing-credential-expiring");
        expect(signingExpiryCode("valid")).toBeNull();
    });
});

describe("daysUntil", () => {
    const now = new Date("2026-07-28T12:00:00Z");

    it("counts whole days to the deadline", () => {
        expect(daysUntil("2026-08-07T12:00:00Z", now)).toBe(10);
        expect(daysUntil("2026-07-29T00:00:00Z", now)).toBe(0);
    });

    it("floors a past or unparseable date at zero", () => {
        expect(daysUntil("2020-01-01T00:00:00Z", now)).toBe(0);
        expect(daysUntil("not a date", now)).toBe(0);
    });
});

describe("findGpgBinary", () => {
    let root: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-preflight-gpg-"));
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
    });

    async function writeBinary(dir: string, name: string): Promise<string> {
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, name);
        await fs.writeFile(filePath, "");
        return filePath;
    }

    it("finds gpg on PATH", async () => {
        const bin = path.join(root, "bin");
        const gpg = await writeBinary(bin, "gpg");
        expect(await findGpgBinary({ env: { PATH: bin }, platform: "linux" })).toBe(gpg);
    });

    it("prefers the path recorded on the credential over PATH", async () => {
        const onPath = path.join(root, "bin");
        await writeBinary(onPath, "gpg");
        const configured = await writeBinary(path.join(root, "custom"), "gpg");
        expect(await findGpgBinary({ configuredPath: configured, env: { PATH: onPath }, platform: "linux" }))
            .toBe(configured);
    });

    it("accepts GNUPG_PATH naming either the binary or the directory holding it", async () => {
        const dir = path.join(root, "gnupg");
        const gpg = await writeBinary(dir, "gpg");
        expect(await findGpgBinary({ env: { GNUPG_PATH: gpg }, platform: "linux" })).toBe(gpg);
        expect(await findGpgBinary({ env: { GNUPG_PATH: dir }, platform: "linux" })).toBe(gpg);
    });

    it("looks for the .exe names and the Gpg4win install location on Windows", async () => {
        const programFiles = path.join(root, "Program Files");
        const gpg = await writeBinary(path.join(programFiles, "GnuPG", "bin"), "gpg.exe");
        expect(await findGpgBinary({ env: { PATH: "", ProgramFiles: programFiles }, platform: "win32" })).toBe(gpg);
        // The POSIX names must not match on Windows, or a directory called "gpg"
        // would read as a binary.
        expect(await findGpgBinary({ env: { PATH: path.dirname(gpg) }, platform: "linux" })).toBeNull();
    });

    it("reports nothing when the host has no gpg", async () => {
        expect(await findGpgBinary({ env: { PATH: path.join(root, "empty") }, platform: "linux" })).toBeNull();
        expect(await findGpgBinary({ env: {}, platform: "linux" })).toBeNull();
    });

    it("does not mistake a directory for the binary", async () => {
        const bin = path.join(root, "bin");
        await fs.mkdir(path.join(bin, "gpg"), { recursive: true });
        expect(await findGpgBinary({ env: { PATH: bin }, platform: "linux" })).toBeNull();
    });
});
