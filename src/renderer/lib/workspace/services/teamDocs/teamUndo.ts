import {
    captureBefore,
    inverseOf,
    type LiveBefore,
    type LiveBeforeSources,
    type LiveInverseContext,
    type LiveInverseReason,
} from "@/lib/live/inverse";
import type { LiveDerived, LiveDocument, LiveEffect, LiveOp } from "@shared/live/ops";
import type { ProjectOp } from "@shared/authority/project";
import type { StoryDocument, StoryId, StoryLibraryEntry } from "@shared/types/story";
import type { TranslationKey } from "@shared/i18n";
import type { HistoryService } from "../history/HistoryService";
import type { HistoryCommandBody, HistoryLabel, HistoryScopeId } from "../history/historyModel";
import { DEFAULT_MERGE_WINDOW_MS } from "../history/historyModel";
import {
    blueprintHistoryScope,
    HistoryScopeKind,
    isHistoryScopeOf,
    projectHistoryScope,
    storySceneHistoryScope,
} from "../history/historyScopes";

/**
 * Undo and redo in a team project, for every document its server owns but the interface.
 *
 * ## Why this exists
 *
 * In a team project an edit does not land on this machine when it is made. The service that owns
 * the document hands the operation to the server and returns; the document changes when the
 * server's effect comes back, and that arrival is kept out of the undo stack, because an arrival may
 * be somebody else's edit. So everything the editors record outside a team project describes nothing
 * here: a scene snapshot taken around a row edit sees no change, the services skip their project-stack
 * steps "inside a session", and a restore - where one is attempted - is either refused (a scene) or
 * written into this copy alone, behind the server's back. Ctrl+Z did nothing anywhere.
 *
 * ## What a step is
 *
 * The same thing a live session's undo was (`@/lib/live/inverse`): **an operation that takes back
 * one of this window's own operations, sent through the same door.** When an effect of ours comes
 * back, what it is about to overwrite is read off the document immediately before it is applied -
 * the only moment that is knowable - and a step goes on the stack the author would press Ctrl+Z in:
 * the scene's for a row, the blueprint's for a node, the project's for everything else. Undo sends
 * the inverse; the step moves only when that inverse's own effect comes back (or is refused), so a
 * step the server turned down stays where it was.
 *
 * Three rules on top of the inverse:
 *
 *  - **A step is taken only while the records it wrote still read as it left them.** If somebody
 *    changed one since, its inverse would overwrite their change without anybody being told, so it
 *    is refused and kept. The same read that captures "before" captures "after", so the rule needs
 *    no per-operation code.
 *  - **One gesture, one step.** The operations a gesture sends in one turn (a split row is an update
 *    and an insert) land as one step, taken back last-first and put back first-last.
 *  - **A gesture that recorded a step of its own keeps it.** Search-and-replace and the rename
 *    refactor record steps that re-derive from the live document and write through the services, so
 *    they already work here; a second step for the same edit would make the author press twice.
 *
 * The interface document has its own (`ui-editor/uiTeamUndo.ts`), recorded where the edit is made,
 * and whole files are not operations at all - both are left alone here.
 */

/** Read off the document immediately before one of this window's effects is applied. */
export type TeamBefore =
    | { kind: "live"; before: LiveBefore | null }
    | { kind: "create-story" }
    | { kind: "delete-story"; entry: StoryLibraryEntry; document: StoryDocument }
    | { kind: "none" };

/** One effect of this window's, as a step holds it. */
type TeamRecord = {
    document: LiveDocument;
    op: ProjectOp;
    derived?: LiveDerived;
    before: TeamBefore;
    /** The records the effect wrote, read right after it (and the rest of its step) landed. */
    after: string;
};

/** Everything the undo reads, and nothing it needs to know how to reach. */
export type TeamUndoReaders = {
    /** What `captureBefore` reads, as the documents stand now. */
    sources(document: LiveDocument, op: LiveOp): LiveBeforeSources;
    /** What `inverseOf` reads, as the documents stand now. */
    context(document: LiveDocument): Omit<LiveInverseContext, "self" | "before">;
    /** One story's library entry, or undefined when there is no such story. */
    storyEntry(storyId: StoryId): StoryLibraryEntry | undefined;
    /** One story document, or null when it is not held. */
    story(storyId: StoryId): StoryDocument | null;
};

