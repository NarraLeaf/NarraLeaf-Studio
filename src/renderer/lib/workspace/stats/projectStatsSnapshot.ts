/**
 * On-demand static statistics for the open project: scale (scenes, lines,
 * words, assets, blueprints), structural findings (branches,
 * unreachable/empty scenes), per-scene and per-character word counts, and
 * per-language translation progress. Nothing here is persisted or cached —
 * the snapshot is recomputed by whoever renders it.
 * Comments in English per project convention.
 */

import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import {
    extractCharacterTranslationRows,
    extractKeyTranslationRows,
    extractUiTranslationRows,
    type TranslatableUnitRef,
} from "@/lib/workspace/services/localization/localizationModel";
import { countWords } from "@/lib/workspace/stats/wordCount";
import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene, StorySceneId } from "@shared/types/story";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";

export type SceneWordStat = { sceneId: string; sceneName: string; words: number; lines: number };
export type CharacterWordStat = { characterId: string; name: string; lines: number; words: number };
export type LocaleProgressStat = {
    locale: string;
    total: number;
    completed: number;
    reviewed: number;
    machine: number;
    stale: number;
    untranslated: number;
};

export type ProjectStatsSnapshot = {
    scale: {
        stories: number;
        chapters: number;
        scenes: number;
        dialogueLines: number;
        narrationLines: number;
        choices: number;
        totalWords: number;
        characters: number;
        assets: number;
        assetsByType: Record<string, number>;
        blueprints: number;
        blueprintNodes: number;
        uiSurfaces: number;
        variables: { scene: number; saved: number; persistent: number };
    };
    structure: {
        branches: number;
        unreachableScenes: string[];
        emptyScenes: string[];
    };
    topScenes: SceneWordStat[];
    topCharacters: CharacterWordStat[];
    localization: LocaleProgressStat[];
};

type WordTally = { lines: number; words: number };

type SceneScan = {
    dialogueLines: number;
    narrationLines: number;
    choices: number;
    choiceOptions: number;
    words: number;
    /** Blocks that carry authored content; notes are editor-only and don't make a scene non-empty. */
    contentBlocks: number;
    jumpTargets: Set<StorySceneId>;
    characterTallies: Map<string, WordTally>;
};

type StoriesScan = {
    stories: number;
    chapters: number;
    scenes: number;
    dialogueLines: number;
    narrationLines: number;
    choices: number;
    totalWords: number;
    sceneVariables: number;
    savedVariables: number;
    branches: number;
    unreachableScenes: string[];
    emptyScenes: string[];
    sceneStats: SceneWordStat[];
    characterTallies: Map<string, WordTally>;
};

function createStoriesScan(): StoriesScan {
    return {
        stories: 0,
        chapters: 0,
        scenes: 0,
        dialogueLines: 0,
        narrationLines: 0,
        choices: 0,
        totalWords: 0,
        sceneVariables: 0,
        savedVariables: 0,
        branches: 0,
        unreachableScenes: [],
        emptyScenes: [],
        sceneStats: [],
        characterTallies: new Map(),
    };
}

function addTally(tallies: Map<string, WordTally>, key: string, words: number): void {
    const tally = tallies.get(key);
    if (tally) {
        tally.lines += 1;
        tally.words += words;
        return;
    }
    tallies.set(key, { lines: 1, words });
}

/**
 * Story documents load lazily: `listStories()` only sees the library index, so every
 * document must be pulled in before it can be scanned. One broken story degrades to
 * being skipped rather than taking the whole snapshot down.
 */
async function loadStoryDocuments(ctx: WorkspaceContext): Promise<StoryDocument[]> {
    const storyService = ctx.services.get<StoryService>(Services.Story);
    const documents: StoryDocument[] = [];
    for (const entry of storyService.listStories()) {
        try {
            documents.push(await storyService.loadStory(entry.id));
        } catch {
            // A broken story must not take the snapshot down.
        }
    }
    return documents;
}

