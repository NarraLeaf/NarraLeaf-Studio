import type { TranslationKey } from "@shared/i18n/catalog";
import type {
    GameTestChoiceOption,
    GameTestCommand,
    GameTestEvent,
    GameTestExit,
    GameTestExitReason,
    GameTestLogLevel,
} from "@shared/types/gameTest";
import type { SearchJumpTarget } from "../workspace/services/search/searchIndexModel";

/**
 * The test pipeline - the vocabulary.
 *
 * "Test" here means a check an author runs against *their game*: does it reach an ending, does it
 * survive with no network, does a plugin's feature still behave. It is not vitest; nothing in this
 * file has anything to do with the repo's own unit tests.
 *
 * A test is a definition object in a registry that both Studio's built-in modules and plugins
 * populate (see `registry.ts`), started from Run > Test. Five decisions are load-bearing and worth
 * knowing before editing anything here:
 *
 *  - **A test may only say passed / failed / skipped.** `cancelled` and `errored` are verdicts the
 *    *host* reaches about a test, and a test that could claim them could lie about being killed.
 *    Cancellation arrives as `ctx.signal`; a test that wants "the author aborted me" to count as a
 *    failure is free to catch it and return `failed`, which is how a windowed test whose contract is
 *    "close the window when satisfied" expresses termination.
 *  - **Undeclared capabilities are absent, not throwing.** `requires` is the whole truth about what
 *    a test can reach: `ctx.game` is `undefined` unless `game.launch` was declared, exactly as
 *    `app.game`'s domains work for runtime plugins. What the picker lists and what the test can do
 *    are the same set by construction. `parameters` obeys the same rule from the other direction:
 *    `ctx.parameters` carries a value for every id the test *declared* and for no other, so it is a
 *    resolved set rather than a free-form bag the picker could put anything into.
 *  - **Tests never build prose.** Every author-visible string is a `TestText` - an i18n key for
 *    Studio's own tests, a literal for a plugin's (a plugin has no `TranslationKey`s, and its own
 *    translator produces plain strings). The console channel and the report tab each render it.
 *  - **Severity is on the finding, unlike lint.** A lint rule defers severity to the project's
 *    config; a test has no such table, and its verdict is stated separately by `run`. A finding here
 *    is evidence for a verdict the test already reached, so it carries its own weight.
 *  - **`presentation` is a declaration, not a mechanism.** Whether a window appears is a consequence
 *    of asking the host for a game session. The field is what the picker badges and what lets the
 *    author know a window is about to open; a headless test that launches one is a host error.
 */

/**
 * Bumped when a change here would break an already-published plugin.
 *
 * Recorded on every run record so a report kept across an upgrade still says which contract produced
 * it, and surfaced to plugins so a definition can refuse a host older than it needs.
 *
 * **2** added parameters: a test may declare values the author supplies before pressing Start
 * (`TestDefinition.parameters`), and every run context now carries `parameters` - a required member,
 * which is what makes this a break rather than an addition. A definition compiled against 1 keeps
 * working unchanged, since declaring none resolves to `{}`.
 */
export const TEST_PROTOCOL_VERSION = 2;

/**
 * Stable identifier. Studio's own tests are `narraleaf-studio:<slug>`; a plugin's must be prefixed
 * with its plugin id, which the host enforces at registration rather than trusting.
 */
export type TestId = string;

/** Grouping in the picker. `custom` is where a plugin lands when it claims nothing else. */
export type TestCategory = "integrity" | "runtime" | "compatibility" | "custom";

/** Fixed presentation (and sort) order of categories. */
export const TEST_CATEGORY_ORDER: readonly TestCategory[] = [
    "integrity",
    "runtime",
    "compatibility",
    "custom",
] as const;

/**
 * Does this test put a game window on screen?
 *
 * `headless` is the interesting half: a test with no window can run while the author keeps working,
 * and is the only kind that can run on a frozen workspace.
 */
export type TestPresentation = "headless" | "windowed";

/**
 * What the host lends a test. Anything not declared is absent from `TestRunContext`.
 *
 * Deliberately coarse and short. A capability is added here only when a test genuinely cannot be
 * written without it - the failure mode this vocabulary exists to prevent is the one where a narrow
 * API is nominally narrow but hands out a reference that reaches everything.
 */
export type TestCapability =
    /** Read the project's stories and scenes. Read-only by construction: there is no write half. */
    | "project.read"
    /** Launch, observe and stop a game process. Implies a window unless the launch asks otherwise. */
    | "game.launch";

export const TEST_CAPABILITIES: readonly TestCapability[] = ["project.read", "game.launch"] as const;

