/**
 * Pure model helpers for the game localization service: translation-unit
 * extraction from story documents (in narrative order), derived unit state,
 * and per-locale progress. Kept side-effect free for unit testing.
 * Comments in English per project convention.
 */

import type {
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryScene,
    StoryTextSegment,
} from "@shared/types/story";
import type { LocalizationDocument, LocalizationKeysDocument, LocalizationUnit } from "@shared/types/localization";
import { characterTranslationUnitId, localizationKeyUnitId } from "@shared/types/localization";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { findUIElementSurfaceId } from "@shared/types/ui-editor/frame";
import {
    countSegmentInterpolations,
    isSourceHashStale,
    serializeSegmentSourceText,
} from "@shared/utils/localizationText";

/**
 * One translatable story line, in narrative order. `unitId` is the segment's
 * stable `textId` — the authoring layer never needs manual keys.
 */
export type StoryTranslationRow = {
    unitId: string;
    storyId: string;
    sceneId: string;
    sceneName: string;
    blockId: StoryBlockId;
    role: StoryTextSegment["role"];
    /** Speaking character id for dialogue rows (context for translators). */
    characterId?: string;
    /** Translator-facing source text; interpolations appear as `{n}`. */
    sourceText: string;
    interpolationCount: number;
};

/** Derived display state of a unit against the current source text. */
export type LocalizationUnitState = "untranslated" | "machine" | "translated" | "reviewed" | "stale";

export function deriveUnitState(unit: LocalizationUnit | undefined, sourceText: string): LocalizationUnitState {
    if (!unit || !unit.target) {
        return "untranslated";
    }
    if (isSourceHashStale(unit.sourceHash, sourceText)) {
        return "stale";
    }
    return unit.status === "untranslated" ? "translated" : unit.status;
}

/** Scene ids in narrative order: chapters first (in order), then unassigned scenes. */
export function listScenesInNarrativeOrder(document: StoryDocument): StoryScene[] {
    const ordered: StoryScene[] = [];
    const seen = new Set<string>();
    for (const chapter of document.chapters) {
        for (const sceneId of chapter.sceneIds) {
            const scene = document.scenes[sceneId];
            if (scene && !seen.has(scene.id)) {
                seen.add(scene.id);
                ordered.push(scene);
            }
        }
    }
    for (const scene of Object.values(document.scenes)) {
        if (!seen.has(scene.id)) {
            seen.add(scene.id);
            ordered.push(scene);
        }
    }
    return ordered;
}

type TranslatableSegment = {
    segment: StoryTextSegment;
    characterId?: string;
};

/** Pull the translatable segment out of a block, if any (notes are editor-only). */
function getTranslatableSegment(block: StoryBlock): TranslatableSegment | null {
    if (block.kind !== "nodeAction") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "narration") {
        return { segment: payload.text };
    }
    if (payload.action === "dialogue") {
        return { segment: payload.text, characterId: payload.characterId };
    }
    if (payload.action === "choice") {
        return payload.prompt ? { segment: payload.prompt } : null;
    }
    if (payload.action === "choiceOption") {
        return { segment: payload.text };
    }
    return null;
}

/**
 * Extract every translatable line of a story document in narrative order
 * (chapter order → scene order → depth-first block order). Empty segments
 * (no text and no interpolation) are skipped.
 */
export function extractStoryTranslationRows(document: StoryDocument): StoryTranslationRow[] {
    const rows: StoryTranslationRow[] = [];
    for (const scene of listScenesInNarrativeOrder(document)) {
        const visit = (blockId: StoryBlockId): void => {
            const block = scene.blocks[blockId];
            if (!block) {
                return;
            }
            const translatable = getTranslatableSegment(block);
            if (translatable) {
                const sourceText = serializeSegmentSourceText(translatable.segment);
                if (sourceText.trim() || countSegmentInterpolations(translatable.segment) > 0) {
                    rows.push({
                        unitId: translatable.segment.textId,
                        storyId: document.id,
                        sceneId: scene.id,
                        sceneName: scene.name,
                        blockId: block.id,
                        role: translatable.segment.role,
                        ...(translatable.characterId ? { characterId: translatable.characterId } : {}),
                        sourceText,
                        interpolationCount: countSegmentInterpolations(translatable.segment),
                    });
                }
            }
            for (const childId of block.childrenIds) {
                visit(childId);
            }
        };
        for (const rootId of scene.rootBlockIds) {
            visit(rootId);
        }
    }
    return rows;
}

/** One localizable UI widget text (implicit unit `ui:<elementId>.<prop>`). */
export type UiTranslationRow = {
    unitId: string;
    elementId: string;
    prop: "text" | "label";
    /** Author-facing element name (never the raw element id). */
    elementName: string;
    /** Page (or component) the element lives on, for grouping. */
    groupName: string;
    sourceText: string;
};

