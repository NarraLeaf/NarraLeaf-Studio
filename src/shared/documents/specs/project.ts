import {decodeProjectConfig, NLPROJ_EXT, type ProjectConfigData} from "../../utils/nlproj";
import {buildDocumentDiff, type DocumentChange, type DocumentChangeKind, type DocumentDiff} from "../diff";
import {defineDocumentSpec} from "../registry";
import {change, diffKeyed, fromToParams, previewValue} from "./diffHelpers";
import {isJsonObject, requireDocumentObject, requireOptionalMap} from "./parseHelpers";

/**
 * `<ProjectName>.nlproj` - the project's own settings: what the game is called, what it is built
 * as, what it may reach on the network, and what a player's copy starts from.
 *
 * **The file is msgpack, and the name carries the project's name**, which is why it was the last
 * document in the project with nothing to say about itself. Every reader spelled `JSON.parse` over
 * the bytes before a spec was ever consulted, so a change to any of the settings above reported as
 * `Changed (12488 → 12502)` - a byte count, for a rename. `decode` is what removed that; see
 * `DocumentSpec.decode`.
 *
 * One path, taking the project's own name (`sanitizeProjectFileName` decides its spelling). The
 * fixed `project.json` projects used before the extension existed is not read any more, here or
 * anywhere - see `findProjectConfigFileName`.
 *
 * **Read-side only.** `parse` is a shape gate, not a migration: `ProjectService` owns reading and
 * writing the real thing, normalizes fourteen configuration groups on the way in through
 * normalizers that live in the renderer, and writes msgpack. `serialize` refuses for that reason.
 *
 * A rename is not a modification of this document, it is a different file: the old name is removed
 * and the new one is added. That reads as two rows rather than one, and both of them are honest -
 * whole-document add and remove are exempt from every caveat the comparison surface applies.
 */
export const PROJECT_CONFIG_DOCUMENT_PATH = `<projectName>${NLPROJ_EXT}`;

export const projectConfigSpec = defineDocumentSpec<ProjectConfigData>({
    kind: "project",
    version: 1,
    paths: [PROJECT_CONFIG_DOCUMENT_PATH],
    decode: bytes => decodeProjectConfig(bytes),
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a project configuration");
        // The two fields nothing downstream can do without: the name is the game's, and the
        // identifier is what every build, every save directory and every installed copy is keyed
        // by. A file missing either is not a project configuration.
        if (typeof record.name !== "string") {
            return context.corrupt(`"name" must be a string, got ${describe(record.name)}`);
        }
        if (typeof record.identifier !== "string") {
            return context.corrupt(`"identifier" must be a string, got ${describe(record.identifier)}`);
        }
        requireOptionalMap(record, "metadata", context);
        requireOptionalMap(record, "app", context);
        requireOptionalMap(record, "dependencies", context);

        // Returned as read. No migration runs here - see the note at the top of this module, which
        // is also why `serialize` refuses.
        return record as unknown as ProjectConfigData;
    },
    /** Refused; see the note at the top of this module. */
    serialize: () => {
        throw new Error(
            "The project spec is read-only in this build: `parse` does not run the configuration "
            + "normalizers (they live in the renderer's ProjectService), and the file is msgpack "
            + "rather than JSON text, so serializing would write back a document that was never "
            + "normalized in bytes nothing can open. Use ProjectService to save project settings.",
        );
    },
    summarize: config => ({
        title: typeof config?.name === "string" ? config.name : "",
        counts: [
            {key: "projectLanguages", value: listAt(config, ["app", "localization", "locales"]).length},
            {key: "projectPlugins", value: listAt(config, ["dependencies", "plugins"]).length},
        ],
    }),
    diff: diffProjectConfig,
    // No `merge3`. Two authors who both changed the project's settings are resolved whole, which is
    // the first tier and is the honest answer for a document whose groups are normalized as a unit.
});

/**
 * What each row says. Every key is written out as a literal so the catalogue gate can find it -
 * a key built by concatenation is invisible to that scan and would reach the author as its own
 * dotted path.
 *
 * The group labels name an area of the project the author has a panel for; the leaf labels name
 * the setting inside it. `field` is the last resort, and the groups that fall to it are named in
 * {@link APP_GROUPS}.
 */
