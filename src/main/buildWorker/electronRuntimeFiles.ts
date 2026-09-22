/**
 * What of an Electron distribution a shipped game carries.
 *
 * electron-builder gets the runtime one of two ways. For a target the host's own Electron can
 * serve, Studio hands it that installation as `electronDist` - `node_modules/electron/dist` in a
 * development checkout, the embedded preview runner in an installed Studio - and electron-builder
 * copies the directory wholesale ("using custom unpacked Electron distribution"). For any other
 * target it downloads the release zip into its cache and extracts that.
 *
 * The two do not produce the same app. A downloaded zip is cleaned after extraction: electron-builder
 * deletes `resources/default_app.asar` (Electron's placeholder app, the "To run a local app..."
 * window) and the `version` file. A copied directory is deliberately left as it is found, and what
 * it is found holding is whatever the machine has put there since it was installed. It is a folder
 * Electron runs from: on Windows, Chromium's default log destination is a `debug.log` beside the
 * executable, which fills up with crash-reporter errors from any process that logs before Electron
 * has configured logging. It is also a folder a file manager may have opened. Left alone, every such
 * file ships, along with the placeholder app, in every game built for the host. An installed Studio
 * is no exception: its preview runner is a real Electron that runs on the author's machine, from a
 * folder the author can write to, and it is the installation an installed Studio packages from.
 *
 * {@link tidyElectronStage} runs as electron-builder's `afterExtract` hook, when the app directory
 * holds the distribution and nothing else yet, on both paths and every platform. It makes a copied
 * distribution into the downloaded one:
 *
 *  1. Litter is removed at any depth: {@link isElectronDistLitter}. The rule is a denylist of what
 *     machines produce rather than an allowlist of what Electron ships, and the asymmetry is the
 *     reason. Electron's file set changes between releases (the Windows one gained `dxcompiler.dll`
 *     and `dxil.dll` between 34 and 38), and an allowlist that fell behind would drop a library
 *     only some graphics paths load - a game that breaks on some players' machines, long after it
 *     built green. A name this denylist misses costs one stray file. `electronRuntimeFiles.test.ts`
 *     holds the rule against the complete file lists of real Electron releases, so it cannot drop
 *     anything a release contains.
 *  2. The two files electron-builder drops from a download are dropped from a copy too.
 *  3. On macOS, Electron's licence and Chromium's credits are put inside the bundle. See
 *     {@link macLicenceDestination}.
 */

import fs from "fs/promises";
import path from "path";
import type { GameBuildDesktopPlatform } from "@shared/types/gameBuild";
import { isHostLitter } from "@shared/utils/hostLitter";

/**
 * Written by the Chromium/Electron runtime itself, into the folder it runs from.
 *
 * `*.log` is Chromium's log file (`debug.log`, beside the executable on Windows, or wherever
 * `--log-file` pointed); `*.dmp` a minidump. No Electron release contains a file with either
 * extension, which is what lets this be a suffix rule here and nowhere else - the same suffixes
 * inside an author's folder may well be content.
 */
export function isElectronRuntimeOutput(name: string): boolean {
    const lower = name.toLowerCase();
    return lower.endsWith(".log") || lower.endsWith(".dmp");
}

/**
 * Whether a file or folder found in an Electron distribution is something the machine put there.
 *
 * `project/build/electron-dist-litter.js` is the same predicate for the packaging scripts, which
 * stage Studio's own preview runner from the same directory; the test holds the two together.
 */
export function isElectronDistLitter(name: string): boolean {
    return isHostLitter(name) || isElectronRuntimeOutput(name);
}

/**
 * The bundle a macOS distribution unpacks as. electron-builder renames it to the product's name
 * only after this hook has run (createMacApp), so this is the name it has here.
 */
const MAC_DIST_BUNDLE = "Electron.app";

/** The two licence texts every Electron distribution carries at its root, under these names. */
const DIST_LICENCES = [
    { source: "LICENSE", shipped: "LICENSE.electron.txt" },
    { source: "LICENSES.chromium.html", shipped: "LICENSES.chromium.html" },
] as const;

export interface ElectronStageInput {
    /** electron-builder's `appOutDir`: the directory the distribution was just unpacked into. */
    appOutDir: string;
    platform: GameBuildDesktopPlatform;
    /**
     * The installation electron-builder copied, when it copied one (`electronDist`). Unset when it
     * extracted a downloaded zip, which puts everything - licences included - in `appOutDir`.
     */
    sourceDist?: string;
}

