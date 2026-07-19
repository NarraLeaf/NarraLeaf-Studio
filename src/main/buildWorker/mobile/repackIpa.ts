import { parseZipIndex, readEntryBytes, readLocalEntryDataSpan, type ZipIndexEntry } from "./zipModel";
import { patchInfoPlist } from "./plist";
import { BufferZipOutput, writeZip, type ZipWriteEntry } from "./zipWriter";
import type { IosShellTemplate } from "./mobileShellManifest";

/**
 * iOS repack orchestration: turn the prebuilt, unsigned shell `.app` template
 * plus a game's web payload into an unsigned `.ipa`. Manifest-driven - every
 * template internal (the `.app` dir name, the executable, the Info.plist and
 * icon locations, the injection roots) comes from the shell manifest, so this
 * hardcodes no template layout and stays valid across template revisions.
 *
 * No signing and no binary-format patching - iOS repack is pure zip re-layout
 * plus a text Info.plist rewrite, which is why v1 works on any host. The
 * output is unsigned: the user re-signs with their own identity to sideload.
 *
 * Buffer in → Buffer out. Large games are bounded by Node's Buffer limit; the
 * manager guards that with a preflight size check (an .ipa past ~2 GiB is a
 * clear error rather than a truncated artifact).
 */

export type IpaWwwEntry = {
    /** Path relative to the app's wwwRoot (forward slashes, no leading "/"). */
    relativePath: string;
    /** Streamed or buffered bytes of the file. */
    source: NonNullable<ZipWriteEntry["source"]>;
};

export type RepackIpaInput = {
    /** The template `.app.zip` (entries prefixed with manifest.appDirName). */
    templateAppZip: Buffer;
    ios: IosShellTemplate;
    /** Product name → `Payload/<productName>.app` (already path-sanitized). */
    appName: string;
    identity: {
        bundleId: string;
        /**
         * CFBundleDisplayName - the name shown under the icon on the home
         * screen. Without it every repacked game would display the shell's
         * placeholder name; the template must carry the placeholder key.
         */
        displayName: string;
        shortVersionString: string;
        bundleVersion: string;
    };
    orientation: "landscape" | "portrait" | "auto";
    /** The compiled game site, injected under the app's wwwRoot. */
    www: Iterable<IpaWwwEntry>;
    /** Written to the app's shellConfigPath verbatim. */
    shellConfigJson: string;
    /** Icon slot (relative to the .app) → replacement PNG bytes. */
    iconPngBySlot?: Record<string, Buffer>;
    /** Fixed timestamp for reproducible output. */
    mtime: Date;
};

function assertSafeRelativePath(relativePath: string): void {
    if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\\")) {
        throw new Error(`Unsafe www path: "${relativePath}"`);
    }
    for (const segment of relativePath.split("/")) {
        // Reject "." / ".." and empty segments - the latter would produce a
        // double slash in the entry name that neither zip readers nor iOS
        // expect.
        if (segment === "." || segment === ".." || segment === "") {
            throw new Error(`Unsafe www path: "${relativePath}"`);
        }
    }
}

/** A raw (already-encoded) passthrough source reading an entry's bytes on demand. */
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