const LABEL = {
    name: "documentDiff.project.name",
    identifier: "documentDiff.project.identifier",
    field: "documentDiff.project.field",

    metadata: "documentDiff.project.metadata",
    metaVersion: "documentDiff.project.metaVersion",
    metaDescription: "documentDiff.project.metaDescription",
    metaAuthor: "documentDiff.project.metaAuthor",
    metaEmail: "documentDiff.project.metaEmail",
    metaWebsite: "documentDiff.project.metaWebsite",
    metaCopyright: "documentDiff.project.metaCopyright",
    metaCopyrightText: "documentDiff.project.metaCopyrightText",
    metaResolution: "documentDiff.project.metaResolution",
    metaIcons: "documentDiff.project.metaIcons",

    network: "documentDiff.project.network",
    networkPolicy: "documentDiff.project.networkPolicy",
    networkAllowlist: "documentDiff.project.networkAllowlist",
    networkHttp: "documentDiff.project.networkHttp",
    networkRemoteResource: "documentDiff.project.networkRemoteResource",
    networkRemoteScript: "documentDiff.project.networkRemoteScript",

    localization: "documentDiff.project.localization",
    sourceLocale: "documentDiff.project.sourceLocale",
    locales: "documentDiff.project.locales",

    voice: "documentDiff.project.voice",
    voicedLocales: "documentDiff.project.voicedLocales",
    voiceNaming: "documentDiff.project.voiceNaming",
    voiceCast: "documentDiff.project.voiceCast",
    voiceChoices: "documentDiff.project.voiceChoices",

    vfx: "documentDiff.project.vfx",
    vfxFrameRate: "documentDiff.project.vfxFrameRate",

    security: "documentDiff.project.security",
    encryptAssets: "documentDiff.project.encryptAssets",

    crash: "documentDiff.project.crash",
    crashPolicy: "documentDiff.project.crashPolicy",
    preload: "documentDiff.project.preload",
    preloadBehavior: "documentDiff.project.preloadBehavior",

    assetCompression: "documentDiff.project.assetCompression",
    compressImages: "documentDiff.project.compressImages",
    imageMode: "documentDiff.project.imageMode",
    imageQuality: "documentDiff.project.imageQuality",
    imageWebpQuality: "documentDiff.project.imageWebpQuality",
    imageMaxDimension: "documentDiff.project.imageMaxDimension",
    compressAudio: "documentDiff.project.compressAudio",
    audioMode: "documentDiff.project.audioMode",
    audioQuality: "documentDiff.project.audioQuality",
    audioBitrateKbps: "documentDiff.project.audioBitrateKbps",
    audioSampleRateHz: "documentDiff.project.audioSampleRateHz",
    compressVideo: "documentDiff.project.compressVideo",
    videoMode: "documentDiff.project.videoMode",
    videoQuality: "documentDiff.project.videoQuality",
    videoCrf: "documentDiff.project.videoCrf",
    videoMaxHeight: "documentDiff.project.videoMaxHeight",

    mobile: "documentDiff.project.mobile",
    mobileOrientation: "documentDiff.project.mobileOrientation",
    mobileFit: "documentDiff.project.mobileFit",
    mobileCropX: "documentDiff.project.mobileCropX",
    mobileCropY: "documentDiff.project.mobileCropY",

    autoSave: "documentDiff.project.autoSave",
    autoSaveEnabled: "documentDiff.project.autoSaveEnabled",
    autoSaveInterval: "documentDiff.project.autoSaveInterval",
    autoSaveSlots: "documentDiff.project.autoSaveSlots",

    saveCompatibility: "documentDiff.project.saveCompatibility",
    saveCompatible: "documentDiff.project.saveCompatible",
    saveIncompatible: "documentDiff.project.saveIncompatible",

    saveLocation: "documentDiff.project.saveLocation",
    saveLocationWindowsLinux: "documentDiff.project.saveLocationWindowsLinux",
    saveLocationMacos: "documentDiff.project.saveLocationMacos",

    languageChange: "documentDiff.project.languageChange",
    languageChangeInGame: "documentDiff.project.languageChangeInGame",

    preferences: "documentDiff.project.preferences",
    prefTextSpeed: "documentDiff.project.prefTextSpeed",
    prefGameSpeed: "documentDiff.project.prefGameSpeed",
    prefAutoForward: "documentDiff.project.prefAutoForward",
    prefAutoForwardDelay: "documentDiff.project.prefAutoForwardDelay",
    prefShowDialog: "documentDiff.project.prefShowDialog",
    prefSkip: "documentDiff.project.prefSkip",
    prefSkipReadText: "documentDiff.project.prefSkipReadText",
    prefSkipDelay: "documentDiff.project.prefSkipDelay",
    prefSkipInterval: "documentDiff.project.prefSkipInterval",
    prefGlobalVolume: "documentDiff.project.prefGlobalVolume",
    prefBgmVolume: "documentDiff.project.prefBgmVolume",
    prefSoundVolume: "documentDiff.project.prefSoundVolume",
    prefVoiceVolume: "documentDiff.project.prefVoiceVolume",
    prefVoiceEndMode: "documentDiff.project.prefVoiceEndMode",
    prefVoiceFadeDuration: "documentDiff.project.prefVoiceFadeDuration",

    dialogue: "documentDiff.project.dialogue",
    dialogueAutoForwardPause: "documentDiff.project.dialogueAutoForwardPause",
    dialogueTextReveal: "documentDiff.project.dialogueTextReveal",

    distribution: "documentDiff.project.distribution",
    signing: "documentDiff.project.signing",
    build: "documentDiff.project.build",
    patch: "documentDiff.project.patch",
    linting: "documentDiff.project.linting",

    dependencies: "documentDiff.project.dependencies",
    dependencyPlugins: "documentDiff.project.dependencyPlugins",
} as const;

