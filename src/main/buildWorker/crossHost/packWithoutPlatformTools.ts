import crypto from "crypto";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import {
    currentGameBuildPlatform,
    desktopArtifactFileName,
    type GameBuildArch,
} from "@shared/types/gameBuild";
import { adHocSignBundle } from "../macBundle/adhocSign";
import type { BundleEntry } from "../macBundle/bundleTree";
import { writeZip, type ZipWriteEntry } from "../mobile/zipWriter";
import type { GameBuildWorkerConfig, GameBuildWorkerTarget } from "../protocol";
import { FileZipOutput, readZipAsTree, writeTreeAsZip } from "./archive";
import { fetchElectronRelease } from "./electronRelease";
import { asarHeaderHash, assembleMacApp } from "./macApp";
import { unixModeForContent } from "./unixModes";

/**
 * Packaging a desktop target on a host whose tools cannot: macOS anywhere but a Mac, Linux on
 * Windows (see `hostPackagesWithoutPlatformTools`).
 *
 * electron-builder still does everything it can do anywhere, so the parts a player's game is made
 * of come from the same code as on the platform's own host: for Linux it lays out the whole app, for
 * macOS it lays out the game's payload (`app.asar` and what is unpacked beside it) in an app for the
 * host, which needs no download. What it cannot do is the last step - write a package whose links
 * and permission bits survive a Windows file system, and for macOS build the bundle at all and sign
 * it - and that step is Studio's: the archive is written straight from memory, the macOS bundle is
 * assembled from Electron's release zip and signed ad hoc. Only archives come out (`zip`); the
 * formats that need the platform's own tools stay with it (`hostBuildableFormats`).
 */

export type BuilderRun = (config: GameBuildWorkerConfig, target: GameBuildWorkerTarget) => Promise<void>;
export type PackLogger = (level: "info" | "warning" | "error", message: string) => void;

/** Files at least this large stay on disk and are hashed as they stream; smaller ones are read whole. */
const DISK_FILE_THRESHOLD = 64 * 1024 * 1024;

export async function packWithoutPlatformTools(input: {
    config: GameBuildWorkerConfig;
    target: GameBuildWorkerTarget;
    runBuilder: BuilderRun;
    log: PackLogger;
}): Promise<string[]> {
    const { config, target } = input;
    const appDir = config.appDir;
    if (!appDir) {
        throw new Error("Desktop packaging requires a compiled app dir");
    }
    // Beside the compiled app, where the build's other intermediate output lives, rather than in the
    // output folder an author opens: nothing in it is a package.
    const staging = path.join(path.dirname(appDir), "cross-host", target.platformKey);
    await fsPromises.rm(staging, { recursive: true, force: true });
    await fsPromises.mkdir(staging, { recursive: true });
    // electron-builder creates the output folder for what it writes; here it writes elsewhere.
    await fsPromises.mkdir(config.outputDir, { recursive: true });
    try {
        switch (target.platform) {
            case "macos":
                return await packMacApp({ ...input, appDir, staging });
            case "linux":
                return await packLinuxApp({ ...input, staging });
            case "windows":
                throw new Error("Windows targets are packaged by electron-builder on every host.");
        }
    } finally {
        await fsPromises.rm(staging, { recursive: true, force: true });
        // And the folder holding every target's staging, once the last of them is gone.
        await fsPromises.rmdir(path.dirname(staging)).catch(() => undefined);
    }
}

async function packLinuxApp(input: {
    config: GameBuildWorkerConfig;
    target: GameBuildWorkerTarget;
    runBuilder: BuilderRun;
    log: PackLogger;
    staging: string;
}): Promise<string[]> {
    const { config, target, log, staging } = input;
    log("info", `laying out the linux app with electron-builder, then writing its archive with the permission bits a Windows folder cannot keep`);
    await input.runBuilder({ ...config, outputDir: staging }, { ...target, formats: ["dir"] });
    const appRoot = await findUnpackedApp(staging, entry => entry.endsWith("-unpacked"));
    const version = await appVersion(config.appDir as string);
    const artifacts: string[] = [];
    for (const format of target.formats) {
        if (format !== "zip") {
            throw new Error(`Linux ${format} cannot be built on this machine.`);
        }
        const file = path.join(config.outputDir, desktopArtifactFileName({
            artifactBaseName: config.artifactBaseName,
            version,
            platform: "linux",
            arch: target.arch,
            format,
        }));
        await writeFolderAsZip(appRoot, file);
        artifacts.push(file);
    }
    return artifacts;
}

