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
import type { GameBuildWorkerConfig, GameBuildWorkerTarget } from "../protocol";
import { readZipAsTree, writeTreeAsZip } from "./archive";
import { writeFolderZip } from "../desktopZip";
import { fetchElectronRelease } from "./electronRelease";
import { LINUX_PROGRAM_SUFFIX } from "../linuxLauncher";
import { writeAppImage } from "../linuxPackage/appImage";
import { APPIMAGE_TOOLSET_VERSION, ensureAppImageToolset, readAppImageToolset } from "../linuxPackage/appImageToolset";
import type { SquashfsEntry } from "../linuxPackage/squashfs";
import { DIRECTORY_MODE, unixModeForContent as linuxModeForContent } from "../linuxPackage/unixModes";
import { asarHeaderHash, assembleMacApp, macBuildVersion as builderBuildVersion, sanitizeFileName, type MacApp } from "./macApp";
import { mergeUniversalBundle } from "./universal";
import { macModeForContent } from "./unixModes";

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
    log("info", `laying out the linux app with electron-builder, then writing its packages with the permission bits a Windows folder cannot keep`);
    await input.runBuilder({ ...config, outputDir: staging }, { ...target, formats: ["dir"] });
    const appRoot = await findUnpackedApp(staging, entry => entry.endsWith("-unpacked"));
    const metadata = await appMetadata(config.appDir as string);
    const artifacts: string[] = [];
    for (const format of target.formats) {
        if (format !== "zip" && format !== "appimage") {
            throw new Error(`Linux ${format} cannot be built on this machine.`);
        }
        const file = path.join(config.outputDir, desktopArtifactFileName({
            artifactBaseName: config.artifactBaseName,
            version: metadata.version,
            platform: "linux",
            arch: target.arch,
            format,
        }));
        if (format === "zip") {
            // Permission bits from each file's content, because a Windows folder keeps none.
            await writeFolderZip(appRoot, file, { fileMode: async absolute => linuxModeForContent(await readHead(absolute)) });
        } else {
            await writeLinuxAppImage({ config, target, log, appRoot, metadata, file });
        }
        artifacts.push(file);
    }
    return artifacts;
}

/**
 * An AppImage of the laid-out Linux app, written the way electron-builder writes one with its static
 * runtime (`toolsets.appimage: "1.0.3"`, which Linux and macOS hosts use too): the same stage layout
 * and launcher, Studio's SquashFS writer in place of `mksquashfs`. See linuxPackage/appImage.ts.
 */
async function writeLinuxAppImage(input: {
    config: GameBuildWorkerConfig;
    target: GameBuildWorkerTarget;
    log: PackLogger;
    appRoot: string;
    metadata: { version: string; description: string | null; desktopName: string | null };
    file: string;
}): Promise<void> {
    const { config, target, log, appRoot, metadata, file } = input;
    if (target.arch !== "x64" && target.arch !== "arm64") {
        throw new Error(`A Linux AppImage cannot be built for ${target.arch}.`);
    }
    if (!target.iconPath) {
        throw new Error("A Linux AppImage needs the app's icon, and this build has none.");
    }
    const archive = await ensureAppImageToolset({
        cacheRoot: config.hostCacheRoot ?? path.dirname(appRoot),
        ...(config.electronBuilderBinariesMirror ? { mirror: config.electronBuilderBinariesMirror } : {}),
        ...(config.downloadRewrites ? { rewrites: config.downloadRewrites } : {}),
        log,
    });
    const toolset = await readAppImageToolset(archive, target.arch);
    const { directories, files } = await walkFolder(appRoot);
    const app: SquashfsEntry[] = [
        ...directories.map(directory => ({ kind: "directory" as const, path: directory, mode: DIRECTORY_MODE })),
    ];
    for (const entry of files) {
        app.push({
            kind: "file",
            path: entry.relative,
            mode: linuxModeForContent(await readHead(entry.absolute)),
            content: () => fs.createReadStream(entry.absolute) as AsyncIterable<Uint8Array>,
        });
    }
    const icon = await fsPromises.readFile(target.iconPath);
    log("info", `writing the AppImage with Studio's SquashFS writer (static runtime ${APPIMAGE_TOOLSET_VERSION})`);
    await writeAppImage(file, {
        app,
        toolset,
        executableName: linuxExecutableName(files.map(entry => entry.relative)),
        productName: config.productName,
        productFilename: sanitizeFileName(config.productName),
        version: builderBuildVersion(metadata.version),
        ...(metadata.description ? { description: metadata.description } : {}),
        ...(metadata.desktopName ? { desktopName: metadata.desktopName } : {}),
        icons: [{ size: pngWidth(icon), png: icon }],
    });
}