/** A group of settings, and what each of its leaves is called. */
interface ConfigGroup {
    readonly label: string;
    /** Leaf field to label key. A field absent from here falls to {@link LABEL.field}. */
    readonly fields: Readonly<Record<string, string>>;
}

/** `metadata` - what the project says about itself, most of it printed into the shipped binaries. */
const METADATA_GROUP: ConfigGroup = {
    label: LABEL.metadata,
    fields: {
        version: LABEL.metaVersion,
        description: LABEL.metaDescription,
        author: LABEL.metaAuthor,
        email: LABEL.metaEmail,
        website: LABEL.metaWebsite,
        copyright: LABEL.metaCopyright,
        copyrightText: LABEL.metaCopyrightText,
        resolution: LABEL.metaResolution,
        icons: LABEL.metaIcons,
        // `license` and `licenseString` are deliberately absent: nothing in Studio reads or writes
        // them any more, and they fall to the `{field}` row, which is the right size for a value
        // only a hand-edited file still carries.
    },
};

/** `dependencies` - the plugin table, which is machine-managed and moves on its own. */
const DEPENDENCIES_GROUP: ConfigGroup = {
    label: LABEL.dependencies,
    fields: {plugins: LABEL.dependencyPlugins},
};

/**
 * The groups of `app`, in the order an author meets them, and what is inside each.
 *
 * Five of them - `distribution`, `signing`, `build`, `patch`, `linting` - carry no leaf labels on
 * purpose. Four are the remembered state of a dialog (the last build, the last patch export, the
 * credential ids, the rule severities) and one is a key the author never types; a row naming the
 * area plus the raw field is the whole of what is worth saying about them, and inventing author
 * copy for `failBuildOn` would claim more than the surface can show.
 */
