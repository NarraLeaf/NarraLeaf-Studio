import { parseZipIndex, readEntryBytes, readLocalEntryDataSpan, type ZipIndexEntry } from "./zipModel";
import { patchBinaryManifest } from "./axml";
import { patchArscPackageName } from "./arsc";
import { convertBinaryManifestToProto } from "./axmlProto";
import { convertArscToProto } from "./arscProto";
import {
    assetDirectoriesOf,
    bundleModulePath,
    BUNDLE_MODULE,
    encodeAssets,
    encodeBundleConfig,
    encodeNativeLibraries,
    nativeDirectoriesOf,
} from "./aabBundle";
import { BufferZipOutput, writeZip, type ZipWriteEntry } from "./zipWriter";
import type { AndroidShellTemplate } from "./mobileShellManifest";
import type { ApkWwwEntry } from "./repackApk";

/**
 * Android App Bundle assembly: the same prebuilt shell template and the same
 * game payload repackApk turns into an installable APK, laid out instead as
 * the .aab Google Play accepts. Composes the identity patches (axml, arsc) the
 * APK path already uses, the two protobuf converters the bundle format
 * requires (axmlProto, arscProto), the container metadata (aabBundle) and the
 * zip writer.
 *
 * An .aab is the PROTOBUF form of an APK, which is the whole reason this is
 * not a path rename: AndroidManifest.xml and resources.arsc are converted, not
 * copied, and every other entry moves into the `base` module by
 * aabBundle.bundleModulePath. No Gradle, no aapt2, no bundletool - none of
 * them may become a runtime dependency of a desktop app, and none is needed.
 *
 * The output is UNSIGNED. A bundle is JAR-signed (the v2 APK signing block has
 * no meaning here), which is composed on top by the caller; keeping signing
 * out means this stays a pure Buffer-in/Buffer-out transform with the same
 * guarantees as repackApk - symlinks rejected, www paths validated, icon slots
 * that the template does not have rejected, one injected mtime for
 * reproducibility, no zip64.
 *
 * Unlike the APK there is no alignment contract: a bundle is never mmap'd by
 * the platform (bundletool re-lays-out every APK it generates from it), so
 * resources.pb needs neither stored encoding nor 4-byte alignment and deflate
 * is used throughout.
 */

const ANDROID_MANIFEST_PATH = "AndroidManifest.xml";
const RESOURCES_ARSC_PATH = "resources.arsc";

const BUNDLE_CONFIG_PATH = "BundleConfig.pb";
const NATIVE_TARGETING_PATH = `${BUNDLE_MODULE}/native.pb`;
const ASSETS_TARGETING_PATH = `${BUNDLE_MODULE}/assets.pb`;

/**
 * Compiled binary XML anywhere under res/ except res/raw*, where aapt2 leaves
 * XML files uncompiled. A bundle needs proto XML in those slots, and passing
 * the binary form through would produce an archive that only fails later, in
 * bundletool or on a device.
 */
const COMPILED_RES_XML = /^res\/(?!raw)[^/]*\/.*\.xml$/i;

/**
 * Same shape as RepackApkInput minus the signing identity: the caller builds
 * one input object and hands it to both, so the field names are deliberately
 * identical rather than merely similar.
 */
export type BuildAabInput = {
    /** The template APK (release or debug variant, chosen by the manager). */
    templateApk: Buffer;
    android: AndroidShellTemplate;
    /** Final Android package name (already normalized to package-name rules). */
    applicationId: string;
    /** Home-screen label. */
    label: string;
    /** android:versionName - the raw semver. */
    versionName: string;
    /** android:versionCode - the monotonic integer. */
    versionCode: number;
    /** The compiled game site, injected under the manifest's wwwRoot. */
    www: Iterable<ApkWwwEntry>;
    /** Written to the manifest's shellConfigPath verbatim. */
    shellConfigJson: string;
    /** Icon slot (zip entry path) → replacement PNG bytes. */
    iconPngBySlot?: Record<string, Buffer>;
    /** Fixed timestamp for reproducible output. */
    mtime: Date;
};

function assertSafeRelativePath(relativePath: string): void {
    if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\\")) {
        throw new Error(`Unsafe www path: "${relativePath}"`);
    }
    for (const segment of relativePath.split("/")) {
        if (segment === "." || segment === ".." || segment === "") {
            throw new Error(`Unsafe www path: "${relativePath}"`);
        }
    }
}

function rawPassthrough(template: Buffer, entry: ZipIndexEntry): NonNullable<ZipWriteEntry["source"]> {
    const { start, end } = readLocalEntryDataSpan(template, entry);
    return {
        kind: "raw",
        method: entry.method,
        crc32: entry.crc32,
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
        open: () => (async function* () {
            yield template.subarray(start, end);
        })(),
    };
}