function scanScene(scene: StoryScene): SceneScan {
    const scan: SceneScan = {
        dialogueLines: 0,
        narrationLines: 0,
        choices: 0,
        choiceOptions: 0,
        words: 0,
        contentBlocks: 0,
        jumpTargets: new Set(),
        characterTallies: new Map(),
    };
    const visited = new Set<StoryBlockId>();
    const visit = (blockId: StoryBlockId): void => {
        const block: StoryBlock | undefined = scene.blocks[blockId];
        if (!block || visited.has(blockId)) {
            return;
        }
        visited.add(blockId);
        if (block.kind !== "note") {
            scan.contentBlocks += 1;
        }
        if (block.kind === "jump") {
            scan.jumpTargets.add(block.payload.targetSceneId);
        } else if (block.kind === "nodeAction") {
            const payload = block.payload;
            if (payload.action === "narration") {
                const words = countWords(payload.text.value);
                scan.narrationLines += 1;
                scan.words += words;
            } else if (payload.action === "dialogue") {
                const words = countWords(payload.text.value);
                scan.dialogueLines += 1;
                scan.words += words;
                if (payload.characterId) {
                    addTally(scan.characterTallies, payload.characterId, words);
                }
            } else if (payload.action === "choice") {
                scan.choices += 1;
            } else if (payload.action === "choiceOption") {
                scan.choiceOptions += 1;
            }
        }
        for (const childId of block.childrenIds) {
            visit(childId);
        }
    };
    for (const rootId of scene.rootBlockIds) {
        visit(rootId);
    }
    return scan;
}

/**
 * Entry scene of a story: the explicit one, else the first scene of the first
 * non-empty chapter. Unassigned scenes never count as an entry.
 */
function findEntrySceneId(document: StoryDocument): StorySceneId | undefined {
    if (document.entrySceneId && document.scenes[document.entrySceneId]) {
        return document.entrySceneId;
    }
    for (const chapter of document.chapters) {
        for (const sceneId of chapter.sceneIds) {
            if (document.scenes[sceneId]) {
                return sceneId;
            }
        }
    }
    return undefined;
}

/**
 * Reachability is deliberately conservative: a story with no identifiable entry
 * scene reports nothing unreachable, because the alternative — declaring every
 * scene unreachable — would be a confident lie about a project we can't trace.
 */
function collectUnreachableSceneNames(
    document: StoryDocument,
    jumpTargetsByScene: Map<StorySceneId, Set<StorySceneId>>,
): string[] {
    const entrySceneId = findEntrySceneId(document);
    if (!entrySceneId) {
        return [];
    }
    const reached = new Set<StorySceneId>([entrySceneId]);
    const queue: StorySceneId[] = [entrySceneId];
    while (queue.length > 0) {
        const sceneId = queue.shift() as StorySceneId;
        for (const targetId of jumpTargetsByScene.get(sceneId) ?? []) {
            if (document.scenes[targetId] && !reached.has(targetId)) {
                reached.add(targetId);
                queue.push(targetId);
            }
        }
    }
    return Object.values(document.scenes)
        .filter(scene => !reached.has(scene.id))
        .map(scene => scene.name);
}