const APP_GROUPS: ReadonlyMap<string, ConfigGroup> = new Map<string, ConfigGroup>([
    ["network", {
        label: LABEL.network,
        fields: {
            policy: LABEL.networkPolicy,
            allowlist: LABEL.networkAllowlist,
            allowHttp: LABEL.networkHttp,
            allowRemoteResource: LABEL.networkRemoteResource,
            allowRemoteScript: LABEL.networkRemoteScript,
        },
    }],
    ["localization", {
        label: LABEL.localization,
        fields: {sourceLocale: LABEL.sourceLocale, locales: LABEL.locales},
    }],
    ["voice", {
        label: LABEL.voice,
        fields: {
            voicedLocales: LABEL.voicedLocales,
            namingPattern: LABEL.voiceNaming,
            cast: LABEL.voiceCast,
            voiceChoices: LABEL.voiceChoices,
        },
    }],
    ["dialogue", {
        label: LABEL.dialogue,
        fields: {
            autoForwardDefaultPause: LABEL.dialogueAutoForwardPause,
            textRevealDuration: LABEL.dialogueTextReveal,
        },
    }],
    ["preferences", {
        label: LABEL.preferences,
        fields: {
            cps: LABEL.prefTextSpeed,
            gameSpeed: LABEL.prefGameSpeed,
            autoForward: LABEL.prefAutoForward,
            autoForwardDelay: LABEL.prefAutoForwardDelay,
            showDialog: LABEL.prefShowDialog,
            skip: LABEL.prefSkip,
            skipReadText: LABEL.prefSkipReadText,
            skipDelay: LABEL.prefSkipDelay,
            skipInterval: LABEL.prefSkipInterval,
            globalVolume: LABEL.prefGlobalVolume,
            bgmVolume: LABEL.prefBgmVolume,
            soundVolume: LABEL.prefSoundVolume,
            voiceVolume: LABEL.prefVoiceVolume,
            voiceEndMode: LABEL.prefVoiceEndMode,
            voiceFadeDuration: LABEL.prefVoiceFadeDuration,
        },
    }],
    ["autoSave", {
        label: LABEL.autoSave,
        fields: {
            enabled: LABEL.autoSaveEnabled,
            intervalSeconds: LABEL.autoSaveInterval,
            slots: LABEL.autoSaveSlots,
        },
    }],
    ["saveCompatibility", {
        label: LABEL.saveCompatibility,
        fields: {compatible: LABEL.saveCompatible, incompatible: LABEL.saveIncompatible},
    }],
    ["saveLocation", {
        label: LABEL.saveLocation,
        fields: {windowsLinux: LABEL.saveLocationWindowsLinux, macos: LABEL.saveLocationMacos},
    }],
    ["languageChange", {
        label: LABEL.languageChange,
        fields: {inGame: LABEL.languageChangeInGame},
    }],
    ["security", {label: LABEL.security, fields: {encryptAssets: LABEL.encryptAssets}}],
    ["crash", {label: LABEL.crash, fields: {policy: LABEL.crashPolicy}}],
    ["preload", {label: LABEL.preload, fields: {behavior: LABEL.preloadBehavior}}],
    ["assetCompression", {
        label: LABEL.assetCompression,
        fields: {
            compressImages: LABEL.compressImages,
            imageMode: LABEL.imageMode,
            imageQuality: LABEL.imageQuality,
            imageWebpQuality: LABEL.imageWebpQuality,
            imageMaxDimension: LABEL.imageMaxDimension,
            compressAudio: LABEL.compressAudio,
            audioMode: LABEL.audioMode,
            audioQuality: LABEL.audioQuality,
            audioBitrateKbps: LABEL.audioBitrateKbps,
            audioSampleRateHz: LABEL.audioSampleRateHz,
            compressVideo: LABEL.compressVideo,
            videoMode: LABEL.videoMode,
            videoQuality: LABEL.videoQuality,
            videoCrf: LABEL.videoCrf,
            videoMaxHeight: LABEL.videoMaxHeight,
        },
    }],
    ["vfx", {label: LABEL.vfx, fields: {frameRate: LABEL.vfxFrameRate}}],
    ["mobile", {
        label: LABEL.mobile,
        fields: {
            orientation: LABEL.mobileOrientation,
            fit: LABEL.mobileFit,
            cropAnchorX: LABEL.mobileCropX,
            cropAnchorY: LABEL.mobileCropY,
        },
    }],
    ["distribution", {label: LABEL.distribution, fields: {}}],
    ["signing", {label: LABEL.signing, fields: {}}],
    ["build", {label: LABEL.build, fields: {}}],
    ["patch", {label: LABEL.patch, fields: {}}],
    ["linting", {label: LABEL.linting, fields: {}}],
]);

/**
 * One row per settings group, one child per leaf that changed, and the two values on the child.
 *
 * A keyed walk rather than the structural tier's positional one, for the reason every spec here
 * exists: the structural walk over this file names JSON properties (`app.saveCompatibility.
 * incompatible`), and this file is precisely the one an author never opens - the settings inside it
 * are reached through fourteen different panels and are known by the words those panels use.
 *
 * Depth stops at the leaf. A group's leaf may itself be a list or a table (the language list, the
 * voice cast), and it is reported as one changed row rather than walked further: the panels above
 * them are edited as a whole, and a per-entry account would be a second, weaker copy of the
 * localization and voice documents' own comparisons.
 */
