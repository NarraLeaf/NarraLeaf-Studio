/**
 * Project clean-up: work Studio already knows how to do, run again over the whole project at once.
 *
 * Every task here reuses the thing that does the same job one item at a time, so a clean-up and the
 * per-item gesture can never disagree:
 *
 *  - Blueprint layout is the canvas's "Format graph" (`layoutBlueprintGraph`), with each card sized
 *    from its definition the way `blueprint format` sizes it, because no canvas is open to measure.
 *  - Dialog avatars are the Characters panel's "Auto-frame all" (`runAutoFrame`).
 *  - The project cache is what `docs/caches.md` lists as derived: deleting it costs time, never work.
 *  - Orphaned comments are the ones the Comments panel lists under "row not found".
 *  - Orphaned translations are the ones `localization/orphan` counts, narrowed to lines that are gone:
 *    a line that is only disabled is still in the script, and turning it back on should find its
 *    translations where they were.
 *
 * Each write lands where the per-item gesture's write lands, so it undoes the same way: a blueprint
 * on its own editor's stack, the comments as one step of the project's. Translations are the
 * exception, as they are in the translation table: nothing there can bring a deleted one back.
 *
 * Comments in English per project convention.
 */

import type { Blueprint, BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR } from "@shared/types/blueprint/graph";
import type { StoryDocument } from "@shared/types/story";
import type { StoryCommentThread } from "@shared/types/storyComments";
import { readBlueprintCommentSize } from "@shared/blueprint/blueprintCommentGeometry";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes";
import type { BlueprintNodeRole } from "@/lib/ui-editor/blueprint-nodes/types";
import { layoutGraphOf } from "@/lib/blueprint-cli/format";
import { layoutBlueprintGraph } from "@/apps/workspace/modules/blueprint-lite/flow/blueprintAutoLayout";
import { indexStoryTextLines } from "@/lib/lint/rules/text/textSegments";
import { ownerRefToIndexKey } from "../ui-editor/blueprint/ownerKeys";
import { readNodeEditorLayout, writeNodeEditorLayout } from "../ui-editor/blueprint/graphEditing";
import { Services, type WorkspaceContext } from "../services";
import type { UIGraphService } from "../ui-editor/UIGraphService";
import type { LocalBlueprintService } from "../ui-editor/LocalBlueprintService";
import type { StoryService } from "../story/StoryService";
import type { StoryCommentsService } from "../storyComments/StoryCommentsService";
import type { LocalizationService } from "../localization/LocalizationService";
import type { CharacterService } from "../core/CharacterService";
import type { AssetsService } from "../core/AssetsService";
import type { FileSystemService } from "../core/FileSystem";
import type { BuildService } from "../core/BuildService";
import type { PreviewService } from "../core/PreviewService";
import { planAutoFrame, runAutoFrame, type HeadFrameDetector } from "../character/avatarAutoFrame";
import { ProjectNameConvention } from "../../project/nameConvention";

// ── Tasks ────────────────────────────────────────────────────────────────────────────────────────

export const PROJECT_CLEANUP_TASKS = [
    "avatars",
    "projectCache",
    "blueprintLayout",
    "danglingNodes",
    "orphanComments",
    "orphanTranslations",
] as const;

export type ProjectCleanupTask = (typeof PROJECT_CLEANUP_TASKS)[number];

/** What each task would touch, counted before anything is written. */
export type ProjectCleanupScan = {
    /** Differentials the model would look at: those without a framing, or every one with `overwrite`. */
    avatars: { unframed: number; all: number };
    /** Bytes of derived files on disk, and whether a build or a preview is using them right now. */
    projectCache: { bytes: number; busy: boolean };
    /** Blueprints whose cards formatting would move. */
    blueprintLayout: { blueprints: number };
    danglingNodes: { nodes: number };
    orphanComments: { threads: number };
    orphanTranslations: { units: number };
};

export type ProjectCleanupSelection = {
    tasks: ReadonlySet<ProjectCleanupTask>;
    /** Avatars only: replace framings a differential already has. */
    overwriteAvatars: boolean;
};

/** What a run did, task by task. A task that was not selected is absent. */
export type ProjectCleanupOutcome = Partial<Record<ProjectCleanupTask, number>>;

// ── Blueprints ───────────────────────────────────────────────────────────────────────────────────

/**
 * Roles a node can have and still do nothing when nothing is wired to it. Heads, entries and returns
 * are where a graph starts or ends, so an unwired one is a graph waiting to be written, not debris;
 * comments are never wired at all.
 */
