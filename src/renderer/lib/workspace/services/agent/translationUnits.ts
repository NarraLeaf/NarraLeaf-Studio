/**
 * Every translatable unit and every voiceable line of a project, as the translation and voice tools
 * hand them to an agent.
 *
 * One unit id runs through the whole project - a story line's `textId` is its translation unit and
 * its voice line, a widget's words are `ui:<element>.<prop>`, a named key is `key:<name>` - so the
 * rows here are read with the same extractors the Localization panel's export and the voice table
 * read with (`localizationModel`, `voiceModel`). What is added is what an agent cannot see from the
 * table: where each unit is (scene and row, page and element) in words, which origin it belongs to,
 * and, for a voice line, the file name the recording rule expects for it.
 *
 * The collection is rebuilt per call rather than cached. A 20 000-line game is a few hundred
 * milliseconds of extraction, and a cache would be one more thing that can disagree with the
 * document the author is editing while the agent works.
 *
 * Comments in English per project convention.
 */

import { listSceneBlocksInDocumentOrder, type StoryDocument, type StoryRichRun } from "@shared/types/story";
import type { StoryTextSegment } from "@shared/types/story";
import { formatVoiceFilename, matchKeyForFilename } from "@shared/utils/voiceNaming";
import {
    validateMarkupParity,
    validatePlaceholderParity,
} from "@shared/utils/localizationText";
import { i18nStore, translate } from "@/lib/i18n";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { Services, type WorkspaceContext } from "../services";
import type { CharacterService } from "../core/CharacterService";
import type { LocalizationService } from "../localization/LocalizationService";
import type { VoiceService } from "../voice/VoiceService";
import type { UIDocumentService } from "../ui-editor/UIDocumentService";
import type { LocalBlueprintService } from "../ui-editor/LocalBlueprintService";
import {
    extractCharacterTranslationRows,
    extractEndingTranslationRows,
    extractKeyTranslationRows,
    extractRenameTranslationRows,
    extractSceneTranslationRows,
    extractUiTranslationRows,
    type StoryTranslationRow,
} from "../localization/localizationModel";
import { listPluginWordsRows } from "../localization/pluginWords";
import { describeLocalizationKeyContext, indexLocalizationKeyUses } from "../localization/localizationKeyUses";
import { withSceneIndices } from "../voice/voiceScript";
import { refuse } from "./agentCall";
import { storyService } from "./agentLookups";

/** The part of the game a unit belongs to - the split `localization_status` counts by. */
export const AGENT_UNIT_ORIGINS = ["story", "names", "interface", "keys", "plugins"] as const;
export type AgentUnitOrigin = (typeof AGENT_UNIT_ORIGINS)[number];

export type AgentUnitKind =
    | "dialogue"
    | "narration"
    | "choice"
    | "prompt"
    | "character"
    | "scene"
    | "ending"
    | "rename"
    | "ui"
    | "key"
    | "plugin";

/** One translatable unit, with everything a list row or a write check needs. */
export type AgentTranslationUnit = {
    unitId: string;
    origin: AgentUnitOrigin;
    kind: AgentUnitKind;
    /** What a translation is hashed against: interpolations as `{n}`, styling invisible. */
    sourceText: string;
    /** What the agent is shown and asked to reproduce: the source with its run tags, when it has any. */
    shownSource: string;
    /** Where a player meets it, in words: "Opening, row 12", "Title › Start button", "key menu.start". */
    where: string;
    storyId?: string;
    sceneId?: string;
    sceneName?: string;
    /** 1-based row in the scene, counted as `playtest_start {row}` counts them. */
    row?: number;
    /** Dialogue: the speaking character's name. */
    speaker?: string;
    /** Interface: the page or component the words are on. */
    group?: string;
    /** A key's own note for translators, or where it is used. */
    context?: string;
    /** Story lines: how many `{n}` values the source interpolates. */
    interpolationCount: number;
    /** Story lines with styling: the runs a `‹n›` tag in a translation names. */
    sourceRuns?: StoryRichRun[];
};