export function diffProjectConfig(
    base: ProjectConfigData,
    head: ProjectConfigData,
    options: {limit: number},
): DocumentDiff {
    const identity: DocumentChange[] = [];
    const groups: DocumentChange[] = [];
    const unknown: DocumentChange[] = [];

    const baseRecord = asRecord(base);
    const headRecord = asRecord(head);

    for (const entry of diffKeyed(baseRecord, headRecord)) {
        switch (entry.key) {
            case "name":
                identity.push(change(["name"], entry.kind, LABEL.name, {params: leafParams(entry.base, entry.head)}));
                break;
            case "identifier":
                identity.push(change(["identifier"], entry.kind, LABEL.identifier, {
                    params: leafParams(entry.base, entry.head),
                }));
                break;
            case "metadata":
                groups.push(groupRow(["metadata"], METADATA_GROUP, entry.kind, entry.base, entry.head));
                break;
            case "dependencies":
                groups.push(groupRow(["dependencies"], DEPENDENCIES_GROUP, entry.kind, entry.base, entry.head));
                break;
            case "app":
                groups.push(...appRows(entry.base, entry.head));
                break;
            default:
                unknown.push(change([entry.key], entry.kind, LABEL.field, {
                    params: {field: entry.key, ...leafParams(entry.base, entry.head)},
                }));
        }
    }

    // Ordered before the budget is applied, which is what the contract asks of a spec that may
    // exceed it: identity first, then the settings groups in the order `APP_GROUPS` declares, then
    // anything a newer Studio wrote that this build has no word for.
    return buildDocumentDiff([...identity, ...groups, ...unknown], {tier: "semantic", limit: options.limit});
}

/** The `app` groups that changed, declared order first and anything unrecognised after it. */
function appRows(base: unknown, head: unknown): DocumentChange[] {
    const entries = diffKeyed(asRecord(base), asRecord(head));
    const known: DocumentChange[] = [];
    const rest: DocumentChange[] = [];

    const order = [...APP_GROUPS.keys()];
    const byOrder = entries
        .filter(entry => APP_GROUPS.has(entry.key))
        .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

    for (const entry of byOrder) {
        known.push(groupRow(["app", entry.key], APP_GROUPS.get(entry.key)!, entry.kind, entry.base, entry.head));
    }
    for (const entry of entries.filter(candidate => !APP_GROUPS.has(candidate.key))) {
        rest.push(groupRow(["app", entry.key], {label: LABEL.field, fields: {}}, entry.kind, entry.base, entry.head, entry.key));
    }
    return [...known, ...rest];
}

/**
 * One group's row and its children.
 *
 * A group that arrived or went away keeps its own marker and still lists what is inside it, so
 * "network settings added" is not a row the author has to open the file to understand.
 */
function groupRow(
    path: readonly string[],
    group: ConfigGroup,
    kind: DocumentChangeKind,
    base: unknown,
    head: unknown,
    fieldName?: string,
): DocumentChange {
    const children: DocumentChange[] = [];
    for (const leaf of diffKeyed(asRecord(base), asRecord(head))) {
        const label = group.fields[leaf.key];
        children.push(change([...path, leaf.key], leaf.kind, label ?? LABEL.field, {
            params: {
                ...(label ? {} : {field: leaf.key}),
                ...leafParams(leaf.base, leaf.head),
            },
        }));
    }

    // A group whose value is not an object at all (a `null` written by hand, a scalar from a newer
    // Studio) produces no children, and the group row alone still reports that it changed.
    return change(path, kind, group.label, {
        ...(fieldName ? {params: {field: fieldName}} : {}),
        children,
    });
}

/**
 * The two values a leaf row carries.
 *
 * A window size is a pair of numbers in one object and reads as `1920×1080`; a list of scalars reads
 * as its items. Everything else falls to the shared preview, which answers nothing for a container -
 * a row with no values still says which setting moved, which is the point.
 */
function leafParams(base: unknown, head: unknown): Record<string, string | number> {
    return fromToParams(flatten(base), flatten(head));
}

function flatten(value: unknown): unknown {
    if (isResolution(value)) {
        return `${value.width}×${value.height}`;
    }
    if (Array.isArray(value)) {
        const items = value.map(previewValue);
        return items.every(item => item !== undefined) ? items.join(", ") : undefined;
    }
    return value;
}

function isResolution(value: unknown): value is {width: number; height: number} {
    return isJsonObject(value)
        && typeof value.width === "number"
        && typeof value.height === "number"
        && Object.keys(value).length === 2;
}

/** A value as a keyed collection, or an empty one - `diffKeyed` is total and this keeps it so. */
function asRecord(value: unknown): Record<string, unknown> {
    return isJsonObject(value) ? value : {};
}

/** The list at a path inside the configuration, or an empty one. Used by `summarize`, which may be handed `{}`. */
function listAt(value: unknown, path: readonly string[]): readonly unknown[] {
    let current: unknown = value;
    for (const key of path) {
        if (!isJsonObject(current)) {
            return [];
        }
        current = current[key];
    }
    return Array.isArray(current) ? current : [];
}

function describe(value: unknown): string {
    if (value === null) {
        return "null";
    }
    return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}