export async function repackIpa(input: RepackIpaInput): Promise<Buffer> {
    const { ios, templateAppZip } = input;
    // The app name becomes a single path segment; a slash or separator would
    // split it into extra directories. The manager passes a sanitized product
    // name, but guard here so a non-UI caller can't corrupt the layout.
    if (!input.appName || /[/\\]/.test(input.appName)) {
        throw new Error(`Invalid app name for the .app directory: "${input.appName}"`);
    }
    const appPrefix = `${ios.appDirName.replace(/\/+$/, "")}/`;
    const payloadPrefix = `Payload/${input.appName}.app/`;
    const iconSlots = new Set(ios.iconSlots);
    const infoPlistPath = "Info.plist";

    const index = parseZipIndex(templateAppZip);
    const entries: ZipWriteEntry[] = [];
    let sawInfoPlist = false;
    let sawExecutable = false;
    const appliedIconSlots = new Set<string>();

    for (const entry of index.entries) {
        if (!entry.name.startsWith(appPrefix)) {
            // A well-formed `ditto --keepParent` archive prefixes everything
            // with the .app dir; anything else means the template drifted.
            if (entry.isDirectory && entry.name === "Payload/") {
                continue;
            }
            throw new Error(`Template entry "${entry.name}" is not under "${appPrefix}"`);
        }
        const intraPath = entry.name.slice(appPrefix.length);
        if (intraPath === "") {
            continue; // the app dir entry itself; re-created under Payload/
        }
        // A symlink would be silently rewritten as a regular file holding the
        // link target (zipWriter only emits regular files and dirs). The
        // minimal shell has none - the template contract forbids them - so a
        // symlink means the template drifted; stop rather than ship a broken
        // app.
        if ((entry.unixMode & 0o170000) === 0o120000) {
            throw new Error(`Template contains a symlink ("${entry.name}"), which the repack does not support`);
        }
        const targetName = `${payloadPrefix}${intraPath}`;

        if (entry.isDirectory) {
            entries.push({ name: targetName, source: null, unixMode: entry.unixMode & 0o777 || 0o755 });
            continue;
        }
        if (intraPath === infoPlistPath) {
            const patched = patchInfoPlist(readEntryBytes(templateAppZip, entry).toString("utf8"), {
                bundleId: input.identity.bundleId,
                displayName: input.identity.displayName,
                shortVersionString: input.identity.shortVersionString,
                bundleVersion: input.identity.bundleVersion,
                orientation: input.orientation,
            });
            entries.push({
                name: targetName,
                source: { kind: "buffer", data: Buffer.from(patched, "utf8") },
                unixMode: entry.unixMode & 0o777 || 0o644,
            });
            sawInfoPlist = true;
            continue;
        }
        if (iconSlots.has(intraPath) && input.iconPngBySlot?.[intraPath]) {
            entries.push({
                name: targetName,
                source: { kind: "buffer", data: input.iconPngBySlot[intraPath] },
                method: "store",
                unixMode: entry.unixMode & 0o777 || 0o644,
            });
            appliedIconSlots.add(intraPath);
            continue;
        }
        // Everything else - the executable, storyboards, icons we are not
        // overriding - passes through byte-identically, preserving its mode
        // bits (the executable's 0755 is what makes the app launchable).
        if (intraPath === ios.executableName) {
            sawExecutable = true;
        }
        entries.push({
            name: targetName,
            source: rawPassthrough(templateAppZip, entry),
            unixMode: entry.unixMode & 0o777 || 0o644,
        });
    }

    if (!sawInfoPlist) {
        throw new Error(`Template has no ${appPrefix}Info.plist`);
    }
    if (!sawExecutable) {
        throw new Error(`Template has no executable "${ios.executableName}" under ${appPrefix}`);
    }
    // A supplied icon override that matched no template entry means the
    // manifest's iconSlots disagree with the template - surface it rather than
    // silently ship the placeholder icon the author tried to replace.
    for (const slot of Object.keys(input.iconPngBySlot ?? {})) {
        if (!appliedIconSlots.has(slot)) {
            throw new Error(`Icon slot "${slot}" is not present in the template; the manifest and template disagree`);
        }
    }

    // Inject shell-config.json and the game site under the app dir.
    entries.push({
        name: `${payloadPrefix}${ios.shellConfigPath}`,
        source: { kind: "buffer", data: Buffer.from(input.shellConfigJson, "utf8") },
    });
    const wwwRoot = ios.wwwRoot.replace(/^\/+|\/+$/g, "");
    const seenWww = new Set<string>();
    for (const file of input.www) {
        assertSafeRelativePath(file.relativePath);
        if (seenWww.has(file.relativePath)) {
            throw new Error(`Duplicate www path: "${file.relativePath}"`);
        }
        seenWww.add(file.relativePath);
        entries.push({
            name: `${payloadPrefix}${wwwRoot}/${file.relativePath}`,
            source: file.source,
        });
    }

    const output = new BufferZipOutput();
    // iOS reads zip64; unlike an APK there is no alignment contract.
    await writeZip(output, entries, { mtime: input.mtime, allowZip64: true });
    return output.toBuffer();
}
