import { parseZipIndex, readEntryBytes, readLocalEntryDataSpan, type ZipIndexEntry } from "./zipModel";
import { patchBinaryManifest } from "./axml";
import { patchArscPackageName } from "./arsc";
import { signApkV2 } from "./apkSigningV2";
import { BufferZipOutput, writeZip, type ZipWriteEntry } from "./zipWriter";
import type { AndroidShellTemplate } from "./mobileShellManifest";
import type { SigningIdentity } from "./signingIdentity";

/**
 * Android repack orchestration: turn the prebuilt, unsigned shell APK template
 * plus a game's web payload into an installable, v2-signed APK. Composes every
 * Android primitive — the binary AndroidManifest.xml patch (axml), the
 * resources.arsc package rename (arsc), 4-byte-aligned zip writing (zipWriter),
 * and APK Signature Scheme v2 signing (apkSigningV2).
 *
 * Manifest-driven: the identity placeholders, icon slots and injection roots
 * all come from the shell manifest, so no template internals are hardcoded.
 * AndroidManifest.xml and resources.arsc are read out of the template, patched,
 * and rewritten; every other entry passes through byte-identically (compressed
 * entries are never re-encoded). resources.arsc must ship stored and 4-byte
 * aligned (API 30+), which the writer enforces.
 *
 * Buffer in → signed Buffer out. Large games are bounded by Node's Buffer
 * limit; the manager guards that with a preflight size check (an APK past
 * ~2 GiB, or the 4 GiB Android install ceiling, is a clear error, not a
 * truncated artifact).
 */

const ANDROID_MANIFEST_PATH = "AndroidManifest.xml";
const RESOURCES_ARSC_PATH = "resources.arsc";

export type ApkWwwEntry = {
    /** Path relative to the manifest's wwwRoot (forward slashes, no leading "/"). */
    relativePath: string;
    source: NonNullable<ZipWriteEntry["source"]>;
};

export type RepackApkInput = {
    /** The template APK (release or debug variant, chosen by the manager). */
    templateApk: Buffer;
    android: AndroidShellTemplate;
    /** Final Android package name (already normalized to package-name rules). */
    applicationId: string;
    /** Home-screen label. */
    label: string;
    /** android:versionName — the raw semver. */
    versionName: string;
    /** android:versionCode — the monotonic integer. */
    versionCode: number;
    /** The compiled game site, injected under the manifest's wwwRoot. */
    www: Iterable<ApkWwwEntry>;
    /** Written to the manifest's shellConfigPath verbatim. */
    shellConfigJson: string;
    /** Icon slot (zip entry path) → replacement PNG bytes. */
    iconPngBySlot?: Record<string, Buffer>;
    /** The debug signing identity the APK is signed with. */
    signingIdentity: SigningIdentity;
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

export async function repackApk(input: RepackApkInput): Promise<Buffer> {
    const { android, templateApk } = input;
    const iconSlots = new Set(android.iconSlots);
    const wwwRoot = android.wwwRoot.replace(/^\/+|\/+$/g, "");

    const index = parseZipIndex(templateApk);
    const entries: ZipWriteEntry[] = [];
    const appliedIconSlots = new Set<string>();
    let sawManifest = false;
    let sawArsc = false;

    for (const entry of index.entries) {
        if ((entry.unixMode & 0o170000) === 0o120000) {
            throw new Error(`Template contains a symlink ("${entry.name}"), which the repack does not support`);
        }
        if (entry.isDirectory) {
            entries.push({ name: entry.name, source: null, unixMode: entry.unixMode & 0o777 || 0o755 });
            continue;
        }
        if (entry.name === ANDROID_MANIFEST_PATH) {
            const { data } = patchBinaryManifest(readEntryBytes(templateApk, entry), {
                packageName: input.applicationId,
                label: input.label,
                versionCode: input.versionCode,
                versionName: input.versionName,
            });
            entries.push({ name: entry.name, source: { kind: "buffer", data }, method: "deflate" });
            sawManifest = true;
            continue;
        }
        if (entry.name === RESOURCES_ARSC_PATH) {
            const { data } = patchArscPackageName(readEntryBytes(templateApk, entry), input.applicationId);
            // API 30+ requires resources.arsc stored and 4-byte aligned.
            entries.push({ name: entry.name, source: { kind: "buffer", data }, method: "store", forceAlign: 4 });
            sawArsc = true;
            continue;
        }
        if (iconSlots.has(entry.name) && input.iconPngBySlot?.[entry.name]) {
            entries.push({
                name: entry.name,
                source: { kind: "buffer", data: input.iconPngBySlot[entry.name] },
                method: "store",
            });
            appliedIconSlots.add(entry.name);
            continue;
        }
        // Everything else — dex, other resources, the icons we are not
        // overriding — passes through byte-identically.
        entries.push({ name: entry.name, source: rawPassthrough(templateApk, entry) });
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

    // Inject shell-config.json and the game site.
    entries.push({
        name: android.shellConfigPath,
        source: { kind: "buffer", data: Buffer.from(input.shellConfigJson, "utf8") },
    });
    const seenWww = new Set<string>();
    for (const file of input.www) {
        assertSafeRelativePath(file.relativePath);
        if (seenWww.has(file.relativePath)) {
            throw new Error(`Duplicate www path: "${file.relativePath}"`);
        }
        seenWww.add(file.relativePath);
        entries.push({ name: `${wwwRoot}/${file.relativePath}`, source: file.source });
    }

    // Build the unsigned APK: 4-byte stored-entry alignment (zipalign), no
    // zip64 (Android's installer cannot read it — an oversize APK is an error).
    const output = new BufferZipOutput();
    await writeZip(output, entries, { mtime: input.mtime, alignStoredEntries: 4, allowZip64: false });

    // v2-sign the aligned APK; the signing block preserves entry offsets.
    return signApkV2(output.toBuffer(), input.signingIdentity);
}