const INERT_WHEN_UNWIRED: ReadonlySet<BlueprintNodeRole> = new Set<BlueprintNodeRole>([
    "normal",
    "reroute",
    "dataLiteral",
    "elementLiteral",
    "imageAssetLiteral",
]);

/**
 * Nodes that matter without a wire: a declared local is found by the reads and writes that name it,
 * so an unwired declaration is what keeps those working.
 */
const KEPT_WHEN_UNWIRED: ReadonlySet<string> = new Set([BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR]);

/** Every graph a blueprint holds: its event layers and its functions. Script layers have none. */
function graphsOf(blueprint: Blueprint): BlueprintGraphIr[] {
    const graphs: BlueprintGraphIr[] = [];
    for (const layer of Object.values(blueprint.graphs?.events ?? {})) {
        if (layer.graph && !layer.script) graphs.push(layer.graph);
    }
    for (const fn of Object.values(blueprint.graphs?.functions ?? {})) {
        if (fn.graph) graphs.push(fn.graph);
    }
    return graphs;
}

/**
 * Nodes with no wire in or out whose role says they cannot run or feed anything on their own.
 *
 * A node whose type is not registered - its plugin is off - is never counted: its definition is what
 * says whether it is inert, and the plugin coming back would find it gone.
 */
export function danglingBlueprintNodeIds(graph: BlueprintGraphIr): string[] {
    const wired = new Set<string>();
    for (const edge of graph.edges ?? []) {
        wired.add(edge.from.nodeId);
        wired.add(edge.to.nodeId);
    }
    return Object.values(graph.nodes ?? {})
        .filter(node => {
            if (wired.has(node.id) || KEPT_WHEN_UNWIRED.has(node.type) || !blueprintNodeRegistry.get(node.type)) return false;
            const role = blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, node.params).role ?? "normal";
            return INERT_WHEN_UNWIRED.has(role);
        })
        .map(node => node.id);
}

/** A copy of the blueprint without its dangling nodes, and how many went; null when none did. */
export function withoutDanglingNodes(blueprint: Blueprint): { blueprint: Blueprint; removed: number } | null {
    const next = structuredClone(blueprint);
    let removed = 0;
    for (const graph of graphsOf(next)) {
        for (const id of danglingBlueprintNodeIds(graph)) {
            delete graph.nodes![id];
            removed += 1;
        }
    }
    return removed > 0 ? { blueprint: next, removed } : null;
}

/** Same point once rounded: formatting writes whole pixels, and a fraction is not a move. */
function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
}

/**
 * Lay out one graph in place. True when anything moved or a frame changed size.
 *
 * Cards are sized from their definitions (`layoutGraphOf`) rather than measured, which is the
 * estimate `blueprint format` uses: wide enough in every interface language.
 */
function layoutGraphInPlace(graph: BlueprintGraphIr): boolean {
    const shape = layoutGraphOf(graph);
    if (shape.cards.length === 0) return false;
    const result = layoutBlueprintGraph(shape);
    let changed = false;
    for (const [id, point] of Object.entries(result.positions)) {
        const node = graph.nodes?.[id];
        if (!node) continue;
        if (!samePoint(readNodeEditorLayout(node), point)) {
            writeNodeEditorLayout(node, { x: Math.round(point.x), y: Math.round(point.y) });
            changed = true;
        }
    }
    for (const [id, rect] of Object.entries(result.frames)) {
        const node = graph.nodes?.[id];
        if (!node) continue;
        const size = readBlueprintCommentSize(node.params ?? {});
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        if (!samePoint(readNodeEditorLayout(node), rect) || Math.round(size.width) !== width || Math.round(size.height) !== height) {
            node.params = { ...(node.params ?? {}), width, height };
            writeNodeEditorLayout(node, { x: Math.round(rect.x), y: Math.round(rect.y) });
            changed = true;
        }
    }
    return changed;
}

/** A formatted copy of the blueprint; null when formatting would move nothing. */
export function withFormattedLayout(blueprint: Blueprint): Blueprint | null {
    const next = structuredClone(blueprint);
    let changed = false;
    for (const graph of graphsOf(next)) {
        if (layoutGraphInPlace(graph)) changed = true;
    }
    return changed ? next : null;
}

function liveBlueprintDocument(ctx: WorkspaceContext): BlueprintDocument {
    return ctx.services.get<UIGraphService>(Services.UIGraph).getDocument().blueprintDocument;
}

/**
 * Put a changed blueprint back: one step of undo on its own editor's stack, the stack the editor
 * itself records on, so the author undoes it from the blueprint they are looking at.
 */
