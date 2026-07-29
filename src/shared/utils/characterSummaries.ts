import type {
    CharacterAppearanceSummary,
    CharacterAvatarSummaryEntry,
    DevModeCharacterSummary,
} from "@shared/types/devMode";

function trimmed(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * The avatar table as the compiler needs it: whether a bake exists, and the author's override.
 * The bake *fingerprint* is deliberately dropped — it is the baker's bookkeeping, and shipping it
 * to the runtime would invite someone to compare it there, where the source bytes are long gone.
 */
function mapAvatars(raw: unknown): Record<string, CharacterAvatarSummaryEntry> | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const avatars: Record<string, CharacterAvatarSummaryEntry> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!key || !value || typeof value !== "object") {
            continue;
        }
        const entry = value as { baked?: unknown; overrideAssetId?: unknown };
        const overrideAssetId = trimmed(entry.overrideAssetId) || null;
        const baked = typeof entry.baked === "string" && entry.baked.length > 0;
        if (baked || overrideAssetId) {
            avatars[key] = { ...(baked ? { baked } : {}), ...(overrideAssetId ? { overrideAssetId } : {}) };
        }
    }
    return Object.keys(avatars).length > 0 ? avatars : undefined;
}

/**
 * The resting pose, dropped entirely when nothing is set.
 *
 * All three cleared is the same state as no default at all, so it is not forwarded — a summary that
 * always carried `{motion: null, expression: null, skin: null}` would make every preset-to-puppet
 * comparison downstream have to know that triple means nothing.
 */
function mapPuppetDefaultState(raw: unknown): { motion: string | null; expression: string | null; skin: string | null } | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const entry = raw as { motion?: unknown; expression?: unknown; skin?: unknown };
    const state = {
        motion: trimmed(entry.motion) || null,
        expression: trimmed(entry.expression) || null,
        skin: trimmed(entry.skin) || null,
    };
    return state.motion || state.expression || state.skin ? state : null;
}

function named(entry: unknown): { id: string; name: string } | null {
    const raw = entry as { id?: unknown; name?: unknown } | null;
    const id = trimmed(raw?.id);
    return id ? { id, name: trimmed(raw?.name) } : null;
}

