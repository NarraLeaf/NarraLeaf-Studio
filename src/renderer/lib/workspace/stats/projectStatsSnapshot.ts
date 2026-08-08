/**
 * On-demand static statistics for the open project: scale (scenes, lines,
 * words, assets, blueprints), dialogue per speaker, branch count, and
 * per-language translation progress. Nothing here is persisted or cached - the
 * snapshot is recomputed by whoever renders it.
 * Comments in English per project convention.
 */

import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { VariableRegistryService } from "@/lib/workspace/services/variables/VariableRegistryService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import {
    extractCharacterTranslationRows,
    extractKeyTranslationRows,
    extractUiTranslationRows,
    type TranslatableUnitRef,
} from "@/lib/workspace/services/localization/localizationModel";
import { countBlockWords } from "@/lib/workspace/stats/storyTextStats";
import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene } from "@shared/types/story";
import { savedVariableDefs, sceneVariableDefs } from "@shared/types/story";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";

/**
 * How many speakers the snapshot keeps, busiest first. Everything past it is folded into one
 * aggregate so the section still adds up.
 *
 * A speaker costs nothing to *count* - the tally rides along on the story walk the snapshot already
 * performs - but it does cost an object in the result and a row on screen, and the number of
 * distinct speakers has no upper bound in the document: a bare `speakerName` is free-form text, so a
 * script that names its speaker per line yields one entry per line. The cap is what keeps both the
 * snapshot and the DOM a fixed size no matter how the project is written. Real casts sit far below
 * it, so an author never meets the fold.
 */
const SPEAKER_LIMIT = 100;

export type LocaleProgressStat = {
    locale: string;
    total: number;
    completed: number;
    reviewed: number;
    machine: number;
    stale: number;
    untranslated: number;
};

/**
 * One speaker's share of the dialogue.
 *
 * Deliberately free of localized text: the snapshot is computed once per visit to the dashboard and
 * would otherwise go stale the moment the interface language changes. `kind` says which wording the
 * surface should print, and `name` carries the only part that has to come from the project.
 */
export type SpeakerStat = {
    /** Row identity, stable across recomputes: the character id, the bare name, or "" for nobody. */
    key: string;
    /**
     * `character` - bound to a character that still exists, `name` is its current name.
     * `named` - a bare speaker name, either a temp speaker or a line whose character is gone.
     * `unknown` - bound to a character that no longer exists, with no name left to fall back to.
     * `unassigned` - the line names no speaker at all.
     */
    kind: "character" | "named" | "unknown" | "unassigned";
    name?: string;
    /** Dialogue lines spoken. */
    lines: number;
    /** Words in those lines, on the same basis as the project total. */
    words: number;
};

export type CastStats = {
    /** Busiest first, at most {@link SPEAKER_LIMIT} of them. */
    speakers: SpeakerStat[];
    /** The speakers past the cap, as one total. Null when every speaker is listed. */
    overflow: { speakers: number; lines: number; words: number } | null;
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
        blueprintNodes: number;
        uiSurfaces: number;
        variables: { scene: number; saved: number; persistent: number };
    };
    cast: CastStats;
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