/**
 * An author-visible string.
 *
 * Two shapes rather than one, because the two producers genuinely differ: Studio's tests name a key
 * in its catalogue and must re-render when the editor language changes, while a plugin has no key
 * space of its own and hands over whatever its own translator already produced.
 */
export type TestText =
    | { key: TranslationKey; params?: Record<string, string | number>; text?: undefined }
    | { text: string; key?: undefined };

/** Same ladder as the workspace console, so a test log line needs no translation at the boundary. */
export type TestLogLevel = GameTestLogLevel;

export type TestLogEntry = {
    level: TestLogLevel;
    message: TestText;
    /** Milliseconds since epoch, stamped by the host when the line is accepted. */
    timestamp: number;
};

/**
 * Progress, or `null` to go back to indeterminate.
 *
 * `total` is optional because most interesting tests genuinely do not know it up front (how many
 * routes a story has is what walking it discovers). Omitting it renders the same indeterminate bar
 * the build uses rather than a fake fraction.
 */
export type TestProgress = {
    completed: number;
    total?: number;
    label?: TestText;
};

export type TestFindingSeverity = "error" | "warning" | "info";

/** One piece of evidence. `target` reuses the global-search navigation layer, so the report tab's click-to-jump is existing machinery. */
export type TestFinding = {
    severity: TestFindingSeverity;
    message: TestText;
    target?: SearchJumpTarget;
};

/** Error first, info last - the order findings are reported and rendered in. */
export const TEST_FINDING_SEVERITY_ORDER: Record<TestFindingSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
};

/**
 * What `run` may return. Note the absence of `cancelled` and `errored`: see the header.
 *
 * `skipped` exists so a test can decline for a reason it only discovers while running (a project
 * with no localisation configured, say) without pretending to have passed. A test that can tell
 * before it starts should say so from `checkAvailability` instead, so the picker greys it out.
 */
export type TestVerdict =
    | { status: "passed"; summary?: TestText }
    | { status: "failed"; summary: TestText }
    | { status: "skipped"; summary: TestText };

/** Every state a run record can be in: what a test may claim, plus the three the host owns. */
export type TestRunStatus = TestVerdict["status"] | "running" | "cancelled" | "errored";

/** Terminal states, for the report tab's verdict banner and the status bar. */
export const TEST_TERMINAL_STATUSES: readonly TestRunStatus[] = [
    "passed",
    "failed",
    "skipped",
    "cancelled",
    "errored",
] as const;

// ---------------------------------------------------------------------------
// Capability handles
// ---------------------------------------------------------------------------

export type TestStoryRef = { id: string; name: string };
export type TestSceneRef = { id: string; name: string };

/**
 * `project.read`.
 *
 * Intentionally thin in v1 - it is the read half of the story service a plugin already has, and no
 * more. This is the protocol's designated extension point: a test that needs the scene *graph*
 * (route reachability, dead ends) needs a shape added here, and adding it is a protocol change with
 * a version bump rather than something a test reaches around.
 *
 * Studio's own built-in tests do not go through this handle at all; they are registered from inside
 * the workspace and close over its context directly, the same way `builtInPanels` differ from
 * `services.ui.panels`. This handle exists so a *plugin* has a bounded way in.
 */
export type TestProjectHandle = {
    readonly projectPath: string;
    listStories(): Promise<TestStoryRef[]>;
    listScenes(storyId: string): Promise<TestSceneRef[]>;
};

/**
 * How a game process ended, and what it said on the way out.
 *
 * These are the wire shapes from `@shared/types/gameTest`, re-exported under the names an author
 * touches. The distinction they carry is the whole reason the pipeline needed main-process work:
 * before it, a crashed preview and an author closing the window were the same event to Studio (an
 * exit logged at `verbose`, status polled back to `idle`). A test whose pass condition is "the
 * author closed the window" cannot be written without it.
 */
export type TestGameExitReason = GameTestExitReason;
export type TestGameExit = GameTestExit;
export type TestGameEvent = GameTestEvent;
export type TestGameChoiceOption = GameTestChoiceOption;
/**
 * What a test may ask a running game to do.
 *
 * Deliberately short, and every member is something a player does with a pointer: the game is driven
 * along a path a player could take, never moved by hand. A command that reached past the game would
 * make the run evidence about the harness rather than about the game.
 */
export type TestGameCommand = GameTestCommand;

export type TestGameLaunchOptions = {
    /**
     * `"blocked"` starts the game with no network access at all - the host applies it to the
     * launched process, so a game that reaches for the network fails there rather than in a mock.
     */
    network?: "allow" | "blocked";
};

