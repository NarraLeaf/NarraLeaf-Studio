import type { DevModeCharacterSummary } from "@shared/types/devMode";

/**
 * Map raw character-store entries (`{ profile: ... }`, i.e. `Character.toJSON()` output / the
 * persisted `character.json` shape) to the `DevModeCharacterSummary` shape the story compiler
 * consumes. Defensive against malformed JSON. Shared by the main-process dev-mode bundle
 * assembler and the workspace story preview so the two never drift.
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
            defaultForm?: unknown;
            appearance?: {
                forms?: unknown[];
            };
        };
        const id = typeof raw.id === "string" ? raw.id.trim() : "";
        if (!id) {
            return [];
        }
        // Left empty when unnamed, never substituted with `id`: `id` is a UUID, and every consumer
        // of `name` treats it as display text (the story compiler feeds it straight to the NLR
        // nametag). Naming the fallback is the compiler's job, not this mapper's.
        const name = typeof raw.name === "string" ? raw.name.trim() : "";
        const forms = Array.isArray(raw.appearance?.forms)
            ? raw.appearance.forms.flatMap(formEntry => {
                if (!formEntry || typeof formEntry !== "object") {
                    return [];
                }
                const form = formEntry as {
                    name?: unknown;
                    groups?: unknown[];
                    variantAssets?: Record<string, { data?: { id?: unknown; name?: unknown } }>;
                };
                const formName = typeof form.name === "string" && form.name.trim() ? form.name.trim() : "";
                if (!formName) {
                    return [];
                }
                const groups = Array.isArray(form.groups)
                    ? form.groups.flatMap(groupEntry => {
                        if (!groupEntry || typeof groupEntry !== "object") {
                            return [];
                        }
                        const group = groupEntry as { name?: unknown; defaultVariant?: unknown; variants?: unknown[] };
                        const groupName = typeof group.name === "string" && group.name.trim() ? group.name.trim() : "";
                        if (!groupName) {
                            return [];
                        }
                        const variants = Array.isArray(group.variants)
                            ? group.variants.flatMap(variantEntry => {
                                if (!variantEntry || typeof variantEntry !== "object") {
                                    return [];
                                }
                                const variant = variantEntry as { name?: unknown };
                                const variantName = typeof variant.name === "string" && variant.name.trim() ? variant.name.trim() : "";
                                return variantName ? [{ name: variantName }] : [];
                            })
                            : [];
                        return [{
                            name: groupName,
                            defaultVariant: typeof group.defaultVariant === "string" && group.defaultVariant.trim() ? group.defaultVariant.trim() : null,
                            variants,
                        }];
                    })
                    : [];
                const variantAssets = Object.fromEntries(
                    Object.entries(form.variantAssets ?? {}).flatMap(([variantName, variantData]) => {
                        const asset = variantData?.data;
                        const assetId = typeof asset?.id === "string" && asset.id.trim() ? asset.id.trim() : "";
                        if (!assetId) {
                            return [];
                        }
                        return [[variantName, {
                            assetId,
                            name: typeof asset?.name === "string" ? asset.name : undefined,
                        }]];
                    }),
                );
                return [{ name: formName, groups, variantAssets }];
            })
            : [];
        return [{
            id,
            name,
            defaultForm: typeof raw.defaultForm === "string" && raw.defaultForm.trim() ? raw.defaultForm.trim() : null,
            forms,
        }];
    });
}
