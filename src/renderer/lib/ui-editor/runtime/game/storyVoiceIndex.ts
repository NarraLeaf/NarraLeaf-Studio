import type { StoryDocument } from "@shared/types/story";

export type StoryVoiceIndex = {
    rowByUnit: ReadonlyMap<string, string>;
    speakerByUnit: ReadonlyMap<string, string>;
    unitsByScene: ReadonlyMap<string, ReadonlySet<string>>;
};

/** Static voice identities for diagnostics, bus routing and per-scene take tables, in one walk. */
export function indexStoryVoiceUnits(document: StoryDocument): StoryVoiceIndex {
    const rowByUnit = new Map<string, string>();
    const speakerByUnit = new Map<string, string>();
    const unitsByScene = new Map<string, ReadonlySet<string>>();
    for (const scene of Object.values(document.scenes ?? {})) {
        const units = new Set<string>();
        for (const block of Object.values(scene.blocks ?? {})) {
            const payload = block.payload as { text?: { textId?: unknown }; prompt?: { textId?: unknown } } | undefined;
            for (const textId of [payload?.text?.textId, payload?.prompt?.textId]) {
                if (typeof textId === "string" && textId && !rowByUnit.has(textId)) rowByUnit.set(textId, block.id);
            }
            if (block.kind !== "nodeAction") continue;
            if (block.payload.action === "dialogue" || block.payload.action === "narration") {
                const textId = block.payload.text?.textId;
                if (textId) units.add(textId);
                if (block.payload.action === "dialogue") {
                    const characterId = block.payload.characterId?.trim();
                    if (characterId && textId) speakerByUnit.set(textId, characterId);
                }
            }
        }
        unitsByScene.set(scene.id, units);
    }
    return { rowByUnit, speakerByUnit, unitsByScene };
}
