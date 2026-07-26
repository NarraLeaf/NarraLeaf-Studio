import { fnv1aHex } from "@shared/utils/contentHash";

/**
 * The project's app-icon model, shared by the workspace panel that authors it,
 * the build preflight that judges it, and the artifact compiler that ships it.
 *
 * One master image is the source of truth; each build target holds a small
 * recipe describing how that master is fitted for it (how far the artwork is
 * inset from the canvas edge, what colour shows through its transparency) plus
 * an optional override for the rare case where a target genuinely needs
 * different artwork. Authors of most projects supply exactly one file.
 *
 * The recipes are baked into PNGs at authoring time and those PNGs are project
 * content - they travel in the .nlspkg and land in version control - so
 * everything here is written to be byte-stable: see {@link projectIconFingerprint}.
 */

/** A build target that shows an app icon. Every target Studio can build does. */
export type ProjectIconTarget = "macos" | "windows" | "linux" | "android" | "ios" | "web";

export const PROJECT_ICON_TARGETS: readonly ProjectIconTarget[] =
    ["macos", "windows", "linux", "android", "ios", "web"] as const;

/** An image the author supplied, stored under `resources/icons/source/`. */
export type ProjectIconSource = {
    /** Project-relative, forward slashes. */
    path: string;
    /** The file name the author picked it from. Display only. */
    sourceName: string;
    mediaType: string;
    /** Display only - deliberately excluded from the bake fingerprint. */
    updatedAt: string;
};

/** How one target fits the master. Three knobs, and the defaults are correct. */
export type ProjectIconSpec = {
    /** Non-null only when this target needs different artwork from the master. */
    override: ProjectIconSource | null;
    /** Fraction of the canvas edge left empty around the artwork, 0 to {@link MAX_ICON_INSET}. */
    inset: number;
    /** `#RRGGBB` painted under the artwork, or null to keep transparency. */
    background: string | null;
};

/** A baked PNG plus the fingerprint of the inputs that produced it. */
export type ProjectIconBake = {
    /** Project-relative, forward slashes. */
    path: string;
    fingerprint: string;
};

export type ProjectIconSet = {
    version: 2;
    master: ProjectIconSource | null;
    specs: Record<ProjectIconTarget, ProjectIconSpec>;
    /** Keyed by {@link ProjectIconOutputId}. Absent entries have not been baked. */
    baked: Partial<Record<ProjectIconOutputId, ProjectIconBake>>;
};

/**
 * One baked file. Targets are 1:1 with outputs except web, which needs two at
 * fixed sizes because the names are referenced from the generated index.html.
 */
export type ProjectIconOutputId =
    | "macos" | "windows" | "linux" | "android" | "ios"
    | "web-favicon" | "web-apple-touch";

export type ProjectIconOutput = {
    id: ProjectIconOutputId;
    target: ProjectIconTarget;
    /** Edge length of the baked square, in pixels. */
    size: number;
    /** File name under `resources/icons/derived/`. */
    fileName: string;
    /**
     * Alpha is not allowed in this output, so a spec that keeps transparency
     * falls back to {@link DEFAULT_OPAQUE_BACKGROUND}. True for iOS (the App
     * Store rejects icons with an alpha channel) and for apple-touch-icon,
     * which Safari composites onto black when it has one.
     */
    opaque: boolean;
};

/**
 * Desktop and mobile bake at 1024: electron-builder converts a PNG that size
 * into .icns/.ico, and the mobile repack downscales it into whatever slots the
 * shell template declares. The web sizes are the ones browsers actually ask for.
 */
export const PROJECT_ICON_OUTPUTS: readonly ProjectIconOutput[] = [
    { id: "macos", target: "macos", size: 1024, fileName: "macos.png", opaque: false },
    { id: "windows", target: "windows", size: 1024, fileName: "windows.png", opaque: false },
    { id: "linux", target: "linux", size: 1024, fileName: "linux.png", opaque: false },
    { id: "android", target: "android", size: 1024, fileName: "android.png", opaque: false },
    { id: "ios", target: "ios", size: 1024, fileName: "ios.png", opaque: true },
    { id: "web-favicon", target: "web", size: 32, fileName: "web-favicon.png", opaque: false },
    { id: "web-apple-touch", target: "web", size: 180, fileName: "web-apple-touch.png", opaque: true },
] as const;

/** Largest inset the panel offers. Past a quarter of the canvas an icon reads as a dot. */
export const MAX_ICON_INSET = 0.25;

/** What an `opaque` output paints under artwork whose spec kept transparency. */
export const DEFAULT_OPAQUE_BACKGROUND = "#FFFFFF";

