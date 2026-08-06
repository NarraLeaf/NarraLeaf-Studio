import { GAME_BUILD_FORMATS_BY_PLATFORM, type GameBuildPlatform } from "@shared/types/gameBuild";
import { AssetType } from "../../workspace/services/assets/assetTypes";
import type { LintAssetEntry } from "../context";
import type { LintFinding, LintRule } from "../types";

/**
 * `portability` - what breaks when the project moves to another filesystem or ships to another
 * platform. Every rule here is about a machine the author is not sitting at.
 *
 * All three are asset-only and all three read the *file name*, which is the part of an asset that
 * survives the export: the compiler writes `<name>` into the bundle, so a name Windows will not
 * accept is a build that fails on someone else's machine, and two names differing only by case are
 * one file overwriting the other on macOS.
 *
 * Deliberately not here: non-ASCII names. Chinese file names are normal in this product, every
 * filesystem this ships to stores them, and flagging them would be pure noise.
 */

/**
 * The name as it will be written to disk.
 *
 * `name` normally already carries the extension - renaming re-derives `ext` from the name's last dot
 * segment - so `ext` is appended only when it is not already there. Records that predate that rule
 * (or a remote asset whose URL had no filename) are the case the append covers.
 *
 * Deliberately **not** trimmed: surrounding whitespace is one of the things `portability/asset-name`
 * is looking for, and a helper that quietly removed it would make that check unreachable.
 */
export function assetFileName(asset: LintAssetEntry): string {
    const name = asset.name;
    const ext = asset.ext?.trim().replace(/^\./, "");
    if (!ext) {
        return name;
    }
    return name.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? name : `${name}.${ext}`;
}