function scanStories(documents: readonly StoryDocument[]): StoriesScan {
    const scan = createStoriesScan();
    for (const document of documents) {
        scan.stories += 1;
        scan.chapters += document.chapters.length;
        scan.savedVariables += Object.keys(document.savedVariables ?? {}).length;

        const jumpTargetsByScene = new Map<StorySceneId, Set<StorySceneId>>();
        for (const scene of Object.values(document.scenes)) {
            const sceneScan = scanScene(scene);
            jumpTargetsByScene.set(scene.id, sceneScan.jumpTargets);

            scan.scenes += 1;
            scan.dialogueLines += sceneScan.dialogueLines;
            scan.narrationLines += sceneScan.narrationLines;
            scan.choices += sceneScan.choices;
            scan.branches += sceneScan.choiceOptions;
            scan.totalWords += sceneScan.words;
            scan.sceneVariables += Object.keys(scene.sceneVariables ?? {}).length;
            if (sceneScan.contentBlocks === 0) {
                scan.emptyScenes.push(scene.name);
            }
            scan.sceneStats.push({
                sceneId: scene.id,
                sceneName: scene.name,
                words: sceneScan.words,
                lines: sceneScan.dialogueLines + sceneScan.narrationLines,
            });
            for (const [characterId, tally] of sceneScan.characterTallies) {
                const total = scan.characterTallies.get(characterId);
                if (total) {
                    total.lines += tally.lines;
                    total.words += tally.words;
                } else {
                    scan.characterTallies.set(characterId, { ...tally });
                }
            }
        }
        scan.unreachableScenes.push(...collectUnreachableSceneNames(document, jumpTargetsByScene));
    }
    scan.sceneStats.sort((a, b) => b.words - a.words);
    return scan;
}

function countAssets(ctx: WorkspaceContext): { total: number; byType: Record<string, number> } {
    const assets = ctx.services.get<AssetsService>(Services.Assets).getAssets();
    const byType: Record<string, number> = {};
    let total = 0;
    for (const [type, records] of Object.entries(assets)) {
        const count = Object.keys(records ?? {}).length;
        byType[type] = count;
        total += count;
    }
    return { total, byType };
}

function countBlueprints(ctx: WorkspaceContext): {
    blueprints: number;
    nodes: number;
    persistentVariables: number;
} {
    const document = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint).getBlueprintDocument();
    let blueprints = 0;
    let nodes = 0;
    for (const blueprint of Object.values(document.blueprints ?? {})) {
        blueprints += 1;
        if (blueprint.program.kind !== "graph") {
            continue;
        }
        const { events, functions, macros } = blueprint.program.graphs;
        const groups: Record<string, { graph?: BlueprintGraphIr }>[] = [events, functions, macros ?? {}];
        for (const group of groups) {
            for (const entry of Object.values(group)) {
                nodes += Object.keys(entry.graph?.nodes ?? {}).length;
            }
        }
    }
    return {
        blueprints,
        nodes,
        persistentVariables: Object.keys(document.persistentVariables ?? {}).length,
    };
}

function resolveCharacterStats(
    ctx: WorkspaceContext,
    tallies: Map<string, WordTally>,
): { characters: number; topCharacters: CharacterWordStat[] } {
    const characters = ctx.services.get<CharacterService>(Services.Character).listCharacter();
    const stats: CharacterWordStat[] = [];
    for (const character of characters) {
        const characterId = character.profile.getId();
        const tally = tallies.get(characterId);
        if (!tally) {
            continue;
        }
        stats.push({
            characterId,
            name: character.profile.getName(),
            lines: tally.lines,
            words: tally.words,
        });
    }
    stats.sort((a, b) => b.words - a.words);
    return { characters: characters.length, topCharacters: stats };
}

/** Every translatable unit of the project, mirroring the localization panel's aggregation. */
async function collectTranslatableRows(
    ctx: WorkspaceContext,
    documents: readonly StoryDocument[],
): Promise<TranslatableUnitRef[]> {
    const localizationService = ctx.services.get<LocalizationService>(Services.Localization);
    const rows: TranslatableUnitRef[] = [];

    const characters = ctx.services.get<CharacterService>(Services.Character).listCharacter();
    for (const row of extractCharacterTranslationRows(
        characters.map(character => ({ id: character.profile.getId(), name: character.profile.getName() })),
    )) {
        rows.push({ unitId: row.unitId, sourceText: row.sourceText });
    }
    for (const document of documents) {
        for (const row of localizationService.extractRows(document)) {
            rows.push({ unitId: row.unitId, sourceText: row.sourceText });
        }
    }
    const uiDocument = ctx.services.get<UIDocumentService>(Services.UIDocument).getDocument();
    for (const row of extractUiTranslationRows(uiDocument)) {
        rows.push({ unitId: row.unitId, sourceText: row.sourceText });
    }
    const keysDocument =
        localizationService.getKeysIfLoaded() ?? (await localizationService.loadKeys().catch(() => undefined));
    for (const row of extractKeyTranslationRows(keysDocument ?? { schemaVersion: 1, keys: {} })) {
        rows.push({ unitId: row.unitId, sourceText: row.sourceText });
    }
    return rows;
}