function storyKind(row: StoryTranslationRow): AgentUnitKind {
    switch (row.role) {
        case "dialogue":
            return "dialogue";
        case "choiceText":
            return "choice";
        case "choicePrompt":
            return "prompt";
        default:
            return "narration";
    }
}

/** Block id → 1-based row of a scene, in the order `playtest_start` counts rows. */
function rowIndex(document: StoryDocument): Map<string, Map<string, number>> {
    const index = new Map<string, Map<string, number>>();
    for (const scene of Object.values(document.scenes)) {
        const rows = new Map<string, number>();
        listSceneBlocksInDocumentOrder(scene).forEach((block, position) => rows.set(block.id, position + 1));
        index.set(scene.id, rows);
    }
    return index;
}

function characterNames(ctx: WorkspaceContext): { id: string; name: string }[] {
    try {
        return ctx.services.get<CharacterService>(Services.Character).listCharacter().map(character => ({
            id: character.profile.getId(),
            name: character.profile.getName(),
        }));
    } catch {
        return [];
    }
}

function readBlueprintDocument(ctx: WorkspaceContext): BlueprintDocument | null {
    try {
        return ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint).getBlueprintDocument() ?? null;
    } catch {
        return null;
    }
}

/** Every story document of the project, in library order. A story that will not load is skipped. */
async function loadStories(ctx: WorkspaceContext): Promise<StoryDocument[]> {
    const service = storyService(ctx);
    const documents: StoryDocument[] = [];
    for (const entry of service.listStories()) {
        try {
            documents.push(await service.loadStory(entry.id));
        } catch {
            // A broken story must not take the whole listing down; lint reports it.
        }
    }
    return documents;
}

/**
 * Every translatable unit of the project, in the order a translator reads them: character names,
 * then each story's scene, ending and `/rename` names and its lines in narrative order, then the
 * interface's own words, plugins' words, and named keys - the order the panel's export writes.
 */