/**
 * The recipe a target starts with. These are frozen into the project's specs
 * the first time it bakes rather than being read live, so that a Studio update
 * which retunes them cannot silently change a teammate's baked output.
 *
 * macOS leaves a margin because its icon grid does: Apple's 1024 canvas holds
 * an 824-wide shape. Android leaves a smaller one because launchers mask the
 * legacy `ic_launcher` PNG to a circle or squircle and clip whatever touches
 * the edge. iOS is full-bleed - the system rounds it - but opaque.
 */
export const PROJECT_ICON_TARGET_DEFAULTS: Readonly<Record<ProjectIconTarget, { inset: number; background: string | null }>> = {
    macos: { inset: 0.1, background: null },
    windows: { inset: 0, background: null },
    linux: { inset: 0, background: null },
    android: { inset: 0.08, background: null },
    ios: { inset: 0, background: DEFAULT_OPAQUE_BACKGROUND },
    web: { inset: 0, background: null },
};

/** The five per-platform slots the pre-master model stored. */
export type ProjectIconLegacyPlatform = "macos" | "windows" | "linux" | "android" | "ios";

/**
 * Which legacy slot is promoted to master. Desktop first because that is where
 * an author who only set one icon almost always set it, and because the desktop
 * slots accepted the widest range of source formats.
 */
const LEGACY_PROMOTION_ORDER: readonly ProjectIconLegacyPlatform[] =
    ["windows", "macos", "linux", "android", "ios"] as const;

export function createProjectIconSet(): ProjectIconSet {
    return { version: 2, master: null, specs: defaultSpecs(), baked: {} };
}

/**
 * Read whatever is in `metadata.icons` as a v2 set: a v2 object is normalized
 * field by field, anything else is treated as the legacy five-slot shape and
 * migrated. Never throws - a malformed manifest degrades to "no icon", which
 * the panel and preflight both already handle.
 */
export function normalizeProjectIconSet(value: unknown): ProjectIconSet {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return createProjectIconSet();
    }
    const record = value as Record<string, unknown>;
    return record.version === 2 ? normalizeV2(record) : migrateLegacyIconSet(record);
}

/**
 * Turn the five independent slots into a master plus overrides, preserving what
 * each platform used to ship: every inset stays 0 and every background stays
 * transparent, because that is what the old pipeline did with the raw file.
 * (iOS is the exception - it takes the opaque default, since shipping alpha
 * there was a defect, not a behaviour worth preserving.)
 */
export function migrateLegacyIconSet(value: Record<string, unknown>): ProjectIconSet {
    const configured = new Map<ProjectIconLegacyPlatform, ProjectIconSource>();
    for (const platform of LEGACY_PROMOTION_ORDER) {
        const source = normalizeSource(value[platform]);
        if (source) {
            configured.set(platform, source);
        }
    }

    const masterPlatform = LEGACY_PROMOTION_ORDER.find(platform => configured.has(platform));
    if (!masterPlatform) {
        return createProjectIconSet();
    }

    const specs = defaultSpecs();
    for (const target of PROJECT_ICON_TARGETS) {
        specs[target] = {
            override: null,
            inset: 0,
            background: PROJECT_ICON_TARGET_DEFAULTS[target].background,
        };
    }
    for (const [platform, source] of configured) {
        if (platform !== masterPlatform) {
            specs[platform].override = source;
        }
    }

    return { version: 2, master: configured.get(masterPlatform)!, specs, baked: {} };
}

/** The image a target bakes from: its own override, else the master. */
export function resolveIconSource(set: ProjectIconSet, target: ProjectIconTarget): ProjectIconSource | null {
    return set.specs[target].override ?? set.master;
}

/** The one reader for `metadata.icons`, wherever the config came from. */
export function readProjectIconSet(projectConfig: { metadata?: unknown } | null | undefined): ProjectIconSet {
    const metadata = projectConfig?.metadata;
    return normalizeProjectIconSet(isRecord(metadata) ? metadata.icons : undefined);
}

/**
 * The file a build should ship for an output: the baked PNG when one exists,
 * and otherwise the raw source the author supplied.
 *
 * The fallback is what keeps a project that has never opened the Assets panel -
 * every project that predates this model - building exactly as it did before.
 * Preflight reports the un-baked state separately; it is not the build's job to
 * refuse an icon it can plainly see.
 */