/** What one speaker accumulates during the walk, before names are resolved and rows are ranked. */
type SpeakerTally = {
    characterId?: string;
    /** The first bare name seen on these lines. Only read when `characterId` no longer resolves. */
    name?: string;
    lines: number;
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
    speakers: Map<string, SpeakerTally>;
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
        speakers: new Map(),
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

/**
 * Which speaker a dialogue line belongs to.
 *
 * A line identifies its speaker by character id *or* by a bare name, and the two are separate
 * identities: two characters may share a display name, and a temp speaker spelled like a character
 * is still not that character. Keying on the id first, and only then on the name, is what keeps
 * renaming a character from merging its lines with someone else's.
 */
function speakerKeyOf(characterId: string | undefined, name: string | undefined): string {
    if (characterId) {
        return `id:${characterId}`;
    }
    return name ? `name:${name}` : "";
}

/**
 * Walk one scene for the line tallies and its word count. What counts as a word lives in
 * `countBlockWords`, shared with the status bar's per-scene count so the project total and the
 * scene total can never disagree about the same text.
 *
 * `speakers`, when given, is accumulated across the whole project rather than per scene: the
 * per-speaker split rides along on this one walk instead of paying for a second pass, so it costs a
 * map lookup per dialogue line and nothing at all for every other block. Callers that only need the
 * word total (the daily writing curve) leave it out and pay nothing.
 */
function scanScene(scene: StoryScene, speakers?: Map<string, SpeakerTally>): SceneScan {
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
        const words = countBlockWords(block);
        scan.words += words;
        if (block.kind === "nodeAction") {
            const payload = block.payload;
            if (payload.action === "narration") {
                scan.narrationLines += 1;
            } else if (payload.action === "dialogue") {
                scan.dialogueLines += 1;
                if (speakers) {
                    tallySpeaker(speakers, payload.characterId?.trim(), payload.speakerName?.trim(), words);
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

function tallySpeaker(
    speakers: Map<string, SpeakerTally>,
    characterId: string | undefined,
    name: string | undefined,
    words: number,
): void {
    const key = speakerKeyOf(characterId, name);
    let tally = speakers.get(key);
    if (!tally) {
        tally = { lines: 0, words: 0 };
        if (characterId) {
            tally.characterId = characterId;
        }
        if (name) {
            tally.name = name;
        }
        speakers.set(key, tally);
    }
    tally.lines += 1;
    tally.words += words;
}

/** Exported for tests: the whole story walk, with no services attached to it. */
export function scanStories(documents: readonly StoryDocument[]): StoriesScan {
    const scan = createStoriesScan();
    for (const document of documents) {
        scan.stories += 1;
        scan.chapters += document.chapters.length;
        scan.savedVariables += Object.keys(savedVariableDefs(document)).length;

        for (const scene of Object.values(document.scenes)) {
            const sceneScan = scanScene(scene, scan.speakers);

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

/**
 * How a tallied speaker should be labelled, mirroring what the story editor prints above the same
 * line: a live character shows its current name, a line whose character is gone falls back to the
 * bare name it still carries, and only a line with neither is nameless.
 */
function labelSpeaker(
    tally: SpeakerTally,
    characterName: (id: string) => string | undefined,
): Pick<SpeakerStat, "kind" | "name"> {
    if (tally.characterId) {
        const name = characterName(tally.characterId);
        if (name) {
            return { kind: "character", name };
        }
        return tally.name ? { kind: "named", name: tally.name } : { kind: "unknown" };
    }
    return tally.name ? { kind: "named", name: tally.name } : { kind: "unassigned" };
}

/**
 * Rank the tallied speakers, busiest first, and fold the tail past `limit` into one aggregate.
 *
 * The tiebreaker compares names with `<` rather than `localeCompare`: it exists only so the order is
 * stable between two recomputes of the same project, and a collator call per comparison would be the
 * one part of this file that scales badly with an unusual number of speakers.
 *
 * Exported for tests.
 */
export function rankSpeakers(
    tallies: ReadonlyMap<string, SpeakerTally>,
    characterName: (id: string) => string | undefined,
    limit: number = SPEAKER_LIMIT,
): CastStats {
    const rows: SpeakerStat[] = [];
    for (const [key, tally] of tallies) {
        rows.push({ key, ...labelSpeaker(tally, characterName), lines: tally.lines, words: tally.words });
    }
    rows.sort((a, b) => {
        if (a.lines !== b.lines) {
            return b.lines - a.lines;
        }
        if (a.words !== b.words) {
            return b.words - a.words;
        }
        const left = a.name ?? "";
        const right = b.name ?? "";
        return left < right ? -1 : left > right ? 1 : 0;
    });

    if (rows.length <= limit) {
        return { speakers: rows, overflow: null };
    }
    const overflow = { speakers: rows.length - limit, lines: 0, words: 0 };
    for (let index = limit; index < rows.length; index += 1) {
        overflow.lines += rows[index].lines;
        overflow.words += rows[index].words;
    }
    return { speakers: rows.slice(0, limit), overflow };
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

/**
 * Blueprint weight is reported as a NODE count, not a count of blueprint entities: most entities are
 * implicit (one per story action, inline interpolation, condition, widget, bound property), so their
 * number says more about how the document is structured than about how much logic the project holds.
 */
function countBlueprints(ctx: WorkspaceContext): {
    nodes: number;
} {
    const document = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint).getBlueprintDocument();
    let nodes = 0;
    for (const blueprint of Object.values(document.blueprints ?? {})) {
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
    return { nodes };
}

/**
 * The project registry's variables, per scope.
 *
 * Per scope and never `listEntries().length`: the registry holds BOTH project scopes now, so the flat
 * count reported every saved variable in the project as a persistent one - and the headline the
 * dashboard draws from it would have said an author has twice the game-level state they wrote.
 */
function countRegistryVariables(ctx: WorkspaceContext): { saved: number; persistent: number } {
    const registry = ctx.services.get<VariableRegistryService>(Services.VariableRegistry);
    return {
        saved: registry.listEntriesInScope("saved").length,
        persistent: registry.listEntriesInScope("persistent").length,
    };
}

/**
 * The cast, read once: both the headline count and the id -> name lookup the speaker rows resolve
 * against. Reading it once means the character list is walked a single time, and that every speaker
 * row is labelled from the same view of the cast the count was taken from.
 */
function readCast(ctx: WorkspaceContext): { count: number; nameOf: (id: string) => string | undefined } {
    const characters = ctx.services.get<CharacterService>(Services.Character).listCharacter();
    const names = new Map<string, string>();
    for (const character of characters) {
        names.set(character.profile.getId(), character.profile.getName());
    }
    return { count: characters.length, nameOf: id => names.get(id) };
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

    let blueprints = { nodes: 0 };
    try {
        blueprints = countBlueprints(ctx);
    } catch {
        blueprints = { nodes: 0 };
    }

    let registryVariables = { saved: 0, persistent: 0 };
    try {
        registryVariables = countRegistryVariables(ctx);
    } catch {
        registryVariables = { saved: 0, persistent: 0 };
    }

    let uiSurfaces = 0;
    try {
        uiSurfaces = ctx.services.get<UIDocumentService>(Services.UIDocument).getDocument().surfaces.length;
    } catch {
        uiSurfaces = 0;
    }

    let cast: { count: number; nameOf: (id: string) => string | undefined } = {
        count: 0,
        nameOf: () => undefined,
    };
    try {
        cast = readCast(ctx);
    } catch {
        // A cast that cannot be read leaves the speaker rows labelled by whatever name their lines
        // carry, rather than taking the whole snapshot down.
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
            characters: cast.count,
            assets: assets.total,
            assetsByType: assets.byType,
            blueprintNodes: blueprints.nodes,
            uiSurfaces,
            variables: {
                scene: stories.sceneVariables,
                // Both declaration surfaces, exactly as the merged view unions them: a saved variable
                // may be a story row, a registry entry, or (mid-migration) have been one and become
                // the other. Counting only the documents reported zero saved variables for a project
                // whose saved state had simply moved to the registry.
                saved: stories.savedVariables + registryVariables.saved,
                persistent: registryVariables.persistent,
            },
        },
        cast: rankSpeakers(stories.speakers, cast.nameOf),
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