export async function buildAab(input: BuildAabInput): Promise<Buffer> {
    const { android, templateApk } = input;
    const iconSlots = new Set(android.iconSlots);
    const wwwRoot = android.wwwRoot.replace(/^\/+|\/+$/g, "");

    const index = parseZipIndex(templateApk);
    /** Module-relative path → the entry that will carry it. */
    const moduleEntries: { modulePath: string; source: NonNullable<ZipWriteEntry["source"]> }[] = [];
    const appliedIconSlots = new Set<string>();
    let sawManifest = false;
    let sawArsc = false;

    for (const entry of index.entries) {
        if ((entry.unixMode & 0o170000) === 0o120000) {
            throw new Error(`Template contains a symlink ("${entry.name}"), which the bundle build does not support`);
        }
        if (entry.isDirectory) {
            // A bundle carries no directory entries: bundletool derives every
            // directory it cares about from the targeting side-files, and an
            // empty directory would be one more thing to keep in sync.
            continue;
        }
        if (entry.name === ANDROID_MANIFEST_PATH) {
            const { data } = patchBinaryManifest(readEntryBytes(templateApk, entry), {
                packageName: input.applicationId,
                label: input.label,
                versionCode: input.versionCode,
                versionName: input.versionName,
            });
            moduleEntries.push({
                modulePath: bundleModulePath(entry.name),
                source: { kind: "buffer", data: convertBinaryManifestToProto(data) },
            });
            sawManifest = true;
            continue;
        }
        if (entry.name === RESOURCES_ARSC_PATH) {
            const { data } = patchArscPackageName(readEntryBytes(templateApk, entry), input.applicationId);
            moduleEntries.push({
                modulePath: bundleModulePath(entry.name),
                source: { kind: "buffer", data: convertArscToProto(data) },
            });
            sawArsc = true;
            continue;
        }
        if (COMPILED_RES_XML.test(entry.name)) {
            throw new Error(
                `Template resource "${entry.name}" is compiled binary XML; an App Bundle needs proto XML there, `
                + "which this build does not produce",
            );
        }
        if (iconSlots.has(entry.name) && input.iconPngBySlot?.[entry.name]) {
            moduleEntries.push({
                modulePath: bundleModulePath(entry.name),
                source: { kind: "buffer", data: input.iconPngBySlot[entry.name] },
            });
            appliedIconSlots.add(entry.name);
            continue;
        }
        // Everything else - dex, native libraries, the icons we are not
        // overriding, kotlin metadata - passes through byte-identically; only
        // its path changes.
        moduleEntries.push({ modulePath: bundleModulePath(entry.name), source: rawPassthrough(templateApk, entry) });
    }

    if (!sawManifest) {
        throw new Error("Template APK has no AndroidManifest.xml");
    }
    if (!sawArsc) {
        throw new Error("Template APK has no resources.arsc");
    }
    for (const slot of Object.keys(input.iconPngBySlot ?? {})) {
        if (!appliedIconSlots.has(slot)) {
            throw new Error(`Icon slot "${slot}" is not present in the template; the manifest and template disagree`);
        }
    }

    // Inject shell-config.json and the game site. Both already sit under
    // "assets/" per the shell manifest, so bundleModulePath places them
    // without a special case.
    moduleEntries.push({
        modulePath: bundleModulePath(android.shellConfigPath),
        source: { kind: "buffer", data: Buffer.from(input.shellConfigJson, "utf8") },
    });
    const seenWww = new Set<string>();
    for (const file of input.www) {
        assertSafeRelativePath(file.relativePath);
        if (seenWww.has(file.relativePath)) {
            throw new Error(`Duplicate www path: "${file.relativePath}"`);
        }
        seenWww.add(file.relativePath);
        moduleEntries.push({
            modulePath: bundleModulePath(`${wwwRoot}/${file.relativePath}`),
            source: file.source,
        });
    }

    // The targeting side-files describe the module's own layout, so they are
    // derived from the finished path list rather than from the template.
    const modulePaths = moduleEntries.map(entry => entry.modulePath);
    const nativeDirectories = nativeDirectoriesOf(modulePaths);
    const assetDirectories = assetDirectoriesOf(modulePaths);

    const entries: ZipWriteEntry[] = [
        { name: BUNDLE_CONFIG_PATH, source: { kind: "buffer", data: encodeBundleConfig() } },
        ...moduleEntries.map(entry => ({ name: `${BUNDLE_MODULE}/${entry.modulePath}`, source: entry.source })),
    ];
    if (nativeDirectories.length > 0) {
        entries.push({
            name: NATIVE_TARGETING_PATH,
            source: { kind: "buffer", data: encodeNativeLibraries(nativeDirectories) },
        });
    }
    if (assetDirectories.length > 0) {
        entries.push({
            name: ASSETS_TARGETING_PATH,
            source: { kind: "buffer", data: encodeAssets(assetDirectories) },
        });
    }

    // No stored-entry alignment (a bundle is never mmap'd) and no zip64
    // (bundletool reads bundles with java.util.zip, and a bundle past 4 GiB is
    // an error long before it is a format problem).
    const output = new BufferZipOutput();
    await writeZip(output, entries, { mtime: input.mtime, allowZip64: false });
    return output.toBuffer();
}
