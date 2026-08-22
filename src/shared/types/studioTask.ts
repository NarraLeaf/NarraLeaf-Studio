/**
 * Work Studio does on the author's behalf that takes long enough to be noticed.
 *
 * Three subsystems had already invented this idea separately — a build, a media conversion and a
 * weather bake each grew a `start` / `cancel` / `getStatus` triple, its own snapshot shape, its own
 * status vocabulary and its own set of IPC events. They are the same thing: a named unit of work
 * that runs somewhere the author is not looking, can fail, may be cancellable, and has to be able to
 * say what it is doing when the app pauses because of it.
 *
 * This is that thing, said once.
 *
 * ## The rules the shape enforces
 *
 * **Progress may be absent, and absent is a legitimate answer.** A task that cannot honestly measure
 * itself reports `null` rather than a number nobody derived. This is not fastidiousness: the media
 * pipeline learned it from a conversion that stopped at 72% and was finished, and from image
 * conversions that have no duration at all. A bar that lies is worse than no bar.
 *
 * **Completion is the status, never the counter.** `done === total` is a coincidence a task is
 * allowed to reach early and sit at.
 *
 * **The executor never writes a sentence.** A task reports its kind and its numbers; the words an
 * author reads are chosen where the translations live. Main has no business composing UI copy, and a
 * localized string travelling over IPC is a locale baked into a process that does not know which one
 * the window is showing.
 *
 * ## Why priority is part of the vocabulary and not a caller's private business
 *
 * The reason this concept exists rather than a queue: Studio wants to do some of this work
 * *speculatively*, before anyone asks, so the moment they do ask it is already done. That is only
 * safe if speculative work can be told apart from work someone is waiting on — otherwise a
 * background bake started while the author was typing is indistinguishable from the one that starts
 * when they press Run, and Run waits behind it.
 *
 * So a task is submitted at one of two urgencies, and the same work submitted twice is one task: an
 * idle task that someone starts waiting on is PROMOTED rather than queued again. That single rule is
 * what makes pre-baking free — the worst case is that the wait was already half over.
 */

export type StudioTaskId = string;

/**
 * What kind of work this is.
 *
 * A closed set rather than free text, because the renderer turns it into words and an unknown kind
 * would have none. Adding one is a member here plus a translation.
 */
export const STUDIO_TASK_KINDS = ["weatherBake"] as const;

export type StudioTaskKind = (typeof STUDIO_TASK_KINDS)[number];

/**
 * Where a task is in its life.
 *
 * `queued` is distinct from `running` because only one heavy task runs at a time — they contend for
 * the same cores, and two at once finish neither sooner — so a submitted task genuinely waits, and a
 * readout that called that "running" would be describing a hope.
 */
export type StudioTaskStatus = "queued" | "running" | "done" | "error" | "cancelled";

/**
 * How much of a task is behind it.
 *
 * `unit` names what is being counted so a reader can be told "3 of 5 clips" rather than a bare
 * fraction, and so two tasks counting different things are never summed.
 */
export type StudioTaskProgress = {
    done: number;
    total: number;
    unit: "clip" | "frame" | "file" | "step";
};

/**
 * Urgency, which is the whole point of the concept.
 *
 * - `idle`: nobody is waiting. Studio decided to do this early so that later is faster. It runs when
 *   nothing more urgent is queued, and it is the only kind of task that may be started without the
 *   author having asked for anything.
 * - `blocking`: somebody is waiting — a run, a build, a preview. It goes to the front, and if the
 *   same work is already running at `idle` it is simply adopted, because a bake half-finished
 *   speculatively is a bake half-finished.
 */
export type StudioTaskPriority = "idle" | "blocking";

export type StudioTaskSnapshot = {
    id: StudioTaskId;
    kind: StudioTaskKind;
    status: StudioTaskStatus;
    priority: StudioTaskPriority;
    /** Null when the task cannot honestly measure itself. Never a guess. */
    progress: StudioTaskProgress | null;
    /**
     * One sentence for the log and for a caller that has to explain a failure, in English.
     *
     * Not what the author reads: the words in front of them come from the kind and the numbers,
     * translated where the catalogues are. This is the detail underneath that, and it is present
     * only on `error`.
     */
    error?: string;
};

/**
 * What the app is doing right now, in one value.
 *
 * The status bar shows Studio's state rather than a list of jobs: an author waiting on their project
 * is waiting on one thing at a time, and a strip that grew a cell per task would describe the
 * implementation. `queued` is carried so a readout can say there is more behind this one without
 * enumerating it.
 */
export type StudioTaskOverview = {
    /** The task being worked on, or null when nothing is. */
    active: StudioTaskSnapshot | null;
    /** How many more are waiting behind it, `active` excluded. */
    queued: number;
    /**
     * Whether anything is being waited ON, as opposed to merely being done early.
     *
     * The difference the author can feel: blocking work is why the app has paused, and speculative
     * work is why it will not pause later. A surface may reasonably show one and stay quiet about
     * the other.
     */
    blocking: boolean;
};

export const EMPTY_STUDIO_TASK_OVERVIEW: StudioTaskOverview = {
    active: null,
    queued: 0,
    blocking: false,
};

/**
 * Who is asking, when the asker is allowed to change its mind.
 *
 * The key says what the work IS, and that is what makes two callers wanting the same clip one task.
 * It deliberately says nothing about WHO wanted it, which is fine right up until somebody stops —
 * and stopping is not an edge case. Editing a number is not one decision but one per keystroke: a
 * density typed as `120` lands as 1, then 12, then 120, and each of those is a different document
 * describing a different clip. Without a way to say "that was me, and I have moved on", every one of
 * them is a bake that runs to completion for a number the author has already typed over, with the
 * one they actually want queued behind the lot.
 *
 * So a caller may name itself. `owner` is the standing asker — this project's speculation, this Dev
 * Mode session — and `attempt` is which of its asks this is: one settle pass, one compile. An owner
 * has exactly one live attempt, so submitting under a new one says in the same breath what it wants
 * now and that whatever else it asked for it no longer does.
 *
 * ## What a claim can never do
 *
 * Reach work somebody else is waiting on. A claim is an interest, not ownership: dropping it drops
 * that owner's interest and nothing more, and the task ends only when the last interest in it does.
 * A clip a Dev Mode session abandons but a build still needs goes on being baked.
 */
export type StudioTaskClaim = {
    /** The standing caller. Stable across attempts — it is the thing that changes its mind. */
    owner: string;
    /** Which ask this is. Whatever the owner asked for under a different one is no longer wanted. */
    attempt: string;
};