export type TestGameSession = {
    readonly id: string;
    /** Returns an unsubscribe. Events emitted before the first listener are replayed to it. */
    onEvent(listener: (event: TestGameEvent) => void): () => void;
    /**
     * Ask the game to do something: start a story, advance a line, pick an option.
     *
     * Resolves `true` when the command reached the game and `false` when it could not - a session
     * that has already exited, or one whose game never opened its control channel. It never says the
     * game *did* it: the game is a separate process, and what happened comes back through
     * {@link onEvent} like everything else it says. A test that needs to know waits for the
     * observation, and treats one that never arrives as the answer it is.
     */
    sendCommand(command: TestGameCommand): Promise<boolean>;
    /** Resolves once the process is gone, whatever the reason. Safe to call more than once. */
    waitForExit(): Promise<TestGameExit>;
    /** Graceful shutdown, then force. Resolves when the process is gone. */
    stop(): Promise<void>;
};

/**
 * `game.launch`.
 *
 * One session at a time per run: the host refuses a second `launch()` while one is alive, because
 * two preview processes contend for the same compiled artifact directory and the second would
 * silently win.
 */
export type TestGameHandle = {
    launch(options?: TestGameLaunchOptions): Promise<TestGameSession>;
};

// ---------------------------------------------------------------------------
// Run context
// ---------------------------------------------------------------------------

export type TestRunContext = {
    readonly runId: string;
    readonly protocolVersion: typeof TEST_PROTOCOL_VERSION;
    /**
     * Aborted when the author cancels. A test that ignores it is killed anyway once its promise
     * settles, but its findings are kept - a cancelled run is still evidence.
     */
    readonly signal: AbortSignal;
    /**
     * What the author chose, keyed by parameter id.
     *
     * Resolved by the host from the declarations, never passed through from the picker: an id the
     * test did not declare is dropped, and a value the declaration cannot account for (an option
     * that has since disappeared) falls back to the default. So a test reads its own vocabulary and
     * nothing else, and `{}` for a test that declares none.
     */
    readonly parameters: TestParameterValues;
    log(level: TestLogLevel, message: TestText): void;
    progress(progress: TestProgress | null): void;
    report(finding: TestFinding): void;
    /** Present iff `project.read` was declared. */
    readonly project?: TestProjectHandle;
    /** Present iff `game.launch` was declared. */
    readonly game?: TestGameHandle;
};

/** Everything `checkAvailability` is allowed to look at - deliberately cheap, it runs on every picker open. */
export type TestAvailabilityContext = {
    readonly projectPath: string;
    /**
     * Whether a freeze that forbids launching a game is in force - a revision view, a manual
     * freeze, an open merge, recovery mode.
     *
     * False during a live session even though the workspace IS frozen: what a session shows every
     * participant is the working tree, so a game launched from it runs what everybody is looking at
     * and there is nothing for the refusal to protect.
     */
    readonly frozen: boolean;
    /**
     * Whether this project is one Studio will not run anything for - it arrived from a package or a
     * remote source and nobody has vouched for it yet.
     *
     * Passed in for the reason above and one more of its own: the ledger that answers it lives in
     * the main process, so asking costs a round trip, and everything here is synchronous. The host
     * settles the answer when the workspace comes up and hands the settled copy down.
     *
     * `checkAvailability` will not normally see this true - the host refuses every test before it
     * asks a definition anything, because a run is an execution of the project. It is here because
     * `options` is *not* gated: a list that would cost real work to build can decline to build it
     * for a project that cannot run it.
     */
    readonly distrusted: boolean;
};

export type TestAvailability =
    | { available: true }
    /** Greys the row out and says why. Not an error: an unavailable test is a normal state. */
    | { available: false; reason: TestText };

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/**
 * One row of a `select` parameter's list.
 *
 * `value` is what the test reads and what is remembered on disk; `label` is what the author picks
 * from. They are separate because the label is a display string that follows the editor language
 * while the value has to survive a language switch and a Studio upgrade unchanged.
 */
export type TestParameterOption = { value: string; label: TestText };