/**
 * The Linux app's executable: the launcher electron-builder's afterPack step put in front of the
 * Electron binary (`<name>` beside `<name>.bin`), which is what the AppImage's AppRun starts.
 */
function linuxExecutableName(rootFiles: readonly string[]): string {
    const names = new Set(rootFiles.filter(name => !name.includes("/")));
    const launcher = [...names].find(name => names.has(`${name}${LINUX_PROGRAM_SUFFIX}`));
    if (!launcher) {
        throw new Error("The laid-out Linux app has no launcher beside its Electron binary.");
    }
    return launcher;
}

/** A PNG's width, from its IHDR chunk. */
function pngWidth(png: Buffer): number {
    if (png.length < 24 || png.readUInt32BE(12) !== 0x49484452) {
        throw new Error("The Linux app icon is not a PNG.");
    }
    return png.readUInt32BE(16);
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

    // 2. The bundle from Electron's macOS release (the same cache and mirror electron-builder uses),
    //    once per architecture; a universal app is both halves joined.
    const metadata = await appMetadata(appDir);
    const notices = new Map<string, Buffer>();
    if (config.copyrightFile) {
        notices.set("COPYRIGHT.txt", await fsPromises.readFile(config.copyrightFile));
    }
    if (config.thirdPartyNoticesFile) {
        notices.set("THIRD-PARTY-NOTICES.txt", await fsPromises.readFile(config.thirdPartyNoticesFile));
    }
    const icon = target.iconPath ? await fsPromises.readFile(target.iconPath) : undefined;
    const headerHash = asarHeaderHash(asar.data, data => crypto.createHash("sha256").update(data).digest("hex"));
    const assemble = async (arch: "x64" | "arm64") => {
        const releaseZip = await fetchElectronRelease({
            version: config.electronVersion,
            platform: "darwin",
            arch,
            ...(config.electronMirror ? { mirror: config.electronMirror } : {}),
        });
        log("info", `assembling the macOS app from ${path.basename(releaseZip)}`);
        return assembleMacApp({
            release: await readZipAsTree(releaseZip),
            productName: config.productName,
            appId: config.appId,
            version: metadata.version,
            author: metadata.author,
            ...(config.copyright ? { copyright: config.copyright } : {}),
            ...(icon ? { icon } : {}),
            languages: config.electronLanguages,
            resources,
            asarHeaderHash: headerHash,
            notices,
            fuses: target.fuses,
        });
    };
    let app: MacApp;
    if (target.arch === "universal") {
        const intel = await assemble("x64");
        const silicon = await assemble("arm64");
        app = { tree: mergeUniversalBundle(intel.tree, silicon.tree), bundlePath: silicon.bundlePath };
    } else {
        app = await assemble(target.arch);
    }

    // 3. Signed ad hoc, written as the zip electron-builder would have written.
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

async function appMetadata(appDir: string): Promise<{
    version: string;
    author: string | null;
    description: string | null;
    desktopName: string | null;
}> {
    const pkg = JSON.parse(await fsPromises.readFile(path.join(appDir, "package.json"), "utf8")) as {
        version?: string;
        author?: string | { name?: string };
        description?: string;
        desktopName?: string;
    };
    if (!pkg.version) {
        throw new Error("The compiled game's package.json has no version.");
    }
    // electron-builder normalises a string author ("Name <mail> (url)") to its name part.
    const author = typeof pkg.author === "string"
        ? pkg.author.replace(/\s*<[^>]*>/, "").replace(/\s*\([^)]*\)/, "").trim() || null
        : pkg.author?.name ?? null;
    return { version: pkg.version, author, description: pkg.description ?? null, desktopName: pkg.desktopName ?? null };
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
            resources.set(key, { kind: "file", mode: macModeForContent(data), data });
        } else {
            const { sha1, sha256 } = await hashFile(file.absolute);
            resources.set(key, {
                kind: "diskFile",
                mode: macModeForContent(await readHead(file.absolute)),
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