export async function collectAgentTranslationUnits(ctx: WorkspaceContext): Promise<AgentTranslationUnit[]> {
    const localization = ctx.services.get<LocalizationService>(Services.Localization);
    const units: AgentTranslationUnit[] = [];
    const characters = characterNames(ctx);
    const nameOf = new Map(characters.map(character => [character.id, character.name]));

    for (const row of extractCharacterTranslationRows(characters)) {
        units.push({
            unitId: row.unitId,
            origin: "names",
            kind: "character",
            sourceText: row.sourceText,
            shownSource: row.sourceText,
            where: "character name",
            interpolationCount: 0,
        });
    }

    const stories = await loadStories(ctx);
    const manyStories = stories.length > 1;
    for (const document of stories) {
        const prefix = manyStories ? `${document.name} / ` : "";
        for (const row of extractSceneTranslationRows(document)) {
            units.push({
                unitId: row.unitId,
                origin: "names",
                kind: "scene",
                sourceText: row.sourceText,
                shownSource: row.sourceText,
                where: `${prefix}scene name`,
                storyId: document.id,
                sceneId: row.sceneId,
                sceneName: row.sourceText,
                interpolationCount: 0,
            });
        }
        const rows = rowIndex(document);
        for (const row of extractEndingTranslationRows(document)) {
            units.push({
                unitId: row.unitId,
                origin: "names",
                kind: "ending",
                sourceText: row.sourceText,
                shownSource: row.sourceText,
                where: `${prefix}${row.sceneName}, ending name`,
                storyId: document.id,
                sceneId: row.sceneId,
                sceneName: row.sceneName,
                interpolationCount: 0,
            });
        }
        for (const row of extractRenameTranslationRows(document, characters)) {
            units.push({
                unitId: row.unitId,
                origin: "names",
                kind: "rename",
                sourceText: row.sourceText,
                shownSource: row.sourceText,
                where: `${prefix}${row.sceneName}, /rename${row.characterId && nameOf.get(row.characterId) ? ` of ${nameOf.get(row.characterId)}` : ""}`,
                storyId: document.id,
                sceneId: row.sceneId,
                sceneName: row.sceneName,
                interpolationCount: 0,
            });
        }
        for (const row of localization.extractRows(document)) {
            const position = rows.get(row.sceneId)?.get(row.blockId);
            units.push({
                unitId: row.unitId,
                origin: "story",
                kind: storyKind(row),
                sourceText: row.sourceText,
                shownSource: row.sourceMarkup ?? row.sourceText,
                where: `${prefix}${row.sceneName}${position ? `, row ${position}` : ""}`,
                storyId: document.id,
                sceneId: row.sceneId,
                sceneName: row.sceneName,
                ...(position ? { row: position } : {}),
                ...(row.role === "dialogue" && row.characterId && nameOf.get(row.characterId) ? { speaker: nameOf.get(row.characterId) } : {}),
                interpolationCount: row.interpolationCount,
                ...(row.sourceRuns ? { sourceRuns: row.sourceRuns } : {}),
            });
        }
    }

    let uiDocument = null;
    try {
        uiDocument = ctx.services.get<UIDocumentService>(Services.UIDocument).getDocument();
    } catch {
        uiDocument = null;
    }
    if (uiDocument) {
        for (const row of extractUiTranslationRows(uiDocument, { locale: i18nStore.getLocale() })) {
            units.push({
                unitId: row.unitId,
                origin: "interface",
                kind: "ui",
                sourceText: row.sourceText,
                shownSource: row.sourceText,
                where: row.groupName ? `${row.groupName} › ${row.elementName}` : row.elementName,
                group: row.groupName,
                interpolationCount: 0,
            });
        }
    }

    for (const row of listPluginWordsRows()) {
        units.push({
            unitId: row.unitId,
            origin: "plugins",
            kind: "plugin",
            sourceText: row.sourceText,
            shownSource: row.sourceText,
            where: row.context ? `${row.pluginName} › ${row.context}` : row.pluginName,
            group: row.pluginName,
            interpolationCount: 0,
        });
    }

    const keys = localization.getKeysIfLoaded() ?? await localization.loadKeys().catch(() => undefined);
    if (keys) {
        const uses = indexLocalizationKeyUses({
            uiDocument: uiDocument ?? null,
            blueprintDocument: readBlueprintDocument(ctx),
            widgetName: element => widgetModuleRegistry.get(element.type)?.displayName || element.type,
        });
        for (const row of extractKeyTranslationRows(keys)) {
            units.push({
                unitId: row.unitId,
                origin: "keys",
                kind: "key",
                sourceText: row.sourceText,
                shownSource: row.sourceText,
                where: describeLocalizationKeyContext(row.keyName, uses.get(row.keyName)),
                ...(row.note ? { context: row.note } : {}),
                interpolationCount: 0,
            });
        }
    }
    return units;
}

// ── Checking a translation against its source ───────────────────────────────────────────────────

/** A `{name}` placeholder a key or a widget's words may carry (`Get Text` / `Format Text` fill them). */
const NAMED_PLACEHOLDER = /\{([A-Za-z_][\w.]*)\}/g;
const LINE_BREAK = /\n/g;

function namedPlaceholders(text: string): Set<string> {
    const names = new Set<string>();
    for (const match of text.matchAll(NAMED_PLACEHOLDER)) {
        names.add(match[1]);
    }
    return names;
}

/**
 * What in a translation does not carry what its source carries: `{n}` values, `‹n›` run tags,
 * `{name}` placeholders and line breaks. Warnings, never refusals - the panel's own check
 * (`localization/markup`) treats every one of them as something a translator may mean, and a line
 * that renders without an emphasis still renders.
 */