export function resolveIconFile(
    set: ProjectIconSet,
    outputId: ProjectIconOutputId,
): { path: string; baked: boolean } | null {
    const baked = set.baked[outputId];
    if (baked?.path) {
        return { path: baked.path, baked: true };
    }
    const source = resolveIconSource(set, findProjectIconOutput(outputId).target);
    return source ? { path: source.path, baked: false } : null;
}

/** The colour an output paints under the artwork, honouring its alpha rule. */
export function resolveIconBackground(spec: ProjectIconSpec, output: ProjectIconOutput): string | null {
    if (spec.background) {
        return spec.background;
    }
    return output.opaque ? DEFAULT_OPAQUE_BACKGROUND : null;
}

/**
 * Identifies everything that determines an output's bytes: the source content,
 * the recipe, and the output's own geometry. Deliberately excludes timestamps
 * and file names - a fingerprint that moved when `updatedAt` moved would make
 * every project open look like an edit in version control.
 */
export function projectIconFingerprint(input: {
    sourceHash: string;
    spec: ProjectIconSpec;
    output: ProjectIconOutput;
}): string {
    const { sourceHash, spec, output } = input;
    const recipe = [
        output.id,
        output.size,
        output.opaque ? "opaque" : "alpha",
        spec.inset.toFixed(4),
        resolveIconBackground(spec, output) ?? "none",
    ].join("|");
    return `${sourceHash}-${fnv1aHex(recipe)}`;
}

export function findProjectIconOutput(id: ProjectIconOutputId): ProjectIconOutput {
    const output = PROJECT_ICON_OUTPUTS.find(candidate => candidate.id === id);
    if (!output) {
        throw new Error(`Unknown project icon output: ${id}`);
    }
    return output;
}

/** The outputs a target owns, in declaration order. */
export function outputsForTarget(target: ProjectIconTarget): ProjectIconOutput[] {
    return PROJECT_ICON_OUTPUTS.filter(output => output.target === target);
}

function defaultSpecs(): Record<ProjectIconTarget, ProjectIconSpec> {
    const specs = {} as Record<ProjectIconTarget, ProjectIconSpec>;
    for (const target of PROJECT_ICON_TARGETS) {
        const defaults = PROJECT_ICON_TARGET_DEFAULTS[target];
        specs[target] = { override: null, inset: defaults.inset, background: defaults.background };
    }
    return specs;
}

function normalizeV2(record: Record<string, unknown>): ProjectIconSet {
    const rawSpecs = isRecord(record.specs) ? record.specs : {};
    const specs = defaultSpecs();
    for (const target of PROJECT_ICON_TARGETS) {
        const raw = isRecord(rawSpecs[target]) ? rawSpecs[target] as Record<string, unknown> : {};
        specs[target] = {
            override: normalizeSource(raw.override),
            inset: normalizeInset(raw.inset, PROJECT_ICON_TARGET_DEFAULTS[target].inset),
            background: normalizeBackground(raw.background, PROJECT_ICON_TARGET_DEFAULTS[target].background),
        };
    }

    const rawBaked = isRecord(record.baked) ? record.baked : {};
    const baked: ProjectIconSet["baked"] = {};
    for (const output of PROJECT_ICON_OUTPUTS) {
        const raw = isRecord(rawBaked[output.id]) ? rawBaked[output.id] as Record<string, unknown> : null;
        const bakePath = raw && typeof raw.path === "string" ? raw.path.trim() : "";
        const fingerprint = raw && typeof raw.fingerprint === "string" ? raw.fingerprint.trim() : "";
        if (bakePath && fingerprint) {
            baked[output.id] = { path: bakePath, fingerprint };
        }
    }

    return { version: 2, master: normalizeSource(record.master), specs, baked };
}

function normalizeSource(value: unknown): ProjectIconSource | null {
    if (!isRecord(value) || typeof value.path !== "string" || !value.path.trim()) {
        return null;
    }
    const path = value.path.trim().replace(/\\/g, "/");
    return {
        path,
        sourceName: typeof value.sourceName === "string" && value.sourceName ? value.sourceName : basename(path),
        mediaType: typeof value.mediaType === "string" && value.mediaType ? value.mediaType : "application/octet-stream",
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    };
}

function normalizeInset(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    // Rounded to the panel's step so a float artefact cannot re-fingerprint a
    // spec that nobody edited.
    return Math.round(Math.min(Math.max(value, 0), MAX_ICON_INSET) * 100) / 100;
}

function normalizeBackground(value: unknown, fallback: string | null): string | null {
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        return fallback;
    }
    const trimmed = value.trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(trimmed) ? trimmed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function basename(path: string): string {
    const index = path.lastIndexOf("/");
    return index >= 0 ? path.slice(index + 1) : path;
}