function commitBlueprint(ctx: WorkspaceContext, blueprint: Blueprint): void {
    const graph = ctx.services.get<UIGraphService>(Services.UIGraph);
    const local = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    local.runBlueprintHistoryTransaction(
        blueprint.id,
        () => graph.applyGraphMutation(document => {
            document.blueprintDocument.blueprints[blueprint.id] = structuredClone(blueprint);
        }),
        { ownerKey: ownerRefToIndexKey(blueprint.owner) },
    );
}

// ── Stories ──────────────────────────────────────────────────────────────────────────────────────

async function loadedStories(ctx: WorkspaceContext): Promise<{ name: string; document: StoryDocument }[]> {
    const stories = ctx.services.get<StoryService>(Services.Story);
    await stories.loadAllStories();
    return stories.listStories().flatMap(entry => {
        const document = stories.getLoadedStoryDocument(entry.id);
        return document ? [{ name: entry.name, document }] : [];
    });
}

/** Every row of every scene, disabled ones included: a comment on a switched-off row still has its row. */
function storyBlockIds(stories: readonly { document: StoryDocument }[]): Set<string> {
    const ids = new Set<string>();
    for (const { document } of stories) {
        for (const scene of Object.values(document.scenes)) {
            for (const blockId of Object.keys(scene.blocks)) ids.add(blockId);
        }
    }
    return ids;
}

/** Threads whose row is in no story, as the Comments panel decides it: by block id, anywhere. */
export function orphanCommentThreadIds(threads: readonly StoryCommentThread[], blockIds: ReadonlySet<string>): string[] {
    return threads.filter(thread => !blockIds.has(thread.blockId)).map(thread => thread.id);
}

/**
 * Story-line units whose line is in no story at all.
 *
 * Narrower than `orphanTranslationUnitIds`, which also counts lines that are disabled: the table
 * offers those for deletion one language at a time, with the line beside each, but a clean-up of the
 * whole project should not take the translations of a line the author only switched off.
 */
export function missingLineTranslationUnitIds(units: Readonly<Record<string, unknown>>, lineIds: ReadonlySet<string>): string[] {
    return Object.keys(units).filter(unitId => !unitId.includes(":") && !lineIds.has(unitId));
}

// ── Project cache ────────────────────────────────────────────────────────────────────────────────

/**
 * Derived directories a build or a preview writes into `.nlstudio/`, beside things that are not
 * derived: `build/last-run.json` is the record the dashboard reads, and `preview/userData` holds the
 * preview's saves, which "Reset player data" is the one place to clear.
 */
const DERIVED_RUN_DIRECTORIES: readonly (readonly string[])[] = [
    [".nlstudio", "build", "staging"],
    [".nlstudio", "build", "staging-web"],
    [".nlstudio", "build", "patch"],
    [".nlstudio", "build", "patch-baseline"],
    [".nlstudio", "build", "dlc"],
    [".nlstudio", "preview", "app"],
];

function cacheDirectories(ctx: WorkspaceContext): string[] {
    return [
        ctx.project.resolve(ProjectNameConvention.EditorThumbnailCache),
        ...DERIVED_RUN_DIRECTORIES.map(segments => ctx.project.resolve(segments)),
    ];
}

/** A build or a preview is reading and writing these directories. */
function cacheBusy(ctx: WorkspaceContext): boolean {
    if (ctx.services.get<BuildService>(Services.Build).isBuilding()) return true;
    const preview = ctx.services.get<PreviewService>(Services.Preview).getStatus();
    return preview !== "idle" && preview !== "error";
}

async function cacheBytes(ctx: WorkspaceContext): Promise<number> {
    const fs = ctx.services.get<FileSystemService>(Services.FileSystem);
    let total = 0;
    for (const directory of cacheDirectories(ctx)) {
        const exists = await fs.isDirExists(directory);
        if (!exists.ok || !exists.data) continue;
        const size = await fs.directorySize(directory);
        if (size.ok && size.data) total += size.data.totalBytes;
    }
    return total;
}

async function clearCache(ctx: WorkspaceContext): Promise<number> {
    const bytes = await cacheBytes(ctx);
    const fs = ctx.services.get<FileSystemService>(Services.FileSystem);
    // Thumbnails through the service that draws them, so its memory of which ones exist goes too.
    await ctx.services.get<AssetsService>(Services.Assets).clearThumbnailCache();
    for (const segments of DERIVED_RUN_DIRECTORIES) {
        const directory = ctx.project.resolve(segments);
        const exists = await fs.isDirExists(directory);
        if (exists.ok && exists.data) await fs.deleteDir(directory);
    }
    return bytes;
}

// ── Scan and run ─────────────────────────────────────────────────────────────────────────────────

