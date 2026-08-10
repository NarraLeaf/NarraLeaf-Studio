/**
 * The App Bundle container's own metadata: the APK-entry → bundle-entry path
 * map plus the three protobuf side-files bundletool expects
 * (BundleConfig.pb, base/native.pb, base/assets.pb). Pure: strings in →
 * Buffers out, no fs and no zip knowledge; buildAab.ts assembles the archive.
 *
 * An .aab is not "an APK with a different extension": every APK entry moves
 * into a module directory (`base/`), the two compiled binaries become protobuf
 * (`base/manifest/AndroidManifest.xml`, `base/resources.pb`), dex moves under
 * `base/dex/`, and everything that is not res/lib/assets/dex is quarantined
 * under `base/root/`. The paths INSIDE the side-files stay module-relative
 * ("lib/arm64-v8a", not "base/lib/arm64-v8a") - the module is the root as far
 * as targeting is concerned.
 *
 * The side-files restate, in protobuf, what could be derived from the entry
 * names. bundletool emits them anyway, and a bundle it would not have produced
 * itself is a bundle nobody has tested Play's ingestion against - so this
 * emits them too, matching bundletool's own output for the shell template
 * byte for byte.
 */

import { encodeMessage } from "./protobufWriter";

/** The single module a Studio bundle ships; splits are not offered. */
export const BUNDLE_MODULE = "base";

/**
 * The bundletool release whose bundle layout this emitter reproduces, written
 * into BundleConfig.pb as its producer. bundletool and Play both read this to
 * decide which bundle-format behaviours to apply; an empty or ancient version
 * silently opts the bundle into legacy handling, so it is pinned to the
 * release the layout was verified against rather than left blank.
 */
export const BUNDLETOOL_FORMAT_VERSION = "1.18.1";

/**
 * android.bundle.Abi.AbiAlias, keyed by the lib/ subdirectory name Android
 * uses for it. A directory outside this table is a template that grew an ABI
 * Studio does not know how to target - a loud failure, because silently
 * dropping it ships a bundle whose native code is missing on those devices.
 */
const ABI_ALIAS_BY_DIRECTORY: Readonly<Record<string, number>> = {
    "armeabi": 1,
    "armeabi-v7a": 2,
    "arm64-v8a": 3,
    "x86": 4,
    "x86_64": 5,
    "mips": 6,
    "mips64": 7,
    "riscv64": 8,
};

const DEX_ENTRY = /^classes\d*\.dex$/;

/**
 * Where an APK entry lives inside the module. Module-relative: the caller
 * prefixes "base/" for the zip, and the targeting side-files use these paths
 * as-is.
 *
 * Injected content needs no special case - the shell manifest puts both the
 * game payload and shell-config.json under "assets/", so they map by the same
 * rule as the template's own entries.
 */
export function bundleModulePath(apkEntryName: string): string {
    if (apkEntryName === "AndroidManifest.xml") {
        return "manifest/AndroidManifest.xml";
    }
    if (apkEntryName === "resources.arsc") {
        return "resources.pb";
    }
    if (DEX_ENTRY.test(apkEntryName)) {
        return `dex/${apkEntryName}`;
    }
    if (apkEntryName.startsWith("res/") || apkEntryName.startsWith("lib/") || apkEntryName.startsWith("assets/")) {
        return apkEntryName;
    }
    // Anything the bundle format has no home for - kotlin metadata, META-INF,
    // stray json - is carried verbatim under root/ and restored to the APK's
    // top level when bundletool builds APKs from the bundle.
    return `root/${apkEntryName}`;
}

/** BundleConfig{ bundletool: Bundletool{ version } }. */
export function encodeBundleConfig(version: string = BUNDLETOOL_FORMAT_VERSION): Buffer {
    // Bundletool.version is field 2, not 1: field 1 is reserved in config.proto.
    return encodeMessage(config => config.message(1, bundletool => bundletool.string(2, version)));
}

/** The distinct `lib/<abi>` directories the module's files live in, in order. */
export function nativeDirectoriesOf(modulePaths: Iterable<string>): string[] {
    const directories: string[] = [];
    const seen = new Set<string>();
    for (const path of modulePaths) {
        if (!path.startsWith("lib/")) {
            continue;
        }
        const segments = path.split("/");
        if (segments.length < 3) {
            throw new Error(`Template has a native library outside an ABI directory: "${path}"`);
        }
        const directory = `${segments[0]}/${segments[1]}`;
        if (!seen.has(directory)) {
            seen.add(directory);
            directories.push(directory);
        }
    }
    return directories;
}

/**
 * Every `assets/` directory that DIRECTLY contains a file, in order.
 *
 * "Directly" is the whole rule, and it is not a simplification: bundletool's
 * AssetsTargetingValidator rejects a bundle whose Assets message names a
 * directory holding only subdirectories - "Targeted directory 'assets/www' is
 * empty" - so declaring intermediates as well is not merely redundant, it
 * fails both `validate` and `build-apks`. A payload laid out as
 * assets/www/js/app.js with nothing directly in assets/www therefore declares
 * assets/www/js and not assets/www.
 */
export function assetDirectoriesOf(modulePaths: Iterable<string>): string[] {
    const directories: string[] = [];
    const seen = new Set<string>();
    for (const path of modulePaths) {
        if (!path.startsWith("assets/")) {
            continue;
        }
        const directory = path.slice(0, path.lastIndexOf("/"));
        if (!seen.has(directory)) {
            seen.add(directory);
            directories.push(directory);
        }
    }
    return directories;
}

/** NativeLibraries{ directory: [ TargetedNativeDirectory{ path, targeting } ] }. */
export function encodeNativeLibraries(directories: readonly string[]): Buffer {
    return encodeMessage(libraries => {
        for (const directory of directories) {
            const abi = directory.slice(directory.indexOf("/") + 1);
            const alias = ABI_ALIAS_BY_DIRECTORY[abi];
            if (alias === undefined) {
                throw new Error(`Template has native libraries for an unknown ABI: "${abi}"`);
            }
            libraries.message(1, targeted => {
                targeted.string(1, directory);
                targeted.message(2, targeting => targeting.message(1, pbAbi => pbAbi.enumValue(1, alias)));
            });
        }
    });
}

/** Assets{ directory: [ TargetedAssetsDirectory{ path, targeting } ] }. */
export function encodeAssets(directories: readonly string[]): Buffer {
    return encodeMessage(assets => {
        for (const directory of directories) {
            assets.message(1, targeted => {
                targeted.string(1, directory);
                // Present but empty: Studio never targets assets by ABI,
                // texture format or language, and bundletool writes the empty
                // submessage rather than omitting the required field.
                targeted.message(2, () => undefined);
            });
        }
    });
}