/** Lower-cased extension, from the record if it has one and from the name if it does not. */
function assetExtension(asset: LintAssetEntry): string {
    const recorded = asset.ext?.trim().replace(/^\./, "");
    if (recorded) {
        return recorded.toLowerCase();
    }
    const name = asset.name.trim();
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Windows forbids these outright; POSIX filesystems accept them, which is how they get authored. */
const UNPORTABLE_CHARACTERS = /[<>:"|?*]/;

/**
 * Reserved DOS device names. Still reserved in Win32 today, still with or without an extension:
 * `CON.png` is as unopenable as `CON`, and the failure is at *create* time - the export writes
 * nothing and the game ships without the file.
 */
const RESERVED_DEVICE_NAMES: ReadonlySet<string> = new Set([
    "con",
    "prn",
    "aux",
    "nul",
    ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

/** Every reason a name is unportable, in one place so the rule body stays a filter. */
export function isUnportableAssetName(fileName: string): boolean {
    if (!fileName) {
        return false;
    }
    for (const character of fileName) {
        const code = character.codePointAt(0) ?? 0;
        if (code <= 0x1f) {
            return true;
        }
    }
    if (UNPORTABLE_CHARACTERS.test(fileName)) {
        return true;
    }
    // Windows silently strips both, so the file that arrives is not the file that was named - and
    // the reference to it, which was not stripped, no longer resolves.
    if (/^\s|\s$/.test(fileName) || fileName.endsWith(".")) {
        return true;
    }
    return RESERVED_DEVICE_NAMES.has(fileName.split(".")[0].toLowerCase());
}

/**
 * Every build platform, read off the shared per-platform format table rather than spelled out again
 * here. That table is a `Record<GameBuildPlatform, ...>`, so the day the union grows the compiler
 * makes someone extend it and this list follows for free; a second hand-written copy would go stale
 * in silence, and for this rule stale means a format that quietly stops being reported on the new
 * platform. The assertion only restores what the `Record` key type already guarantees and
 * `Object.keys` throws away.
 */
const EVERY_BUILD_PLATFORM = Object.keys(GAME_BUILD_FORMATS_BY_PLATFORM) as readonly GameBuildPlatform[];

/**
 * Containers a *selected* build target cannot play, per target.
 *
 * Conservative by construction, because a false positive here tells an author to re-encode a file
 * that plays fine. Two things decide what is on the table:
 *
 *  - **The engine behind each target.** `windows` / `macos` / `linux` are Chromium inside Electron
 *    and `android` is a system WebView, also Chromium; `web` is a browser the author does not
 *    choose, and `ios` is WKWebView, which is Safari's engine with no way to add a codec. Chromium
 *    is *not* a superset of everything here - it ships no Theora decoder either - so the desktop
 *    targets are no longer omitted wholesale the way they were when this table held only Ogg audio
 *    and WebM.
 *  - **A version floor.** This project's floor is iOS 17.4, and its re-encode target is VP9 video
 *    plus Vorbis audio in WebM. A format Safari gained at or below that floor plays for everyone
 *    the project can ship to, and listing it would be the false positive described above.
 *
 * What the floor already removed: `.webm` and `.weba` were on this table until 2026-08 and should
 * not come back. Safari 17.4 (2024-03-05) made WebM "fully supported everywhere" - VP8 *and* VP9 on
 * iOS and iPadOS, where before only VP8 in WebRTC worked - and brought Vorbis to iOS 17.4,
 * iPadOS 17.4 and visionOS 1.1. At a 17.4 floor no selectable target is left that cannot play them.
 * <https://webkit.org/blog/15063/webkit-features-in-safari-17-4/>
 *
 * This table is keyed by **extension, and the extension is not the real criterion**: what plays is
 * the codec inside the container. The same `.mp4` plays when it carries H.264 and comes out as a
 * black rectangle with sound when it carries HEVC - measured, not assumed - and this rule cannot
 * tell those two files apart, because it never opens one. Reading the codecs out of the container
 * and judging on those is a later milestone; until it lands, only containers whose answer holds for
 * every codec anyone actually ships inside them belong here.
 */
const UNPLAYABLE_EXTENSIONS: Readonly<Record<string, readonly GameBuildPlatform[]>> = {
    // Ogg *audio*, all three spellings. Not the codecs: Safari decodes both Vorbis and Opus. The
    // container is what arrived late - WebKit added "Ogg container support for both Opus and Vorbis
    // audio" in Safari 18.4 (2025-03), on macOS 15.4, iOS 18.4, iPadOS 18.4 and visionOS 2.4. That
    // is above this project's iOS 17.4 floor, so a phone sitting at the floor still gets silence,
    // and these stay flagged for the two Safari-engine targets - only those two, since every
    // Chromium target demuxes Ogg fine.
    // <https://webkit.org/blog/16574/webkit-features-in-safari-18-4/>
    ogg: ["web", "ios"],
    oga: ["web", "ios"],
    opus: ["web", "ios"],
    // Ogg *video*: `.ogv`, plus `.ogm` and `.ogx`, three conventional names for one container. These
    // name every platform because the failure is Theora, which neither WebKit nor Chromium decodes.
    // Measured on this repo's Electron 38.8.6 / Chromium 140 against a real ffmpeg-produced sample:
    // the file loads and its Vorbis track plays, while the video track reports 0x0 and never decodes
    // a frame - a desktop build is a black screen with sound, exactly like the Safari one.
    // `canPlayType('video/ogg; codecs="theora"')` answers with the empty string there too.
    ogv: EVERY_BUILD_PLATFORM,
    ogm: EVERY_BUILD_PLATFORM,
    ogx: EVERY_BUILD_PLATFORM,
};

const MEDIA_ASSET_TYPES: ReadonlySet<AssetType> = new Set([AssetType.Audio, AssetType.Video]);

function portabilityFinding(
    ruleId: LintFinding["ruleId"],
    messageKey: LintFinding["messageKey"],
    asset: LintAssetEntry,
    messageParams: Record<string, string | number>,
): LintFinding {
    return {
        ruleId,
        messageKey,
        messageParams,
        location: { kind: "asset", assetId: asset.id, assetName: assetFileName(asset) || asset.id },
        target: { kind: "asset", assetId: asset.id, assetType: asset.type },
    };
}

export const PORTABILITY_LINT_RULES: readonly LintRule[] = [
    {
        id: "portability/asset-name",
        category: "portability",
        defaultSeverity: "warning",
        slug: "portabilityAssetName",
        /** See {@link isUnportableAssetName} for the whole list and why each entry is on it. */
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const asset of ctx.assets) {
                const fileName = assetFileName(asset);
                if (isUnportableAssetName(fileName)) {
                    findings.push(
                        portabilityFinding("portability/asset-name", "lint.rule.portabilityAssetName.message", asset, {
                            asset: fileName,
                        }),
                    );
                }
            }
            return findings;
        },
    },
    {
        id: "portability/case-collision",
        category: "portability",
        defaultSeverity: "error",
        slug: "portabilityCaseCollision",
        /**
         * Names that are one name on Windows and macOS.
         *
         * An error rather than a warning because it is silent and lossy: the export writes both and
         * the second overwrites the first, so the game ships with one of the two files under both
         * authors' expectations. Findings are emitted for every member past the first in library
         * order, each naming that first member - so a group of three reads as two problems against
         * one incumbent, not as three mutual accusations.
         */
        run(ctx) {
            const groups = new Map<string, LintAssetEntry[]>();
            for (const asset of ctx.assets) {
                const fileName = assetFileName(asset);
                if (!fileName.trim()) {
                    continue;
                }
                const key = fileName.toLowerCase();
                const group = groups.get(key);
                if (group) {
                    group.push(asset);
                } else {
                    groups.set(key, [asset]);
                }
            }

            const findings: LintFinding[] = [];
            for (const group of groups.values()) {
                if (group.length < 2) {
                    continue;
                }
                const [first, ...rest] = group;
                for (const asset of rest) {
                    findings.push(
                        portabilityFinding(
                            "portability/case-collision",
                            "lint.rule.portabilityCaseCollision.message",
                            asset,
                            { asset: assetFileName(asset), other: assetFileName(first) },
                        ),
                    );
                }
            }
            return findings;
        },
    },
    {
        id: "portability/media-format",
        category: "portability",
        defaultSeverity: "warning",
        slug: "portabilityMediaFormat",
        /**
         * A media container a *selected* build target cannot play. See {@link UNPLAYABLE_EXTENSIONS}
         * for the table and its justification.
         *
         * The empty-`buildPlatforms` guard is not an optimisation: a project that has never been
         * configured for a build has said nothing about where it ships, and guessing "probably web"
         * would hand an author who only ever builds for Windows a list of files to re-encode for a
         * platform they do not target. Silence is the honest answer to a question nobody asked.
         *
         * One finding per asset, with the affected targets listed in the message rather than one
         * finding per (asset, target): the author's action is the same single re-encode either way,
         * and two identical rows differing only by platform name is a worse report.
         */
        run(ctx) {
            if (ctx.buildPlatforms.length === 0) {
                return [];
            }
            const selected = new Set<GameBuildPlatform>(ctx.buildPlatforms);
            const findings: LintFinding[] = [];
            for (const asset of ctx.assets) {
                if (!MEDIA_ASSET_TYPES.has(asset.type)) {
                    continue;
                }
                const affected = (UNPLAYABLE_EXTENSIONS[assetExtension(asset)] ?? []).filter(platform =>
                    selected.has(platform),
                );
                if (affected.length === 0) {
                    continue;
                }
                findings.push(
                    portabilityFinding(
                        "portability/media-format",
                        "lint.rule.portabilityMediaFormat.message",
                        asset,
                        { asset: assetFileName(asset), platform: affected.join(", ") },
                    ),
                );
            }
            return findings;
        },
    },
];
