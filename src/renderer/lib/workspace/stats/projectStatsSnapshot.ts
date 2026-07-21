/**
 * On-demand static statistics for the open project: scale (scenes, lines,
 * words, assets, blueprints), branch count, and per-language translation
 * progress. Nothing here is persisted or cached - the snapshot is recomputed
 * by whoever renders it.
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
import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene } from "@shared/types/story";
import { savedVariableDefs, sceneVariableDefs } from "@shared/types/story";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";

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
    };
    localization: LocaleProgressStat[];
};

type SceneScan = {
    dialogueLines: number;
    narrationLines: number;
    choices: number;
    choiceOptions: number;
    words: number;
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
    };
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
    };
    const visited = new Set<StoryBlockId>();
    const visit = (blockId: StoryBlockId): void => {
        const block: StoryBlock | undefined = scene.blocks[blockId];
        if (!block || visited.has(blockId)) {
            return;
        }
        visited.add(blockId);
        if (block.kind === "nodeAction") {
            const payload = block.payload;
            if (payload.action === "narration") {
                scan.narrationLines += 1;
                scan.words += countWords(payload.text.value);
            } else if (payload.action === "dialogue") {
                scan.dialogueLines += 1;
                scan.words += countWords(payload.text.value);
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

function scanStories(documents: readonly StoryDocument[]): StoriesScan {
    const scan = createStoriesScan();
    for (const document of documents) {
        scan.stories += 1;
        scan.chapters += document.chapters.length;
        scan.savedVariables += Object.keys(savedVariableDefs(document)).length;

        for (const scene of Object.values(document.scenes)) {
            const sceneScan = scanScene(scene);

            scan.scenes += 1;
            scan.dialogueLines += sceneScan.dialogueLines;
            scan.narrationLines += sceneScan.narrationLines;
            scan.choices += sceneScan.choices;
            scan.branches += sceneScan.choiceOptions;
            scan.totalWords += sceneScan.words;
            scan.sceneVariables += Object.keys(sceneVariableDefs(scene)).length;
        }
    }
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

function countCharacters(ctx: WorkspaceContext): number {
    return ctx.services.get<CharacterService>(Services.Character).listCharacter().length;
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

    let characters = 0;
    try {
        characters = countCharacters(ctx);
    } catch {
        characters = 0;
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
            characters,
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
        },
        localization,
    };
}

/** Total word count only - the cheap path used for the daily writing-curve snapshot. */
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