export type TeamUndoPorts = {
    /** This window's instance id: what `inverseOf` checks an effect's author against. */
    self: string;
    history: HistoryService;
    read: TeamUndoReaders;
    /**
     * Send one operation of a step to the server. Answers the id its effect will come back under, or
     * null when nothing can be sent (offline) - the step is then applied here, as an offline edit is.
     */
    send(document: LiveDocument, op: ProjectOp, derived?: LiveDerived): string | null;
    /** Apply one operation of a step to this window's copy, for when nothing can be sent. */
    applyLocally(document: LiveDocument, op: ProjectOp, derived?: LiveDerived): void;
    notify(title: string, detail: string): void;
    translate(key: TranslationKey): string;
    /** For tests: how long a step's answer may take before the step gives up. */
    answerTimeoutMs?: number;
};

/** The tag every team step carries, so the lot can be let go together. */
export const TEAM_UNDO_TAG = "team-undo";

const DEFAULT_ANSWER_TIMEOUT_MS = 15_000;
const NO_ANSWER = "the server did not answer";

/** The story operations that are about rows and scene contents: those step on the scene's stack. */
const SCENE_OPS = new Set([
    "insert-block",
    "insert-blocks",
    "update-block",
    "update-blocks",
    "delete-block",
    "delete-blocks",
    "move-block",
    "move-blocks",
    "set-block-disabled",
    "update-scene",
    "set-scene-snapshots",
    "set-scene-layers",
]);

/**
 * The operations whose inverse is "put the whole earlier record back": two of them in a row on the
 * same record fold into one step - the earlier record, the later effect - as typing into a field does
 * outside a team project. Read off `inverseOf`, case by case.
 */
const FOLDABLE_OPS = new Set([
    "update-block",
    "update-character",
    "update-variable",
    "set-translation",
    "set-take",
    "rename-scene",
    "rename-story",
    "rename-chapter",
    "update-scene",
    "update-app-tag",
    "update-dlc",
    "update-brand-color",
    "update-audio-track",
    "update-asset-set",
]);

/** The stack a step on this operation belongs on: where the author would press Ctrl+Z for it. */
export function teamUndoScope(document: LiveDocument, op: ProjectOp): HistoryScopeId {
    if (document.doc === "story" && SCENE_OPS.has(op.op)) {
        const sceneId = sceneOf(op);
        if (sceneId) {
            return storySceneHistoryScope(document.storyId, sceneId);
        }
    }
    if (document.doc === "ui-graphs" && op.op === "write-ui-graphs") {
        const ids = [...Object.keys(op.parts.graphs ?? {}), ...Object.keys(op.parts.blueprints ?? {})];
        if (ids.length > 0) {
            return blueprintHistoryScope(ids[0]);
        }
    }
    return projectHistoryScope();
}

/** The stacks whose snapshot entries a team server makes meaningless; see `HistoryService.setManagedScopes`. */
export function isTeamManagedScope(scopeId: HistoryScopeId): boolean {
    return (
        isHistoryScopeOf(scopeId, HistoryScopeKind.StoryScene)
        || isHistoryScopeOf(scopeId, HistoryScopeKind.Blueprint)
        || isHistoryScopeOf(scopeId, HistoryScopeKind.UISurface)
        || isHistoryScopeOf(scopeId, HistoryScopeKind.UIComponent)
    );
}

function sceneOf(op: ProjectOp): string | null {
    const fields = op as { sceneId?: unknown; edits?: ReadonlyArray<{ sceneId?: unknown }> };
    if (typeof fields.sceneId === "string") {
        return fields.sceneId;
    }
    const first = fields.edits?.[0]?.sceneId;
    return typeof first === "string" ? first : null;
}