/** A parameter the author answers by picking from a list. */
export type TestSelectParameterDefinition = {
    id: string;
    kind: "select";
    label: TestText;
    /** One clause about what the value selects, if it needs one. Not a sentence explaining the UI. */
    description?: TestText;
    /**
     * The list to offer, evaluated when the picker opens.
     *
     * Same contract as `checkAvailability`, and for the same reason: it runs on every open, so keep
     * it synchronous, cheap and free of side effects. It is handed the same context, so a list can
     * depend on the project without the definition holding a workspace of its own.
     *
     * **An empty list is a real answer**, not a failure - a project with no endings yet has nothing
     * to walk to. The host treats it as one: the whole test is greyed out naming this parameter,
     * rather than offering a dropdown with nothing in it and a Start that cannot work.
     */
    options(ctx: TestAvailabilityContext): TestParameterOption[];
    /**
     * Which option to start on. Falls back to the first option when absent, and also when it names
     * an option that is not in the list any more.
     */
    defaultValue?: string;
};

/** A parameter the author answers with a switch. */
export type TestBooleanParameterDefinition = {
    id: string;
    kind: "boolean";
    label: TestText;
    /** One clause about what the value selects, if it needs one. Not a sentence explaining the UI. */
    description?: TestText;
    /** Absent means off. */
    defaultValue?: boolean;
};

export type TestParameterDefinition = TestSelectParameterDefinition | TestBooleanParameterDefinition;

/** What one parameter resolves to. A `select` resolves to the chosen option's `value`. */
export type TestParameterValue = string | boolean;

/**
 * Resolved parameter values, keyed by parameter id.
 *
 * Only ids the test declared are present - see the header. A test that declares none is handed an
 * empty object, never `undefined`, so reading `ctx.parameters` needs no guard.
 */
export type TestParameterValues = Readonly<Record<string, TestParameterValue>>;

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export type TestDefinition = {
    id: TestId;
    title: TestText;
    description?: TestText;
    category?: TestCategory;
    presentation: TestPresentation;
    /** Omitted means "nothing" - a pure computation over what it was given. */
    requires?: readonly TestCapability[];
    /**
     * Values the author supplies before pressing Start, drawn as a row of controls in the picker and
     * handed to `run` as `ctx.parameters`.
     *
     * Omitted means the test needs none, which is every test that existed before this: select it,
     * press Start. Two parameters with the same id are one parameter - the first declaration wins,
     * because the resolved values are keyed by id and two rows writing one key could not both be
     * shown honestly.
     */
    parameters?: readonly TestParameterDefinition[];
    /**
     * Evaluated when the picker opens, so keep it synchronous and cheap. Absent means always
     * available; the host still applies its own gates (a `windowed` test is unavailable while the
     * workspace is frozen, and no test runs at all in a project that is not trusted, no matter what
     * this returns).
     */
    checkAvailability?(ctx: TestAvailabilityContext): TestAvailability;
    run(ctx: TestRunContext): Promise<TestVerdict> | TestVerdict;
};

/**
 * A definition plus who put it in the registry.
 *
 * `ownerPluginId` is assigned by the host from the registering plugin's identity - never read off
 * the definition, which a plugin controls.
 */
export type RegisteredTest = {
    definition: TestDefinition;
    ownerPluginId?: string;
};

// ---------------------------------------------------------------------------
// Run record
// ---------------------------------------------------------------------------

export type TestRunRecord = {
    runId: string;
    testId: TestId;
    /** Snapshotted at start: the definition can be unregistered by a plugin reload mid-run. */
    title: TestText;
    ownerPluginId?: string;
    protocolVersion: number;
    /**
     * What the run was told, snapshotted at start like `title`.
     *
     * A verdict is only readable against the input that produced it: "reached the ending" means
     * nothing a week later unless the report still says which ending. Empty for a test that declares
     * no parameters.
     */
    parameters: TestParameterValues;
    status: TestRunStatus;
    startedAt: number;
    finishedAt?: number;
    summary?: TestText;
    findings: TestFinding[];
    log: TestLogEntry[];
    progress: TestProgress | null;
    /** Set when `status` is `errored`: the thrown value, stringified. */
    error?: string;
};

export type TestRunCounts = Record<TestFindingSeverity, number>;

export function countTestFindings(findings: readonly TestFinding[]): TestRunCounts {
    const counts: TestRunCounts = { error: 0, warning: 0, info: 0 };
    for (const finding of findings) {
        counts[finding.severity] += 1;
    }
    return counts;
}

/**
 * `narraleaf-studio:project-diagnostics` -> `projectDiagnostics`.
 *
 * Built-in tests name their i18n keys after this, and the registry test asserts each literal slug
 * equals what this derives - so a renamed id cannot leave dead keys behind. Mirrors
 * `deriveLintRuleSlug`.
 */
export function deriveBuiltInTestSlug(id: TestId): string {
    const local = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
    const words = local.split(/[/\-_.]/).filter(Boolean);
    return words
        .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
        .join("");
}