export function translationWarnings(unit: AgentTranslationUnit, target: string): string[] {
    if (!target) {
        return [];
    }
    const warnings: string[] = [];
    if (unit.interpolationCount > 0 || /\{\d+\}/.test(target)) {
        for (const issue of validatePlaceholderParity(target, unit.interpolationCount)) {
            warnings.push(issue.kind === "missing"
                ? `the source's value {${issue.index}} is missing`
                : `{${issue.index}} is not a value of the source and renders as nothing`);
        }
    }
    if (unit.sourceRuns) {
        const segment = { textId: unit.unitId, value: unit.sourceText, role: "narration", rich: unit.sourceRuns } as StoryTextSegment;
        for (const issue of validateMarkupParity(target, segment)) {
            warnings.push(issue.kind === "missingRun"
                ? `run tag ‹${issue.index}› of the source is missing (its styling, pause or event is lost)`
                : `run tag ‹${issue.index}› names no styled run of the source`);
        }
    }
    const sourceNames = namedPlaceholders(unit.sourceText);
    const targetNames = namedPlaceholders(target);
    for (const name of sourceNames) {
        if (!targetNames.has(name)) {
            warnings.push(`placeholder {${name}} is missing`);
        }
    }
    for (const name of targetNames) {
        if (!sourceNames.has(name)) {
            warnings.push(`placeholder {${name}} is not in the source`);
        }
    }
    const sourceBreaks = unit.sourceText.match(LINE_BREAK)?.length ?? 0;
    const targetBreaks = target.match(LINE_BREAK)?.length ?? 0;
    if (sourceBreaks !== targetBreaks) {
        warnings.push(`the source has ${sourceBreaks} line break(s), the translation ${targetBreaks}`);
    }
    return warnings;
}

// ── Voice lines ──────────────────────────────────────────────────────────────────────────────────

/** One line an actor records, as the voice tools describe it. */
export type AgentVoiceLine = {
    unitId: string;
    storyId: string;
    sceneId: string;
    sceneName: string;
    row?: number;
    /** 1-based among the voiced lines of its scene: the recording rule's `{index}`. */
    indexInScene: number;
    /** The character's name, or the voice table's narration / choice label. */
    speaker: string;
    characterId?: string;
    role: StoryTranslationRow["role"];
    /** The line as the actor of this voice language reads it (its translation, when it has one). */
    text: string;
    where: string;
    /** The file name (no extension) the recording rule gives this line. */
    expectedName: string;
    /** `expectedName` reduced the way every file and asset name is matched against it. */
    matchKey: string;
};

/**
 * The speaker a line is filed under, as the voice table and the recording script name it - which is
 * what `{character}` in the recording rule spells, so it has to be their answer exactly.
 */
function voiceSpeaker(row: StoryTranslationRow, nameOf: ReadonlyMap<string, string>): string {
    if (row.role === "choiceText") {
        return translate("workspace.voice.table.choiceSpeaker");
    }
    if (row.role === "dialogue" && row.characterId) {
        const name = nameOf.get(row.characterId);
        if (name) {
            return name;
        }
    }
    return translate("workspace.voice.table.narrationSpeaker");
}

/**
 * Every voiced line of the project for one voice language, in narrative order, each with the file
 * name the recording rule expects. The same rows, the same `{index}` and the same speaker the
 * recording script and the voice table's Assign picker are built from, so a file named after the
 * script matches here exactly as it matches there.
 */
export async function collectAgentVoiceLines(ctx: WorkspaceContext, locale: string): Promise<AgentVoiceLine[]> {
    const voice = ctx.services.get<VoiceService>(Services.Voice);
    await voice.loadLineTexts(locale);
    const pattern = voice.getConfiguration().namingPattern;
    const nameOf = new Map(characterNames(ctx).map(character => [character.id, character.name]));
    const stories = await loadStories(ctx);
    const manyStories = stories.length > 1;
    const lines: AgentVoiceLine[] = [];
    for (const document of stories) {
        const rows = rowIndex(document);
        const prefix = manyStories ? `${document.name} / ` : "";
        for (const row of withSceneIndices(voice.extractRows(document))) {
            const speaker = voiceSpeaker(row, nameOf);
            const position = rows.get(row.sceneId)?.get(row.blockId);
            const expectedName = formatVoiceFilename(pattern, {
                scene: row.sceneName,
                index: row.indexInScene,
                character: speaker,
                locale,
                unitId: row.unitId,
            });
            lines.push({
                unitId: row.unitId,
                storyId: document.id,
                sceneId: row.sceneId,
                sceneName: row.sceneName,
                ...(position ? { row: position } : {}),
                indexInScene: row.indexInScene,
                speaker,
                ...(row.characterId ? { characterId: row.characterId } : {}),
                role: row.role,
                text: voice.getLineText(locale, row.unitId, row.sourceText),
                where: `${prefix}${row.sceneName}${position ? `, row ${position}` : ""}`,
                expectedName,
                matchKey: matchKeyForFilename(expectedName),
            });
        }
    }
    return lines;
}

