import type { TranslationKey } from "@shared/i18n/catalog";
import type {
  GameTestEvent,
  GameTestExit,
  GameTestExitReason,
  GameTestLogLevel
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
 *    are the same set by construction.
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
 */
export const TEST_PROTOCOL_VERSION = 1;

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
  "custom"
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

export const TEST_CAPABILITIES: readonly TestCapability[] = [
  "project.read",
  "game.launch"
] as const;

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
  info: 2
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
  "errored"
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
  /** A frozen workspace (VCS revision view or a manual freeze) forbids launching a game. */
  readonly frozen: boolean;
};

export type TestAvailability =
  | { available: true }
  /** Greys the row out and says why. Not an error: an unavailable test is a normal state. */
  | { available: false; reason: TestText };

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
   * Evaluated when the picker opens, so keep it synchronous and cheap. Absent means always
   * available; the host still applies its own gates (a `windowed` test is unavailable while the
   * workspace is frozen no matter what this returns).
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