async function computeLocalizationStats(
    ctx: WorkspaceContext,
    documents: readonly StoryDocument[],
): Promise<LocaleProgressStat[]> {
    const localizationService = ctx.services.get<LocalizationService>(Services.Localization);
    const config = localizationService.getConfiguration();
    const rows = await collectTranslatableRows(ctx, documents);
    const stats: LocaleProgressStat[] = [];
    for (const locale of config.locales) {
        if (locale.code === config.sourceLocale) {
            continue;
        }
        try {
            await localizationService.loadDocument(locale.code);
            stats.push({ locale: locale.code, ...localizationService.computeProgress(rows, locale.code) });
        } catch {
            // Skip broken locale files; the language simply reports no progress.
        }
    }
    return stats;
}

export async function computeProjectStatsSnapshot(ctx: WorkspaceContext): Promise<ProjectStatsSnapshot> {
    const documents = await loadStoryDocuments(ctx);

    let stories = createStoriesScan();
    try {
        stories = scanStories(documents);
    } catch {
        stories = createStoriesScan();
    }

    let assets = { total: 0, byType: {} as Record<string, number> };
    try {
        assets = countAssets(ctx);
    } catch {
        assets = { total: 0, byType: {} };
    }

    let blueprints = { blueprints: 0, nodes: 0, persistentVariables: 0 };
    try {
        blueprints = countBlueprints(ctx);
    } catch {
        blueprints = { blueprints: 0, nodes: 0, persistentVariables: 0 };
    }

    let uiSurfaces = 0;
    try {
        uiSurfaces = ctx.services.get<UIDocumentService>(Services.UIDocument).getDocument().surfaces.length;
    } catch {
        uiSurfaces = 0;
    }

    let characterStats: { characters: number; topCharacters: CharacterWordStat[] } = {
        characters: 0,
        topCharacters: [],
    };
    try {
        characterStats = resolveCharacterStats(ctx, stories.characterTallies);
    } catch {
        characterStats = { characters: 0, topCharacters: [] };
    }

    let localization: LocaleProgressStat[] = [];
    try {
        localization = await computeLocalizationStats(ctx, documents);
    } catch {
        localization = [];
    }

    return {
        scale: {
            stories: stories.stories,
            chapters: stories.chapters,
            scenes: stories.scenes,
            dialogueLines: stories.dialogueLines,
            narrationLines: stories.narrationLines,
            choices: stories.choices,
            totalWords: stories.totalWords,
            characters: characterStats.characters,
            assets: assets.total,
            assetsByType: assets.byType,
            blueprints: blueprints.blueprints,
            blueprintNodes: blueprints.nodes,
            uiSurfaces,
            variables: {
                scene: stories.sceneVariables,
                saved: stories.savedVariables,
                persistent: blueprints.persistentVariables,
            },
        },
        structure: {
            branches: stories.branches,
            unreachableScenes: stories.unreachableScenes,
            emptyScenes: stories.emptyScenes,
        },
        topScenes: stories.sceneStats,
        topCharacters: characterStats.topCharacters,
        localization,
    };
}

/** Total word count only — the cheap path used for the daily writing-curve snapshot. */
export async function computeTotalWordCount(ctx: WorkspaceContext): Promise<number> {
    try {
        const documents = await loadStoryDocuments(ctx);
        let total = 0;
        for (const document of documents) {
            for (const scene of Object.values(document.scenes)) {
                total += scanScene(scene).words;
            }
        }
        return total;
    } catch {
        return 0;
    }
}