const LOCALIZABLE_WIDGETS: Record<string, "text" | "label"> = {
    "nl.text": "text",
    "nl.button": "label",
};

function getLocalizableWidgetText(element: UIElement): { prop: "text" | "label"; sourceText: string } | null {
    const prop = LOCALIZABLE_WIDGETS[element.type];
    if (!prop) {
        return null;
    }
    const props = element.props as Record<string, unknown> | undefined;
    // Named-key references translate through the key registry, not an implicit unit.
    if (!props || props.localizable !== true || (typeof props.localizationKey === "string" && props.localizationKey.trim())) {
        return null;
    }
    const sourceText = props[prop];
    if (typeof sourceText !== "string" || !sourceText.trim()) {
        return null;
    }
    return { prop, sourceText };
}

/** Stable unit id for a widget's localizable text prop (mirrors the runtime resolver). */
export function uiTranslationUnitId(elementId: string, prop: string): string {
    return `ui:${elementId}.${prop}`;
}

/**
 * Collect every opted-in UI widget text: top-level elements grouped by their
 * page, component-definition elements grouped by their component's name.
 */
export function extractUiTranslationRows(document: UIDocument): UiTranslationRow[] {
    const rows: UiTranslationRow[] = [];
    const pushRow = (element: UIElement, groupName: string) => {
        const text = getLocalizableWidgetText(element);
        if (!text) {
            return;
        }
        rows.push({
            unitId: uiTranslationUnitId(element.id, text.prop),
            elementId: element.id,
            prop: text.prop,
            elementName: element.name || element.type,
            groupName,
            sourceText: text.sourceText,
        });
    };
    for (const element of Object.values(document.elements)) {
        const surfaceId = findUIElementSurfaceId(document, element.id);
        const surface = surfaceId ? document.surfaces.find(entry => entry.id === surfaceId) : undefined;
        pushRow(element, surface?.name ?? "");
    }
    for (const component of document.components ?? []) {
        for (const element of Object.values(component.elements)) {
            pushRow(element, component.name || "Component");
        }
    }
    return rows;
}

/** One character display name as a translation row (unit id `char:<id>`). */
export type CharacterTranslationRow = {
    unitId: string;
    characterId: string;
    /** The character's source-language display name (what the nametag renders). */
    sourceText: string;
};

/**
 * Character display names as translation rows, sorted by name for a stable
 * reading order. Characters without a name are skipped — there is nothing
 * to translate and the nametag never renders for them.
 */
export function extractCharacterTranslationRows(
    characters: readonly { id: string; name: string }[],
): CharacterTranslationRow[] {
    return characters
        .filter(character => character.name.trim().length > 0)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(character => ({
            unitId: characterTranslationUnitId(character.id),
            characterId: character.id,
            sourceText: character.name,
        }));
}

/** One named key as a translation row (unit id `key:<name>`). */
export type KeyTranslationRow = {
    unitId: string;
    keyName: string;
    sourceText: string;
    note?: string;
};

export function extractKeyTranslationRows(document: LocalizationKeysDocument): KeyTranslationRow[] {
    return Object.entries(document.keys)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([keyName, definition]) => ({
            unitId: localizationKeyUnitId(keyName),
            keyName,
            sourceText: definition.sourceText,
            ...(definition.note ? { note: definition.note } : {}),
        }));
}

/** The minimal shape progress/state derivation needs; all row kinds satisfy it. */
export type TranslatableUnitRef = {
    unitId: string;
    sourceText: string;
};

export type LocalizationProgress = {
    total: number;
    /** Units with a current (non-stale) translation, any of machine/translated/reviewed. */
    completed: number;
    reviewed: number;
    machine: number;
    stale: number;
    untranslated: number;
};

export function computeLocalizationProgress(
    rows: readonly TranslatableUnitRef[],
    document: LocalizationDocument | undefined,
): LocalizationProgress {
    const progress: LocalizationProgress = {
        total: rows.length,
        completed: 0,
        reviewed: 0,
        machine: 0,
        stale: 0,
        untranslated: 0,
    };
    for (const row of rows) {
        const state = deriveUnitState(document?.units[row.unitId], row.sourceText);
        if (state === "untranslated") {
            progress.untranslated += 1;
        } else if (state === "stale") {
            progress.stale += 1;
        } else {
            progress.completed += 1;
            if (state === "reviewed") {
                progress.reviewed += 1;
            } else if (state === "machine") {
                progress.machine += 1;
            }
        }
    }
    return progress;
}