function labelOf(document: LiveDocument): HistoryLabel {
    if (document.doc === "story") {
        return { key: "workspace.history.entry.storyEdit" as TranslationKey };
    }
    if (document.doc === "ui-graphs") {
        return { key: "workspace.history.entry.blueprintEdit" as TranslationKey };
    }
    return { key: "workspace.history.entry.edit" as TranslationKey };
}

/** The record a foldable operation is about, or null when it does not fold. */
function foldKey(document: LiveDocument, op: ProjectOp): string | null {
    if (!FOLDABLE_OPS.has(op.op)) {
        return null;
    }
    const { op: _verb, ...address } = op as Record<string, unknown>;
    // Everything but the new value: the ids and the locale, never the payload itself.
    const ids = Object.entries(address)
        .filter(([, value]) => typeof value === "string")
        .sort(([a], [b]) => a.localeCompare(b));
    return `team:${JSON.stringify(document)}:${op.op}:${JSON.stringify(ids)}`;
}

function canonical(value: unknown): string {
    return JSON.stringify(sortKeys(value)) ?? "null";
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        const entry = (value as Record<string, unknown>)[key];
        if (entry !== undefined) {
            out[key] = sortKeys(entry);
        }
    }
    return out;
}

function isLiveOp(op: ProjectOp): op is LiveOp {
    return op.op !== "create-story" && op.op !== "delete-story" && op.op !== "put-file";
}

/** Why a step was refused, in the author's words. */
function refusalDetail(reason: LiveInverseReason | "changed" | "pending" | "broken"): TranslationKey {
    switch (reason) {
        case "changed":
        case "scene-restored":
        case "chapter-restored":
        case "row-restored":
        case "container-filled":
        case "chapters-changed":
        case "character-restored":
        case "content-replaced":
        case "config-entry-restored":
        case "track-restored":
        case "set-restored":
        case "variable-restored":
        case "key-restored":
            return "workspace.history.team.changed" as TranslationKey;
        case "scene-gone":
        case "chapter-gone":
        case "row-gone":
        case "container-gone":
        case "anchor-gone":
        case "character-gone":
        case "asset-gone":
        case "config-entry-gone":
        case "track-gone":
        case "set-gone":
        case "variable-gone":
            return "workspace.history.team.gone" as TranslationKey;
        case "pending":
            return "workspace.history.team.pending" as TranslationKey;
        default:
            return "workspace.history.team.unavailable" as TranslationKey;
    }
}

class TeamUndoRefusal extends Error {}

/** The operations one gesture sent in one turn. */
type TeamIntentGroup = {
    /** Sent and not yet answered. */
    intents: Set<string>;
    /** How many command steps editors had recorded when the gesture began. */
    commandPushesAtStart: number;
    /** The gesture recorded a step of its own; see the module note. */
    covered: boolean;
    step: TeamUndoStep | null;
};

/** One step on a stack, as it moves between done and undone. */
class TeamUndoStep {
    /** How to read this step's current state: the effects that put it there, in the order they landed. */
    public records: TeamRecord[] = [];
    /** Set when a step could not be taken all the way and no longer knows where it stands. */
    public broken = false;
    /** A take in flight: undo or redo sent and not finished. */
    public moving = false;

    public constructor(public readonly group: TeamIntentGroup | null) {}

    public get pending(): boolean {
        return this.moving || (this.group !== null && this.group.intents.size > 0);
    }
}

export class TeamUndo {
    /** Intents of ordinary edits, by client id, with the gesture they belong to. */
    private readonly fresh = new Map<string, TeamIntentGroup>();
    /** Operations of a step in flight, by client id. */
    private readonly awaiting = new Map<string, { resolve: (record: TeamRecord) => void; reject: (error: Error) => void }>();
    private turn: TeamIntentGroup | null = null;

    public constructor(private readonly ports: TeamUndoPorts) {}

    /* ------------------------------------------------------------ what the sync calls */