function mapAppearance(appearance: unknown): CharacterAppearanceSummary {
    const kind = (appearance as { kind?: unknown } | null)?.kind;

    if (kind === "puppet") {
        const raw = appearance as {
            assetId?: unknown;
            backend?: unknown;
            entry?: unknown;
            size?: { width?: unknown; height?: unknown } | null;
            options?: unknown;
            defaultState?: unknown;
        };
        const width = Number(raw.size?.width);
        const height = Number(raw.size?.height);
        return {
            kind: "puppet",
            assetId: trimmed(raw.assetId) || null,
            backend: trimmed(raw.backend),
            entry: trimmed(raw.entry) || null,
            size: Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
                ? { width, height }
                : null,
            // Forwarded whole, unvalidated past "is an object": these are the backend's own
            // vocabulary and anything this mapper pruned would be a knob Studio silently ate.
            options: raw.options && typeof raw.options === "object" && !Array.isArray(raw.options)
                ? { ...(raw.options as Record<string, unknown>) }
                : {},
            ...(mapPuppetDefaultState(raw.defaultState) ? { defaultState: mapPuppetDefaultState(raw.defaultState)! } : {}),
        };
    }

    if (kind === "layered") {
        const raw = appearance as {
            canvas?: { width?: unknown; height?: unknown } | null;
            axes?: unknown[];
            layers?: unknown[];
            avatarAxisIds?: unknown;
            avatars?: unknown;
        };
        const avatarAxisIds = (Array.isArray(raw.avatarAxisIds) ? raw.avatarAxisIds : [])
            .map(trimmed)
            .filter(Boolean);
        const avatars = mapAvatars(raw.avatars);
        const width = Number(raw.canvas?.width);
        const height = Number(raw.canvas?.height);
        return {
            kind: "layered",
            canvas: Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
                ? { width, height }
                : null,
            axes: (Array.isArray(raw.axes) ? raw.axes : []).flatMap(entry => {
                const axis = named(entry);
                if (!axis) return [];
                const rawAxis = entry as { tags?: unknown[]; defaultTagId?: unknown };
                const tags = (Array.isArray(rawAxis.tags) ? rawAxis.tags : []).flatMap(tagEntry => {
                    const tag = named(tagEntry);
                    return tag ? [tag] : [];
                });
                const defaultTagId = trimmed(rawAxis.defaultTagId);
                return [{ ...axis, tags, defaultTagId: defaultTagId || null }];
            }),
            layers: (Array.isArray(raw.layers) ? raw.layers : []).flatMap(entry => {
                const layer = named(entry);
                if (!layer) return [];
                const rawLayer = entry as {
                    axisId?: unknown;
                    assetId?: unknown;
                    options?: Record<string, unknown>;
                    hidden?: unknown;
                };
                const options = rawLayer.options && typeof rawLayer.options === "object"
                    ? Object.fromEntries(
                        Object.entries(rawLayer.options).map(([tagId, assetId]) => [tagId, trimmed(assetId) || null]),
                    )
                    : undefined;
                return [{
                    ...layer,
                    axisId: trimmed(rawLayer.axisId) || null,
                    assetId: trimmed(rawLayer.assetId) || null,
                    options,
                    hidden: rawLayer.hidden === true ? true : undefined,
                }];
            }),
            ...(avatarAxisIds.length > 0 ? { avatarAxisIds } : {}),
            ...(avatars ? { avatars } : {}),
        };
    }

    const raw = appearance as { poses?: unknown[]; defaultPoseId?: unknown; avatars?: unknown };
    const poses = (Array.isArray(raw?.poses) ? raw.poses : []).flatMap(entry => {
        const pose = named(entry);
        if (!pose) return [];
        return [{ ...pose, assetId: trimmed((entry as { assetId?: unknown }).assetId) || null }];
    });
    const defaultPoseId = trimmed(raw?.defaultPoseId);
    const presetAvatars = mapAvatars(raw?.avatars);
    return {
        kind: "preset",
        poses,
        defaultPoseId: defaultPoseId && poses.some(pose => pose.id === defaultPoseId)
            ? defaultPoseId
            : poses[0]?.id ?? null,
        ...(presetAvatars ? { avatars: presetAvatars } : {}),
    };
}

/**
 * Map raw character-store entries (`{ profile: ... }`, i.e. `Character.toJSON()` output / the
 * persisted `character.json` shape) to the `DevModeCharacterSummary` shape the story compiler
 * consumes. Defensive against malformed JSON. Shared by the main-process dev-mode bundle
 * assembler and the workspace story preview so the two never drift.
 *
 * A store that predates the appearance rework reaches here only if it was not migrated on load, and
 * maps to an empty preset appearance rather than to a guess — see `migrateAppearance.ts`, which the
 * character service runs first.
 */
export function mapCharacterStoreEntriesToSummaries(entries: readonly unknown[]): DevModeCharacterSummary[] {
    return entries.flatMap((entry): DevModeCharacterSummary[] => {
        if (!entry || typeof entry !== "object") {
            return [];
        }
        const profile = (entry as { profile?: unknown }).profile;
        if (!profile || typeof profile !== "object") {
            return [];
        }
        const raw = profile as {
            id?: unknown;
            name?: unknown;
            appearance?: unknown;
            defaultAvatarAssetId?: unknown;
        };
        const id = trimmed(raw.id);
        if (!id) {
            return [];
        }
        const defaultAvatarAssetId = trimmed(raw.defaultAvatarAssetId);
        // Left empty when unnamed, never substituted with `id`: `id` is a UUID, and every consumer
        // of `name` treats it as display text (the story compiler feeds it straight to the NLR
        // nametag). Naming the fallback is the compiler's job, not this mapper's.
        return [{
            id,
            name: trimmed(raw.name),
            appearance: mapAppearance(raw.appearance),
            ...(defaultAvatarAssetId ? { defaultAvatarAssetId } : {}),
        }];
    });
}
