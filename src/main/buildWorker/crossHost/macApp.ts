import { build as buildPlist, parse as parsePlist, type PlistObject, type PlistValue } from "plist";
import type { BundleEntry, BundleTree } from "../macBundle/bundleTree";
import type { GameBuildWorkerFuses } from "../protocol";
import { flipFusesInBinary } from "./fuses";

/**
 * A macOS game bundle assembled from Electron's release zip, without macOS.
 *
 * electron-builder will not build a macOS target anywhere but a Mac, so on other hosts Studio does
 * what its macOS packager does, step for step, on an in-memory tree: rename the bundle and its
 * helpers, rewrite the five Info.plists, drop Electron's placeholder app and the languages the game
 * does not offer, put the game's payload, icon and notices in, and flip the fuses. The result is
 * signed ad hoc by `adHocSignBundle` and written as a zip. Run on the same inputs on a Mac, it
 * produces the bundle electron-builder produces there file for file; the oracle test pins that.
 *
 * The plist rules below follow app-builder-lib 26's `createMacApp` (electron/electronMac.js),
 * `MacPackager.applyCommonInfo`, `AppInfo` and `removeUnusedLanguagesIfNeeded`
 * (electron/ElectronFramework.js), for the options Studio sets: no protocols, file associations,
 * extendInfo, category or helper bundle ids.
 */

/** The bundle a macOS release unpacks as, and the name every helper starts with. */
const RELEASE_BUNDLE = "Electron.app";
const RELEASE_PRODUCT = "Electron";

/** The helper apps Electron 38 ships, by the suffix electron-builder renames them with. */
const HELPER_SUFFIXES = ["", " (Renderer)", " (Plugin)", " (GPU)"] as const;

export type MacAppInput = {
    /** Electron's darwin release zip, as `readZipAsTree` reads it. */
    release: BundleTree;
    /** The application's display name (electron-builder's `productName`). */
    productName: string;
    appId: string;
    /** The game's version, from its package.json. */
    version: string;
    /** The package.json `author`, which electron-builder's default copyright line names. */
    author: string | null;
    /** The project's copyright line, when it has one. */
    copyright?: string;
    /** The `.icns` the bundle shows, when the project has an icon. */
    icon?: Buffer;
    /** `electronLanguages`: the locales to keep. Empty keeps them all. */
    languages: readonly string[];
    /** `Contents/Resources/` entries the game brings: `app.asar`, `app.asar.unpacked/...`. */
    resources: ReadonlyMap<string, BundleEntry>;
    /** The SHA-256 of `app.asar`'s header (see `asarHeaderHash`), for `ElectronAsarIntegrity`. */
    asarHeaderHash: string;
    /** Text files shipped in `Contents/Resources/` beside Electron's licences: COPYRIGHT.txt, THIRD-PARTY-NOTICES.txt. */
    notices: ReadonlyMap<string, Buffer>;
    fuses: GameBuildWorkerFuses;
    /** The year the default copyright line names; the current one unless a test pins it. */
    year?: number;
};

export type MacApp = {
    tree: BundleTree;
    /** The bundle's own path in the tree, `<product>.app`. */
    bundlePath: string;
};

/** electron-builder's `filterCFBundleIdentifier`. */
export function filterBundleIdentifier(identifier: string): string {
    return identifier.replace(/ /g, "-").replace(/[^a-zA-Z0-9.-]/g, "");
}

/**
 * The name the bundle and its executables carry: builder-util's `sanitizeFileName` in the NFD form
 * electron-builder's macOS packager asks for (codesign wants file names normalised that way).
 */
export function macProductFilename(productName: string): string {
    return sanitizeFileName(productName).normalize("NFD");
}

/**
 * The `sanitize-filename` package builder-util calls, restated: that package depends on one licensed
 * WTFPL alone, which Studio's notice check does not admit into a shipped bundle. Same rules, same
 * order: illegal and control characters, names made only of dots, Windows' reserved device names,
 * trailing dots and spaces, then a cut at 255 UTF-8 bytes that never splits a surrogate pair.
 * Pinned against the package itself by the test.
 */