    /**
     * One of this window's ordinary edits is being sent. Recorded with the other operations of the
     * same turn, unless it is an undo being applied (that edit IS a step) or a document this layer
     * leaves alone.
     */
    public intended(clientId: string, document: LiveDocument | { doc: string }): void {
        if (document.doc === "ui" || document.doc === "file" || this.ports.history.isRestoring()) {
            return;
        }
        let group = this.turn;
        if (group === null) {
            const started: TeamIntentGroup = {
                intents: new Set(),
                commandPushesAtStart: this.ports.history.getCommandPushCount(),
                covered: false,
                step: null,
            };
            group = started;
            this.turn = started;
            queueMicrotask(() => {
                // A step recorded by the gesture itself lands in the same turn, after the send.
                if (this.ports.history.getCommandPushCount() !== started.commandPushesAtStart) {
                    started.covered = true;
                }
                if (this.turn === started) {
                    this.turn = null;
                }
            });
        }
        group.intents.add(clientId);
        this.fresh.set(clientId, group);
    }

    /** Whether an effect with this client id is one this layer has to see applied. */
    public tracks(clientId: string): boolean {
        return this.fresh.has(clientId) || this.awaiting.has(clientId);
    }

    /** Read what the inverse of `op` will need. Call immediately before the effect is applied. */
    public before(document: LiveDocument, op: ProjectOp): TeamBefore {
        if (op.op === "create-story") {
            return { kind: "create-story" };
        }
        if (op.op === "delete-story" && document.doc === "story") {
            const entry = this.ports.read.storyEntry(document.storyId);
            const story = this.ports.read.story(document.storyId);
            return entry && story
                ? { kind: "delete-story", entry: structuredClone(entry), document: structuredClone(story) }
                : { kind: "none" };
        }
        if (!isLiveOp(op)) {
            return { kind: "none" };
        }
        return { kind: "live", before: captureBefore(op, this.ports.read.sources(document, op)) };
    }

    /** One of this window's effects has been applied. `before` is what {@link before} read for it. */
    public landed(clientId: string, effect: { document: LiveDocument; op: ProjectOp; derived?: LiveDerived }, before: TeamBefore): void {
        const record: TeamRecord = {
            document: effect.document,
            op: effect.op,
            ...(effect.derived === undefined ? {} : { derived: effect.derived }),
            before,
            after: "",
        };
        const waiter = this.awaiting.get(clientId);
        if (waiter) {
            this.awaiting.delete(clientId);
            waiter.resolve(record);
            return;
        }
        const group = this.fresh.get(clientId);
        if (!group) {
            return;
        }
        this.fresh.delete(clientId);
        group.intents.delete(clientId);
        if (group.covered) {
            return;
        }
        if (group.step) {
            group.step.records.push(record);
            this.refreshAfter(group.step);
            return;
        }
        const step = new TeamUndoStep(group);
        step.records.push(record);
        this.refreshAfter(step);
        group.step = step;
        const single = group.intents.size === 0 ? foldKey(effect.document, effect.op) : null;
        this.ports.history.pushCommand(teamUndoScope(effect.document, effect.op), {
            label: labelOf(effect.document),
            undo: () => this.take(step, "undo"),
            redo: () => this.take(step, "redo"),
            payload: step,
            fold: single ? incoming => this.fold(step, incoming) : undefined,
            mergeKey: single ?? undefined,
            mergeWindowMs: DEFAULT_MERGE_WINDOW_MS,
            tag: TEAM_UNDO_TAG,
            team: true,
        });
    }

    /** An operation of ours was refused or never reached the server. */
    public abandoned(clientId: string): void {
        const waiter = this.awaiting.get(clientId);
        if (waiter) {
            this.awaiting.delete(clientId);
            waiter.reject(new TeamUndoRefusal("the server refused the step"));
            return;
        }
        const group = this.fresh.get(clientId);
        if (group) {
            this.fresh.delete(clientId);
            group.intents.delete(clientId);
        }
    }