export interface ElectronStageReport {
    /** Litter that was removed, relative to `appOutDir` and `/`-separated. */
    removedLitter: string[];
}

/**
 * Where a macOS game keeps Electron's licences: `Contents/`, beside `THIRD-PARTY-NOTICES.txt` and
 * `COPYRIGHT.txt`.
 *
 * electron-builder deletes both files from a macOS app outright (`electronMac.js`, after it has
 * built the bundle), where on Windows and Linux it leaves them beside the executable. A macOS app
 * has no "beside the executable" a player sees; the bundle is the folder they have. `Contents/` is
 * what the game's own notices already use as that folder (`extraFiles`, whose destination is
 * `Contents/` on macOS), so all four notice files are in one place on every platform. Sealing is
 * unaffected: codesign treats a plain file in `Contents/` as a resource like any other, and
 * `codesign --verify --deep --strict` accepts the result.
 */
function macLicenceDestination(appOutDir: string, shipped: string): string {
    return path.join(appOutDir, MAC_DIST_BUNDLE, "Contents", shipped);
}

/** Where electron-builder itself leaves a licence on Windows and Linux: the app root. */
function rootLicenceDestination(appOutDir: string, shipped: string): string {
    return path.join(appOutDir, shipped);
}

/**
 * Bring a freshly unpacked Electron distribution to what a shipped game carries. See the module
 * comment for the three steps and why each is here.
 *
 * Throws when a licence text cannot be found: a game whose runtime's licence did not travel with it
 * is not one to finish building, and the only way that happens is a distribution that is not an
 * Electron release.
 */
export async function tidyElectronStage(input: ElectronStageInput): Promise<ElectronStageReport> {
    const { appOutDir, platform } = input;
    const removedLitter = await removeLitter(appOutDir);

    // What electron-builder's cleanupAfterUnpack removes from a downloaded distribution and keeps in
    // a copied one. Both are absent from every app built from a download.
    const resourcesDir = platform === "macos"
        ? path.join(appOutDir, MAC_DIST_BUNDLE, "Contents", "Resources")
        : path.join(appOutDir, "resources");
    await fs.rm(path.join(resourcesDir, "default_app.asar"), { force: true });
    await fs.rm(path.join(appOutDir, "version"), { force: true });

    for (const licence of DIST_LICENCES) {
        if (platform === "macos") {
            await placeMacLicence(input, licence);
        } else if (!await exists(rootLicenceDestination(appOutDir, licence.shipped))) {
            // electron-builder renamed LICENSE to LICENSE.electron.txt already (cleanupAfterUnpack
            // does it on both paths); this only guards a distribution that had none to rename.
            throw new Error(
                `The Electron runtime being packaged has no ${licence.source}; `
                + "a game cannot ship without its runtime's licence.",
            );
        }
    }
    return { removedLitter };
}

async function placeMacLicence(
    input: ElectronStageInput,
    licence: (typeof DIST_LICENCES)[number],
): Promise<void> {
    // A download puts the licences beside the bundle, where electron-builder is about to delete
    // them; a copy never brings them at all (it copies only the bundle), so they come from the
    // installation it was copied from.
    const candidates = [
        path.join(input.appOutDir, licence.source),
        ...(input.sourceDist ? [path.join(input.sourceDist, licence.source)] : []),
    ];
    for (const candidate of candidates) {
        if (await exists(candidate)) {
            await fs.copyFile(candidate, macLicenceDestination(input.appOutDir, licence.shipped));
            return;
        }
    }
    throw new Error(
        `The Electron runtime being packaged has no ${licence.source} (looked in ${candidates.join(", ")}); `
        + "a game cannot ship without its runtime's licence.",
    );
}

/**
 * Remove every litter entry under `root`, returning what went.
 *
 * Symbolic links are neither followed nor removed unless their own name is litter: a macOS bundle's
 * frameworks are held together by relative links (`Versions/Current -> A`), and walking through one
 * would visit the same tree twice.
 */
async function removeLitter(root: string, prefix = ""): Promise<string[]> {
    const removed: string[] = [];
    const dir = prefix ? path.join(root, ...prefix.split("/")) : root;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (isElectronDistLitter(entry.name)) {
            await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
            removed.push(relative);
        } else if (entry.isDirectory()) {
            removed.push(...await removeLitter(root, relative));
        }
    }
    return removed;
}

async function exists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}