export function sanitizeFileName(input: string): string {
    let sanitized = input
        .replace(/[/?<>\\:*|"]/g, "")
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x80-\x9f]/g, "")
        .replace(/^\.+$/, "")
        .replace(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i, "");
    let end = sanitized.length;
    while (end > 0 && (sanitized[end - 1] === "." || sanitized[end - 1] === " ")) {
        end--;
    }
    sanitized = sanitized.slice(0, end);
    return truncateUtf8(sanitized, 255);
}

function truncateUtf8(text: string, maxBytes: number): string {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        let segment = text[i];
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = text.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                i += 1;
                segment += text[i];
            }
        }
        bytes += Buffer.byteLength(segment, "utf8");
        if (bytes === maxBytes) {
            return text.slice(0, i + 1);
        }
        if (bytes > maxBytes) {
            return text.slice(0, i - segment.length + 1);
        }
    }
    return text;
}

/**
 * electron-builder's `AppInfo.buildVersion` with no `buildVersion` configured: the version, plus the
 * CI build number when one of the variables it reads is set.
 */
export function macBuildVersion(version: string, env: NodeJS.ProcessEnv = process.env): string {
    const buildNumber = env.BUILD_NUMBER || env.TRAVIS_BUILD_NUMBER || env.APPVEYOR_BUILD_NUMBER
        || env.CIRCLE_BUILD_NUM || env.BUILD_BUILDNUMBER || env.CI_PIPELINE_IID;
    return buildNumber && buildNumber.trim() ? `${version}.${buildNumber}` : version;
}

/** electron-builder's plist writer: keys sorted at every depth, then `plist.build`. */
function writePlist(value: PlistObject): Buffer {
    return Buffer.from(buildPlist(sortKeys(value) as PlistObject), "utf8");
}

function sortKeys(value: PlistValue): PlistValue {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (value === null || typeof value !== "object" || Buffer.isBuffer(value) || value instanceof Date) {
        return value;
    }
    const sorted: PlistObject = {};
    for (const key of Object.keys(value).sort()) {
        sorted[key] = sortKeys((value as PlistObject)[key]);
    }
    return sorted;
}

function readPlist(tree: BundleTree, path: string): PlistObject {
    const entry = tree.get(path);
    if (!entry || entry.kind !== "file") {
        throw new Error(`The Electron release has no ${path}.`);
    }
    return parsePlist(entry.data.toString("utf8")) as PlistObject;
}

/** electron-builder's `configureLocalhostAts`, for every target that is not the Mac App Store. */
function configureLocalhostAts(plist: PlistObject): void {
    const ats = (plist.NSAppTransportSecurity ?? {}) as PlistObject;
    plist.NSAppTransportSecurity = ats;
    ats.NSAllowsLocalNetworking = true;
    ats.NSAllowsArbitraryLoads = true;
    const domains = (ats.NSExceptionDomains ?? {}) as PlistObject;
    ats.NSExceptionDomains = domains;
    if (domains.localhost == null) {
        const allowHttp: PlistObject = {
            NSTemporaryExceptionAllowsInsecureHTTPSLoads: false,
            NSIncludesSubdomains: false,
            NSTemporaryExceptionAllowsInsecureHTTPLoads: true,
            NSTemporaryExceptionMinimumTLSVersion: "1.0",
            NSTemporaryExceptionRequiresForwardSecrecy: false,
        };
        domains.localhost = allowHttp;
        domains["127.0.0.1"] = allowHttp;
    }
}

/** electron-builder's locale match: case-insensitive, `-` and `_` alike, either side may be the bare language. */
function normalizeLocale(locale: string): string {
    return locale.trim().toLowerCase().replace(/_/g, "-");
}

function localeMatches(wanted: string, language: string): boolean {
    return wanted === language || language.startsWith(`${wanted}-`) || wanted.startsWith(`${language}-`);
}

/**
 * The `.lproj` folders `removeUnusedLanguagesIfNeeded` deletes from one directory. Like it, it
 * keeps every one when none would survive: an app with no locale folder left does not start.
 */