// ── Finding a scene, paging a list ───────────────────────────────────────────────────────────────

/**
 * The story and scene a list is narrowed to. `scene` is a name or an id, looked for in `story` when
 * one is named and in every story otherwise; a name two scenes share is refused, as everywhere.
 */
export async function resolveSceneScope(
    ctx: WorkspaceContext,
    storyRef: string | undefined,
    sceneRef: string | undefined,
): Promise<{ storyId?: string; sceneId?: string }> {
    const service = storyService(ctx);
    const stories = service.listStories();
    let storyIds = stories.map(entry => entry.id);
    if (storyRef) {
        const byId = stories.find(entry => entry.id === storyRef);
        const named = stories.filter(entry => entry.name === storyRef);
        if (!byId && named.length > 1) {
            throw refuse("invalid_args", `${named.length} stories are called "${storyRef}".`, "Name the story by id (story_list).");
        }
        const entry = byId ?? named[0];
        if (!entry) {
            throw refuse("not_found", `No story "${storyRef}".`, "Call story_list for the stories in this project.");
        }
        storyIds = [entry.id];
        if (!sceneRef) {
            return { storyId: entry.id };
        }
    }
    if (!sceneRef) {
        return {};
    }
    const hits: { storyId: string; sceneId: string }[] = [];
    for (const storyId of storyIds) {
        const document = await service.loadStory(storyId).catch(() => null);
        if (!document) {
            continue;
        }
        if (document.scenes[sceneRef]) {
            return { storyId, sceneId: sceneRef };
        }
        for (const scene of Object.values(document.scenes)) {
            if (scene.name === sceneRef) {
                hits.push({ storyId, sceneId: scene.id });
            }
        }
    }
    if (hits.length > 1) {
        throw refuse("invalid_args", `${hits.length} scenes are called "${sceneRef}".`, "Name the scene by id (story_list), or pass `story`.");
    }
    if (hits.length === 0) {
        throw refuse("not_found", `No scene "${sceneRef}".`, "Call story_list for the scenes and their ids.");
    }
    return hits[0];
}

/** Where a page of a list starts: the `nextCursor` a previous page returned, or the beginning. */
export function readCursor(cursor: string | undefined): number {
    if (cursor === undefined) {
        return 0;
    }
    const offset = Number(cursor);
    if (!Number.isInteger(offset) || offset < 0) {
        throw refuse("invalid_args", "`cursor` must be the `nextCursor` a previous call returned.");
    }
    return offset;
}

/** One page of `items`, and the cursor of the next (null on the last page). */
export function pageOf<T>(items: readonly T[], offset: number, limit: number): { page: T[]; nextCursor: string | null } {
    const page = items.slice(offset, offset + limit);
    const next = offset + page.length;
    return { page, nextCursor: next < items.length ? String(next) : null };
}

/**
 * A long list as one compact JSON document: the summary fields on the first line, then one item per
 * line. Pretty-printing a few hundred units with an indent per field would spend most of an agent's
 * context on whitespace; one line per unit keeps it readable and still parses as JSON.
 */
export function compactListText(lead: string, structured: Record<string, unknown>, listKey: string): string {
    const { [listKey]: list, ...rest } = structured;
    const head = JSON.stringify(rest);
    const items = Array.isArray(list) ? list.map(item => JSON.stringify(item)) : [];
    const json = `${head.slice(0, -1)}${head.length > 2 ? "," : ""}"${listKey}":[${items.length > 0 ? `\n${items.join(",\n")}\n` : ""}]}`;
    return lead ? `${lead}\n${json}` : json;
}