async function packMacApp(input: {
    config: GameBuildWorkerConfig;
    target: GameBuildWorkerTarget;
    runBuilder: BuilderRun;
    log: PackLogger;
    appDir: string;
    staging: string;
}): Promise<string[]> {
    const { config, target, log, appDir, staging } = input;
    if (target.arch === "universal") {
        throw new Error("A universal macOS app cannot be built on this machine yet; build arm64 and x64 separately.");
    }
    if (target.signing) {
        // Preflight already refuses a macOS credential off a Mac; this keeps the worker from ever
        // shipping an ad-hoc signature over a build an author asked to have signed.
        throw new Error("macOS code signing with a certificate requires a Mac.");
    }

    // 1. The payload, laid out by electron-builder as an app for this host from the macOS target's
    //    own file set (its staged codec and koffi), with the host's Electron so nothing downloads.
    const host = currentGameBuildPlatform();
    const hostArch = hostBuildArch();
    log("info", `laying out the game's payload with electron-builder (as a ${host} app, no download)`);
    await input.runBuilder({ ...config, outputDir: staging }, {
        platform: host,
        arch: hostArch,
        formats: ["dir"],
        platformKey: target.platformKey,
        fuses: target.fuses,
        ...(target.hostElectronDist ? { electronDist: target.hostElectronDist } : {}),
    });
    const hostApp = await findUnpackedApp(staging, entry => entry.endsWith("-unpacked"));
    const resourcesDir = path.join(hostApp, "resources");
    const resources = await readResources(resourcesDir);
    const asar = resources.get("app.asar");
    if (!asar || asar.kind !== "file") {
        throw new Error("electron-builder produced no app.asar for the macOS payload.");
    }

    // 2. Electron's macOS release, from the same cache and mirror electron-builder uses.
    const releaseZip = await fetchElectronRelease({
        version: config.electronVersion,
        platform: "darwin",
        arch: target.arch,
        ...(config.electronMirror ? { mirror: config.electronMirror } : {}),
    });
    log("info", `assembling the macOS app from ${path.basename(releaseZip)}`);
    const release = await readZipAsTree(releaseZip);

    // 3. The bundle, signed ad hoc, written as the zip electron-builder would have written.
    const metadata = await appMetadata(appDir);
    const notices = new Map<string, Buffer>();
    if (config.copyrightFile) {
        notices.set("COPYRIGHT.txt", await fsPromises.readFile(config.copyrightFile));
    }
    if (config.thirdPartyNoticesFile) {
        notices.set("THIRD-PARTY-NOTICES.txt", await fsPromises.readFile(config.thirdPartyNoticesFile));
    }
    const app = await assembleMacApp({
        release,
        productName: config.productName,
        appId: config.appId,
        version: metadata.version,
        author: metadata.author,
        ...(config.copyright ? { copyright: config.copyright } : {}),
        ...(target.iconPath ? { icon: await fsPromises.readFile(target.iconPath) } : {}),
        languages: config.electronLanguages,
        resources,
        asarHeaderHash: asarHeaderHash(asar.data, data => crypto.createHash("sha256").update(data).digest("hex")),
        notices,
        fuses: target.fuses,
    });
    adHocSignBundle(app.tree, app.bundlePath, message => log("info", message));
    log("info", "the macOS app is signed ad hoc (no certificate); players see a security prompt the first time they open it");

    const artifacts: string[] = [];
    for (const format of target.formats) {
        if (format !== "zip") {
            throw new Error(`macOS ${format} cannot be built on this machine.`);
        }
        const file = path.join(config.outputDir, desktopArtifactFileName({
            artifactBaseName: config.artifactBaseName,
            version: metadata.version,
            platform: "macos",
            arch: target.arch,
            format,
        }));
        await writeTreeAsZip(app.tree, file, new Date());
        artifacts.push(file);
    }
    return artifacts;
}

/** The architecture of the machine this runs on, in build terms. */
function hostBuildArch(): GameBuildArch {
    return process.arch === "arm64" ? "arm64" : "x64";
}

/** The one unpacked app electron-builder left in `dir`. */
async function findUnpackedApp(dir: string, matches: (name: string) => boolean): Promise<string> {
    const candidates = (await fsPromises.readdir(dir, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && matches(entry.name));
    if (candidates.length !== 1) {
        throw new Error(`Expected one unpacked app in ${dir}, found ${candidates.map(entry => entry.name).join(", ") || "none"}.`);
    }
    return path.join(dir, candidates[0].name);
}

async function appMetadata(appDir: string): Promise<{ version: string; author: string | null }> {
    const pkg = JSON.parse(await fsPromises.readFile(path.join(appDir, "package.json"), "utf8")) as {
        version?: string;
        author?: string | { name?: string };
    };
    if (!pkg.version) {
        throw new Error("The compiled game's package.json has no version.");
    }
    // electron-builder normalises a string author ("Name <mail> (url)") to its name part.
    const author = typeof pkg.author === "string"
        ? pkg.author.replace(/\s*<[^>]*>/, "").replace(/\s*\([^)]*\)/, "").trim() || null
        : pkg.author?.name ?? null;
    return { version: pkg.version, author };
}