    /**
     * Say whether the server owns the documents now. While it does, the editors' stacks take only
     * team steps; while it does not (offline), edits land here and the editors record their own -
     * which a reconnection lets go again, since those edits are replayed to the server. The team's
     * steps stay through both: offline, a step is applied here as an offline edit is.
     */
    public setActive(active: boolean): void {
        this.ports.history.setManagedScopes(active ? isTeamManagedScope : null);
    }

    /** Forget every step: the documents were replaced (a restore, a new connection's base). */
    public reset(): void {
        for (const waiter of this.awaiting.values()) {
            waiter.reject(new TeamUndoRefusal("the documents were replaced"));
        }
        this.awaiting.clear();
        this.fresh.clear();
        this.turn = null;
        this.ports.history.dropTaggedEverywhere(TEAM_UNDO_TAG);
    }

    /* ------------------------------------------------------------ taking a step */

    private fold(step: TeamUndoStep, incoming: HistoryCommandBody): boolean {
        const next = incoming.payload;
        if (!(next instanceof TeamUndoStep) || step.pending || step.broken || step.records.length !== 1 || next.records.length !== 1) {
            return false;
        }
        const [earlier] = step.records;
        const [later] = next.records;
        if (foldKey(earlier.document, earlier.op) !== foldKey(later.document, later.op)) {
            return false;
        }
        step.records = [{ ...later, before: earlier.before }];
        return true;
    }

    /**
     * Undo (or redo) one step: invert its records last-first, each sent and seen landing before the
     * next is worked out, since an inverse is decided against the document the previous one left.
     *
     * Throws - which keeps the step where it is - when it cannot even begin; answers a promise the
     * history service waits on otherwise, and a failure part way leaves the step `broken` rather
     * than guessing where it stands.
     */
    private take(step: TeamUndoStep, direction: "undo" | "redo"): Promise<void> | void {
        if (step.pending) {
            this.refuse(direction, "pending");
        }
        if (step.broken) {
            this.refuse(direction, "broken");
        }
        for (const record of step.records) {
            if (this.readAfter(record) !== record.after) {
                this.refuse(direction, "changed");
            }
        }
        const queue = [...step.records].reverse();
        const first = this.inverse(queue[0]);
        if ("impossible" in first) {
            this.refuse(direction, first.impossible);
        }
        step.moving = true;
        const landed: TeamRecord[] = [];
        const run = async () => {
            try {
                let next: TeamInverse = first;
                for (let index = 0; index < queue.length; index += 1) {
                    if (index > 0) {
                        next = this.inverse(queue[index]);
                    }
                    if ("impossible" in next) {
                        throw new TeamUndoRefusal(next.impossible);
                    }
                    landed.push(await this.send(next));
                }
                step.records = landed;
                this.refreshAfter(step);
            } catch (error) {
                if (landed.length > 0) {
                    step.broken = true;
                }
                if (error instanceof TeamUndoRefusal && error.message in REASON_MARK) {
                    this.notifyRefusal(direction, error.message as LiveInverseReason);
                } else if (error instanceof TeamUndoRefusal && error.message === NO_ANSWER) {
                    this.notifyRefusal(direction, "broken");
                }
                // A refusal by the server is reported by the sync, in the server's own words.
                throw error;
            } finally {
                step.moving = false;
            }
        };
        return run();
    }

    private inverse(record: TeamRecord): TeamInverse {
        const { document, op, before } = record;
        if (op.op === "create-story" && document.doc === "story") {
            return this.ports.read.storyEntry(document.storyId)
                ? { document, op: { op: "delete-story" } }
                : { impossible: "scene-gone" };
        }
        if (op.op === "delete-story" && document.doc === "story") {
            if (before.kind !== "delete-story") {
                return { impossible: "no-record" };
            }
            if (this.ports.read.storyEntry(document.storyId)) {
                return { impossible: "scene-restored" };
            }
            return { document, op: { op: "create-story", entry: structuredClone(before.entry), document: structuredClone(before.document) } };
        }
        if (!isLiveOp(op) || before.kind !== "live") {
            return { impossible: "no-record" };
        }
        const effect = { kind: "effect", by: this.ports.self, seq: 0, document, op } as unknown as LiveEffect;
        const answer = inverseOf(effect, { ...this.ports.read.context(document), self: this.ports.self, before: before.before });
        if ("impossible" in answer) {
            return { impossible: answer.impossible };
        }
        // Carried where the inverse puts rows back, as a live session carried it: the translations and
        // takes that came with a pasted row go back with it.
        const derived = answer.op.op === "insert-block" || answer.op.op === "insert-blocks" ? record.derived : undefined;
        return { document, op: answer.op, ...(derived === undefined ? {} : { derived }) };
    }