function unwantedLocaleFolders(tree: BundleTree, dir: string, languages: readonly string[]): string[] {
    const wanted = languages.map(normalizeLocale).filter(language => language.length > 0);
    if (wanted.length === 0) {
        return [];
    }
    // From every path beneath `dir`, not only directory entries: an archive need not list a folder
    // before what it holds.
    const names = new Set<string>();
    for (const path of tree.keys()) {
        if (path.startsWith(`${dir}/`)) {
            const name = path.slice(dir.length + 1).split("/")[0];
            if (name.endsWith(".lproj")) {
                names.add(name);
            }
        }
    }
    const folders = [...names].map(name => `${dir}/${name}`);
    const unwanted = folders.filter(folder => {
        const language = normalizeLocale(folder.slice(dir.length + 1, -".lproj".length));
        return !wanted.some(candidate => localeMatches(candidate, language));
    });
    return folders.length > 0 && unwanted.length === folders.length ? [] : unwanted;
}

function removeSubtree(tree: BundleTree, path: string): void {
    for (const key of [...tree.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) {
            tree.delete(key);
        }
    }
}

/**
 * A directory the release zip names but nothing lands in.
 *
 * electron-builder extracts the release with a tool that writes files and links, and creates
 * directories only to hold them, so an empty directory in the zip (Electron ships one `*.lproj` per
 * locale in the app's own Resources, all empty) never exists in a bundle it builds. Dropped here so
 * the two bundles hold the same entries.
 */
function removeEmptyDirectories(tree: BundleTree): void {
    const holders = new Set<string>();
    for (const [path, entry] of tree) {
        if (entry.kind === "directory") {
            continue;
        }
        for (let slash = path.indexOf("/"); slash >= 0; slash = path.indexOf("/", slash + 1)) {
            holders.add(path.slice(0, slash));
        }
    }
    for (const [path, entry] of [...tree]) {
        if (entry.kind === "directory" && !holders.has(path)) {
            tree.delete(path);
        }
    }
}