async function appVersion(appDir: string): Promise<string> {
    return (await appMetadata(appDir)).version;
}

type FolderFile = { relative: string; absolute: string; size: number };

/** Every file and directory under `root`, `/`-separated and sorted, parents first. */
async function walkFolder(root: string): Promise<{ directories: string[]; files: FolderFile[] }> {
    const directories: string[] = [];
    const files: FolderFile[] = [];
    const visit = async (relative: string): Promise<void> => {
        const absolute = relative ? path.join(root, ...relative.split("/")) : root;
        for (const entry of await fsPromises.readdir(absolute, { withFileTypes: true })) {
            const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
            const childAbsolute = path.join(absolute, entry.name);
            if (entry.isDirectory()) {
                directories.push(childRelative);
                await visit(childRelative);
            } else if (entry.isFile()) {
                files.push({ relative: childRelative, absolute: childAbsolute, size: (await fsPromises.stat(childAbsolute)).size });
            } else {
                throw new Error(`${childAbsolute} is neither a file nor a folder; a package laid out on this machine has no links.`);
            }
        }
    };
    await visit("");
    directories.sort();
    files.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
    return { directories, files };
}

async function readHead(file: string): Promise<Buffer> {
    const handle = await fsPromises.open(file, "r");
    try {
        const head = Buffer.alloc(4);
        const { bytesRead } = await handle.read(head, 0, 4, 0);
        return head.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
}

/**
 * `Contents/Resources/` entries from the host app's `resources/`: `app.asar` and everything unpacked
 * beside it. Large files stay on disk, hashed on the way past so the signer can seal them.
 */
async function readResources(resourcesDir: string): Promise<Map<string, BundleEntry>> {
    const resources = new Map<string, BundleEntry>();
    const asarPath = path.join(resourcesDir, "app.asar");
    resources.set("app.asar", { kind: "file", mode: 0o644, data: await fsPromises.readFile(asarPath) });
    const unpackedDir = path.join(resourcesDir, "app.asar.unpacked");
    if (!fs.existsSync(unpackedDir)) {
        return resources;
    }
    const { directories, files } = await walkFolder(unpackedDir);
    resources.set("app.asar.unpacked", { kind: "directory", mode: 0o755 });
    for (const directory of directories) {
        resources.set(`app.asar.unpacked/${directory}`, { kind: "directory", mode: 0o755 });
    }
    for (const file of files) {
        const key = `app.asar.unpacked/${file.relative}`;
        if (file.size < DISK_FILE_THRESHOLD) {
            const data = await fsPromises.readFile(file.absolute);
            resources.set(key, { kind: "file", mode: unixModeForContent(data), data });
        } else {
            const { sha1, sha256 } = await hashFile(file.absolute);
            resources.set(key, {
                kind: "diskFile",
                mode: unixModeForContent(await readHead(file.absolute)),
                path: file.absolute,
                size: file.size,
                sha1,
                sha256,
            });
        }
    }
    return resources;
}

async function hashFile(file: string): Promise<{ sha1: Buffer; sha256: Buffer }> {
    const sha1 = crypto.createHash("sha1");
    const sha256 = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) {
        sha1.update(chunk as Buffer);
        sha256.update(chunk as Buffer);
    }
    return { sha1: sha1.digest(), sha256: sha256.digest() };
}

/** A folder laid out on this machine, as a zip whose permission bits come from each file's content. */
async function writeFolderAsZip(root: string, file: string): Promise<void> {
    const { directories, files } = await walkFolder(root);
    const modes = new Map<string, number>();
    for (const entry of files) {
        modes.set(entry.relative, unixModeForContent(await readHead(entry.absolute)));
    }
    const entries: ZipWriteEntry[] = [
        ...directories.map(directory => ({ name: `${directory}/`, source: null, unixMode: 0o755 })),
        ...files.map(entry => ({
            name: entry.relative,
            source: { kind: "stream" as const, size: entry.size, open: () => fs.createReadStream(entry.absolute) },
            unixMode: modes.get(entry.relative),
        })),
    ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const output = await FileZipOutput.create(file);
    try {
        await writeZip(output, entries, { mtime: new Date(), allowZip64: true });
    } finally {
        await output.close();
    }
}