    /** Send one inverse and wait for its effect - or apply it here when nothing can be sent. */
    private send(inverse: { document: LiveDocument; op: ProjectOp; derived?: LiveDerived }): Promise<TeamRecord> {
        const clientId = this.ports.send(inverse.document, inverse.op, inverse.derived);
        if (clientId === null) {
            const before = this.before(inverse.document, inverse.op);
            this.ports.applyLocally(inverse.document, inverse.op, inverse.derived);
            return Promise.resolve({ ...inverse, before, after: "" });
        }
        return new Promise<TeamRecord>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.awaiting.delete(clientId)) {
                    reject(new TeamUndoRefusal(NO_ANSWER));
                }
            }, this.ports.answerTimeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS);
            this.awaiting.set(clientId, {
                resolve: record => {
                    clearTimeout(timer);
                    resolve(record);
                },
                reject: error => {
                    clearTimeout(timer);
                    reject(error);
                },
            });
        });
    }

    /** Re-read what every record of a step left, now that the step has finished landing. */
    private refreshAfter(step: TeamUndoStep): void {
        for (const record of step.records) {
            record.after = this.readAfter(record);
        }
    }

    /**
     * The records an effect wrote, as the documents hold them now. The same read `captureBefore` makes,
     * so "is it still as I left it" needs no per-operation code; an insert reads the rows it put in.
     */
    private readAfter(record: TeamRecord): string {
        const { document, op } = record;
        if (document.doc === "story" && (op.op === "create-story" || op.op === "delete-story")) {
            return canonical(this.ports.read.storyEntry(document.storyId) ? "present" : "absent");
        }
        if (!isLiveOp(op)) {
            return "";
        }
        if (document.doc === "story" && (op.op === "insert-block" || op.op === "insert-blocks")) {
            const scene = this.ports.read.story(document.storyId)?.scenes[op.sceneId];
            const ids = op.op === "insert-block" ? [op.block.id] : op.inserts.map(insert => insert.block.id);
            return canonical(ids.map(id => scene?.blocks[id] ?? null));
        }
        return canonical(captureBefore(op, this.ports.read.sources(document, op)));
    }

    private refuse(direction: "undo" | "redo", reason: LiveInverseReason | "changed" | "pending" | "broken"): never {
        this.notifyRefusal(direction, reason);
        throw new TeamUndoRefusal(reason);
    }

    private notifyRefusal(direction: "undo" | "redo", reason: LiveInverseReason | "changed" | "pending" | "broken"): void {
        const title = direction === "undo" ? "workspace.history.team.undoRefused" : "workspace.history.team.redoRefused";
        this.ports.notify(this.ports.translate(title as TranslationKey), this.ports.translate(refusalDetail(reason)));
    }
}

type TeamInverse = { document: LiveDocument; op: ProjectOp; derived?: LiveDerived } | { impossible: LiveInverseReason };

/** The refusals worth telling the author about when a later operation of a step turns out impossible. */
const REASON_MARK: Record<string, true> = Object.fromEntries(
    [
        "no-record", "scene-gone", "scene-restored", "chapter-gone", "chapter-restored", "row-gone", "row-restored",
        "container-gone", "anchor-gone", "container-filled", "subtree-lost", "chapters-changed", "character-gone",
        "character-restored", "asset-gone", "content-replaced", "config-entry-gone", "config-entry-restored",
        "track-gone", "track-restored", "set-gone", "set-restored", "variable-gone", "variable-restored", "key-restored",
    ].map(reason => [reason, true as const]),
);
