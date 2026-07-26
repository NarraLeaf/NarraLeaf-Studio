import type { CharacterAppearanceSummary, DevModeCharacterSummary } from "@shared/types/devMode";

function trimmed(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function named(entry: unknown): { id: string; name: string } | null {
    const raw = entry as { id?: unknown; name?: unknown } | null;
    const id = trimmed(raw?.id);
    return id ? { id, name: trimmed(raw?.name) } : null;
}

function mapAppearance(appearance: unknown): CharacterAppearanceSummary {
    const kind = (appearance as { kind?: unknown } | null)?.kind;

    if (kind === "layered") {
        const raw = appearance as {
            canvas?: { width?: unknown; height?: unknown } | null;
            axes?: unknown[];
            layers?: unknown[];
        };
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
        };
    }

    const raw = appearance as { poses?: unknown[]; defaultPoseId?: unknown };
    const poses = (Array.isArray(raw?.poses) ? raw.poses : []).flatMap(entry => {
        const pose = named(entry);
        if (!pose) return [];
        return [{ ...pose, assetId: trimmed((entry as { assetId?: unknown }).assetId) || null }];
    });
    const defaultPoseId = trimmed(raw?.defaultPoseId);
    return {
        kind: "preset",
        poses,
        defaultPoseId: defaultPoseId && poses.some(pose => pose.id === defaultPoseId)
            ? defaultPoseId
            : poses[0]?.id ?? null,
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
        const raw = profile as { id?: unknown; name?: unknown; appearance?: unknown };
        const id = trimmed(raw.id);
        if (!id) {
            return [];
        }
        // Left empty when unnamed, never substituted with `id`: `id` is a UUID, and every consumer
        // of `name` treats it as display text (the story compiler feeds it straight to the NLR
        // nametag). Naming the fallback is the compiler's job, not this mapper's.
        return [{ id, name: trimmed(raw.name), appearance: mapAppearance(raw.appearance) }];
    });
}