export async function assembleMacApp(input: MacAppInput): Promise<MacApp> {
    const filename = macProductFilename(input.productName);
    const bundlePath = `${filename}.app`;
    const contents = `${bundlePath}/Contents`;
    const frameworks = `${contents}/Frameworks`;

    // 1. The release's bundle, under its new name; the helpers renamed as createMacApp's moveHelpers
    //    does. Electron's placeholder app goes, as electron-builder's cleanupAfterUnpack removes it.
    const tree: BundleTree = new Map();
    const helperPattern = /^Contents\/Frameworks\/Electron Helper( \([A-Za-z]+\))?\.app(\/.*)?$/;
    for (const [path, entry] of input.release) {
        if (!path.startsWith(`${RELEASE_BUNDLE}/`) && path !== RELEASE_BUNDLE) {
            continue;
        }
        const relative = path.slice(RELEASE_BUNDLE.length + 1);
        if (relative === "Contents/Resources/default_app.asar") {
            continue;
        }
        let mapped = relative;
        if (relative === `Contents/MacOS/${RELEASE_PRODUCT}`) {
            mapped = `Contents/MacOS/${filename}`;
        } else {
            const helper = helperPattern.exec(relative);
            if (helper) {
                const suffix = helper[1] ?? "";
                const rest = (helper[2] ?? "").replace(
                    `/Contents/MacOS/${RELEASE_PRODUCT} Helper${suffix}`,
                    `/Contents/MacOS/${filename} Helper${suffix}`,
                );
                mapped = `Contents/Frameworks/${filename} Helper${suffix}.app${rest}`;
            }
        }
        tree.set(mapped ? `${bundlePath}/${mapped}` : bundlePath, entry);
    }
    if (!tree.has(`${contents}/Info.plist`)) {
        throw new Error("The Electron release has no macOS application in it.");
    }

    // 2. The app's Info.plist: createMacApp, applyCommonInfo and configureLocalhostAts.
    const appPlist = readPlist(tree, `${contents}/Info.plist`);
    const bundleId = filterBundleIdentifier(input.appId);
    appPlist.CFBundleIdentifier = bundleId;
    appPlist.CFBundleExecutable = filename.endsWith(" Helper") ? filename.slice(0, -" Helper".length) : filename;
    appPlist.CFBundleName = input.productName;
    appPlist.CFBundleDisplayName = input.productName;
    if (input.icon) {
        const previous = appPlist.CFBundleIconFile;
        if (typeof previous === "string") {
            tree.delete(`${contents}/Resources/${previous}`);
        }
        appPlist.CFBundleIconFile = "icon.icns";
        tree.set(`${contents}/Resources/icon.icns`, { kind: "file", mode: 0o644, data: input.icon });
    }
    appPlist.CFBundleShortVersionString = input.version;
    appPlist.CFBundleVersion = macBuildVersion(input.version);
    appPlist.NSHumanReadableCopyright = input.copyright
        ?? `Copyright © ${input.year ?? new Date().getFullYear()} ${input.author || input.productName}`;
    for (const [key, value] of Object.entries(appPlist)) {
        if (value === null || value === undefined) {
            delete appPlist[key];
        }
    }
    configureLocalhostAts(appPlist);
    appPlist.ElectronAsarIntegrity = {
        "Resources/app.asar": { algorithm: "SHA256", hash: input.asarHeaderHash },
    };
    tree.set(`${contents}/Info.plist`, { kind: "file", mode: 0o644, data: writePlist(appPlist) });

    // 3. The helpers' Info.plists.
    const helperId = filterBundleIdentifier(`${bundleId}.helper`);
    for (const suffix of HELPER_SUFFIXES) {
        const plistPath = `${frameworks}/${filename} Helper${suffix}.app/Contents/Info.plist`;
        if (!tree.has(plistPath)) {
            continue;
        }
        const helper = readPlist(tree, plistPath);
        const postfix = suffix.trim();
        helper.CFBundleExecutable = `${filename} Helper${suffix}`;
        helper.CFBundleDisplayName = `${input.productName} Helper${suffix}`;
        helper.CFBundleIdentifier = postfix ? filterBundleIdentifier(`${helperId}.${postfix}`) : helperId;
        helper.CFBundleVersion = appPlist.CFBundleVersion;
        tree.set(plistPath, { kind: "file", mode: 0o644, data: writePlist(helper) });
    }

    // 4. The languages the game does not offer, from the app's Resources and the framework's.
    const frameworkResources = `${frameworks}/Electron Framework.framework/Versions/A/Resources`;
    for (const dir of [`${contents}/Resources`, frameworkResources]) {
        for (const folder of unwantedLocaleFolders(tree, dir, input.languages)) {
            removeSubtree(tree, folder);
        }
    }

    // 5. The fuses, in the framework binary every process of the app loads.
    const frameworkBinary = `${frameworks}/Electron Framework.framework/Versions/A/Electron Framework`;
    const framework = tree.get(frameworkBinary);
    if (!framework || framework.kind !== "file") {
        throw new Error("The Electron release has no Electron Framework binary.");
    }
    tree.set(frameworkBinary, { ...framework, data: await flipFusesInBinary(framework.data, input.fuses) });

    // 6. What the game brings, and the notices beside Electron's own licence texts.
    for (const [path, entry] of input.resources) {
        tree.set(`${contents}/Resources/${path}`, entry);
    }
    const licences = [
        { source: "LICENSE", shipped: "LICENSE.electron.txt" },
        { source: "LICENSES.chromium.html", shipped: "LICENSES.chromium.html" },
    ];
    for (const licence of licences) {
        const entry = input.release.get(licence.source);
        if (!entry || entry.kind !== "file") {
            throw new Error(`The Electron release has no ${licence.source}; a game cannot ship without its runtime's licence.`);
        }
        tree.set(`${contents}/Resources/${licence.shipped}`, { kind: "file", mode: 0o644, data: entry.data });
    }
    for (const [name, data] of input.notices) {
        tree.set(`${contents}/Resources/${name}`, { kind: "file", mode: 0o644, data });
    }

    removeEmptyDirectories(tree);
    return { tree, bundlePath };
}

/**
 * The SHA-256 of an asar archive's header, as electron-builder's `hashHeader` computes it for
 * `ElectronAsarIntegrity`: over the header's JSON text, read out of its two Chromium pickles.
 */
export function asarHeaderHash(archiveStart: Buffer, sha256: (data: Buffer) => string): string {
    if (archiveStart.length < 16) {
        throw new Error("app.asar is too short to hold a header.");
    }
    // [payload size][header pickle size] then the header pickle: [payload size][string length][string].
    const headerPickleSize = archiveStart.readUInt32LE(4);
    const header = archiveStart.subarray(8, 8 + headerPickleSize);
    const length = header.readInt32LE(4);
    if (8 + length > header.length) {
        throw new Error("app.asar's header is cut short.");
    }
    return sha256(header.subarray(8, 8 + length));
}