function countAvatars(ctx: WorkspaceContext, overwrite: boolean): number {
    return ctx.services.get<CharacterService>(Services.Character).listCharacter()
        .reduce((sum, character) => sum + planAutoFrame(character, overwrite).filter(item => !item.skip).length, 0);
}

export async function scanProjectCleanup(ctx: WorkspaceContext): Promise<ProjectCleanupScan> {
    const blueprints = Object.values(liveBlueprintDocument(ctx).blueprints);
    const stories = await loadedStories(ctx);
    const blockIds = storyBlockIds(stories);
    const lineIds = new Set(indexStoryTextLines(stories).keys());

    const localization = ctx.services.get<LocalizationService>(Services.Localization);
    const locales = await localization.loadAllDocuments();
    const orphanUnits = locales.reduce(
        (sum, locale) => sum + missingLineTranslationUnitIds(localization.unitsOf(locale) ?? {}, lineIds).length,
        0,
    );

    return {
        avatars: { unframed: countAvatars(ctx, false), all: countAvatars(ctx, true) },
        projectCache: { bytes: await cacheBytes(ctx), busy: cacheBusy(ctx) },
        blueprintLayout: { blueprints: blueprints.filter(blueprint => withFormattedLayout(blueprint) !== null).length },
        danglingNodes: { nodes: blueprints.reduce((sum, blueprint) => sum + (withoutDanglingNodes(blueprint)?.removed ?? 0), 0) },
        orphanComments: {
            threads: orphanCommentThreadIds(ctx.services.get<StoryCommentsService>(Services.StoryComments).listThreads(), blockIds).length,
        },
        orphanTranslations: { units: orphanUnits },
    };
}

/**
 * Run the selected tasks, the quick ones first and the avatars last: the model takes seconds per
 * picture and reports into the console on its own, so nothing waits on it.
 *
 * Everything is read again here rather than taken from the scan, which the author may have looked at
 * for a while: an edit made meanwhile is what gets cleaned.
 */
export async function runProjectCleanup(
    ctx: WorkspaceContext,
    selection: ProjectCleanupSelection,
    detect: HeadFrameDetector,
): Promise<ProjectCleanupOutcome> {
    const outcome: ProjectCleanupOutcome = {};
    const wants = (task: ProjectCleanupTask) => selection.tasks.has(task);

    if (wants("danglingNodes") || wants("blueprintLayout")) {
        let nodes = 0;
        let formatted = 0;
        for (const original of Object.values(liveBlueprintDocument(ctx).blueprints)) {
            let blueprint = original;
            let changed = false;
            if (wants("danglingNodes")) {
                const pruned = withoutDanglingNodes(blueprint);
                if (pruned) {
                    blueprint = pruned.blueprint;
                    nodes += pruned.removed;
                    changed = true;
                }
            }
            if (wants("blueprintLayout")) {
                const laid = withFormattedLayout(blueprint);
                if (laid) {
                    blueprint = laid;
                    formatted += 1;
                    changed = true;
                }
            }
            // One step per blueprint, pruning and layout together: undoing a layout that left the
            // removed nodes gone would put the other cards where they stood around a hole.
            if (changed) commitBlueprint(ctx, blueprint);
        }
        if (wants("danglingNodes")) outcome.danglingNodes = nodes;
        if (wants("blueprintLayout")) outcome.blueprintLayout = formatted;
    }

    if (wants("orphanComments") || wants("orphanTranslations")) {
        const stories = await loadedStories(ctx);
        if (wants("orphanComments")) {
            const comments = ctx.services.get<StoryCommentsService>(Services.StoryComments);
            const blockIds = storyBlockIds(stories);
            const orphans = orphanCommentThreadIds(comments.listThreads(), blockIds);
            outcome.orphanComments = comments.deleteThreads(orphans);
        }
        if (wants("orphanTranslations")) {
            const localization = ctx.services.get<LocalizationService>(Services.Localization);
            const lineIds = new Set(indexStoryTextLines(stories).keys());
            let removed = 0;
            for (const locale of await localization.loadAllDocuments()) {
                const remove = missingLineTranslationUnitIds(localization.unitsOf(locale) ?? {}, lineIds);
                if (remove.length > 0) {
                    localization.applyUnitEdits(locale, { set: {}, remove });
                    removed += remove.length;
                }
            }
            outcome.orphanTranslations = removed;
        }
    }

    if (wants("projectCache") && !cacheBusy(ctx)) {
        outcome.projectCache = await clearCache(ctx);
    }

    if (wants("avatars")) {
        const report = await runAutoFrame(ctx, { overwrite: selection.overwriteAvatars, detect, reveal: true });
        outcome.avatars = report.framed;
    }

    return outcome;
}
