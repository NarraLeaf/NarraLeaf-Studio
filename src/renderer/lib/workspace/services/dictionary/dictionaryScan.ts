import type { StoryDocument, StoryId } from "@shared/types/story";
import { isStoryDeclarationBlock, listSceneBlocksInDocumentOrder, listScenesInDocumentOrder } from "@shared/types/story";
import { dictionaryNeedles, type DictionaryNeedle } from "@shared/dictionary/dictionaryMatch";
import type { ProjectDictionaryEntry } from "@shared/types/dictionary";
import { getStoryTextSegment } from "@/lib/story/storyRowProjection";
import { richRunsToPlain, segmentToRuns } from "@/apps/workspace/modules/story/scene-editor/richText";
import { dictionaryMarks } from "@/apps/workspace/modules/story/scene-editor/storyDictionary";
import type { SearchJumpTarget } from "../search/searchJumpTarget";
import { Services, type WorkspaceContext } from "../services";
import { StoryService } from "../story/StoryService";

/**
 * Reading every story in the project against the dictionary's variant spellings.
 *
 * The story editor already reads the row being typed; this is the same question asked of the rows
 * nobody has open. It exists because the answer an author actually wants is not "is this line
 * consistent" but "is the script consistent" - a term written the wrong way in a scene finished last
 * month is exactly the one that will not be found by writing.
 *
 * **Variants only.** The reading suggestions are deliberately left out: a term with a reading occurs
 * on every page it appears on, and a project-wide list of those is a list of the script rather than
 * a list of anything wrong with it. Whether to annotate an occurrence is a judgement made while
 * writing the line, which is where that hint stays.
 *
 * Runs rather than plain text, so this and the editor answer identically - see
 * `storyDictionary.dictionaryMarks`.
 *
 * Comments in English per project convention.
 */

/** One place the script writes a term the way this project does not. */
export type DictionaryFinding = {
    /** The term the project writes. */
    term: string;
    /** What the row writes instead, as written. */
    written: string;
    /** The term with the written capitalisation carried over - what a replacement would put there. */
    replacement: string;
    /** The row's own text, so the list shows the sentence rather than the word again. */
    preview: string;
    /** Where it is. The story editor's own deep link, so the jump is the one search already uses. */
    target: Extract<SearchJumpTarget, { kind: "storyBlock" }>;
};

export type DictionaryScanProgress = {
    /** Stories read so far. */
    done: number;
    /** Stories in the project. */
    total: number;
};

export type DictionaryScanOptions = {
    /** Told after each story, so a panel can count up rather than sit still. */
    onProgress?: (progress: DictionaryScanProgress) => void;
    /** Answered between stories. `false` abandons the scan and resolves what was found so far. */
    shouldContinue?: () => boolean;
};

export type DictionaryScanResult = {
    findings: DictionaryFinding[];
    /** Stories actually read. Short of `total` when the scan was abandoned. */
    scanned: number;
    total: number;
    /** Whether the scan ran to the end. A partial answer must not read as "the project is clean". */
    complete: boolean;
};

/** How long a row's own text may be in the results list before it is cut. */
const PREVIEW_LIMIT = 120;

/**
 * What to look for. Variants only, whatever the project's reading option says.
 *
 * Built once by the caller and handed in, or built here from the entries - the panel already holds
 * the entries and building needles walks all of them.
 */
export function variantNeedles(entries: readonly ProjectDictionaryEntry[]): DictionaryNeedle[] {
    return dictionaryNeedles(entries, { suggestReadings: false, checkVariants: true });
}

/** Every variant spelling in one story, in document order. */
export function findInStoryDocument(
    document: StoryDocument,
    needles: readonly DictionaryNeedle[],
): DictionaryFinding[] {
    const findings: DictionaryFinding[] = [];
    if (needles.length === 0) {
        return findings;
    }
    const storyName = document.name;

    for (const scene of listScenesInDocumentOrder(document)) {
        for (const block of listSceneBlocksInDocumentOrder(scene)) {
            // A declaration row's text is a variable's name, not prose. Marking a name as the wrong
            // way to write a term would offer a replacement that renames the variable.
            if (isStoryDeclarationBlock(block)) {
                continue;
            }
            const segment = getStoryTextSegment(block);
            if (!segment) {
                continue;
            }
            const runs = segmentToRuns(segment);
            const marks = dictionaryMarks(runs, needles);
            if (marks.length === 0) {
                continue;
            }
            const preview = richRunsToPlain(runs).trim();
            for (const mark of marks) {
                findings.push({
                    term: mark.term,
                    written: mark.text,
                    replacement: mark.replacement ?? mark.term,
                    preview: preview.length > PREVIEW_LIMIT ? `${preview.slice(0, PREVIEW_LIMIT)}…` : preview,
                    target: {
                        kind: "storyBlock",
                        storyId: document.id,
                        sceneId: scene.id,
                        blockId: block.id,
                        storyName,
                        sceneName: scene.name,
                    },
                });
            }
        }
    }

    return findings;
}

/**
 * Read the whole project.
 *
 * One story at a time, yielding between them, because this runs on the renderer's own thread and a
 * project is as many stories as the author wrote. A story that cannot be read is skipped rather than
 * ending the scan: one unreadable document must not be able to answer "no inconsistencies" for the
 * rest of the project - which is what `complete` is for.
 */
export async function scanProjectForVariants(
    context: WorkspaceContext,
    needles: readonly DictionaryNeedle[],
    options: DictionaryScanOptions = {},
): Promise<DictionaryScanResult> {
    const storyService = context.services.get<StoryService>(Services.Story);
    await storyService.loadLibrary();
    const stories: StoryId[] = storyService.listStories().map(entry => entry.id);
    const total = stories.length;

    const findings: DictionaryFinding[] = [];
    let scanned = 0;
    if (needles.length === 0) {
        options.onProgress?.({ done: total, total });
        return { findings, scanned: total, total, complete: true };
    }

    for (const storyId of stories) {
        if (options.shouldContinue && !options.shouldContinue()) {
            return { findings, scanned, total, complete: false };
        }
        try {
            const document = await storyService.loadStory(storyId);
            findings.push(...findInStoryDocument(document, needles));
        } catch {
            // Unreadable, missing, or a document this build cannot parse. The rest of the project
            // still has an answer worth having.
        }
        scanned += 1;
        options.onProgress?.({ done: scanned, total });
    }

    return { findings, scanned, total, complete: true };
}

/** The findings for one term, in the order they were found. */
export function findingsByTerm(findings: readonly DictionaryFinding[]): Map<string, DictionaryFinding[]> {
    const byTerm = new Map<string, DictionaryFinding[]>();
    for (const finding of findings) {
        const existing = byTerm.get(finding.term);
        if (existing) {
            existing.push(finding);
        } else {
            byTerm.set(finding.term, [finding]);
        }
    }
    return byTerm;
}
