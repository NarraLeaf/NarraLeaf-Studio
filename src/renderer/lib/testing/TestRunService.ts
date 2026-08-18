import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n/catalog";
import type { GameTestEventPayload } from "@shared/types/gameTest";
import { listSceneIdsInDocumentOrder } from "@shared/types/story/order";
import { Service } from "../workspace/services/Service";
import {
  Services,
  type ITestRunService,
  type WorkspaceContext
} from "../workspace/services/services";
import type { ConsoleService } from "../workspace/services/core/ConsoleService";
import type { WorkspaceFreezeService } from "../workspace/services/core/WorkspaceFreezeService";
import type { StoryService } from "../workspace/services/story/StoryService";
import { EventEmitter } from "../workspace/services/ui/EventEmitter";
import { testRegistry } from "./registry";
import { formatTestText } from "./testText";
import {
  TEST_PROTOCOL_VERSION,
  type RegisteredTest,
  type TestAvailability,
  type TestDefinition,
  type TestFinding,
  type TestFindingSeverity,
  type TestGameEvent,
  type TestGameExit,
  type TestGameHandle,
  type TestGameLaunchOptions,
  type TestGameSession,
  type TestId,
  type TestLogLevel,
  type TestProgress,
  type TestProjectHandle,
  type TestRunContext,
  type TestRunRecord,
  type TestRunStatus,
  type TestSceneRef,
  type TestStoryRef,
  type TestText
} from "./types";

/**
 * The run controller: one registry, one run slot, one session's history.
 *
 * Everything a test cannot be trusted with lives here. A test states a verdict out of three
 * (ruling R4); `cancelled` and `errored` are reached *about* it. A test reaches a capability only if
 * it declared one (ruling R5); an undeclared one is absent from its context rather than a stub that
 * throws, so what the picker lists and what the test can do are the same set by construction. And a
 * `headless` test that asks for a game window is refused (ruling R6) rather than quietly given one.
 *
 * One run at a time, per project (ruling R7): a test run, Dev Mode and Preview contend for the same
 * compiled-artifact directory and the same Stop affordance, so the slot is exclusive on both sides.
 */

/** Console channel a run streams to; also where it drives the progress bar (ruling R8). */
export const TEST_CONSOLE_CHANNEL = "test";

/** `source` stamped on every console line a run emits. */
export const TEST_CONSOLE_SOURCE = "Test";

/** How long the full bar lingers after a run finishes before it clears. Mirrors the build's. */
const TEST_DONE_LINGER_MS = 1400;

/**
 * How many finished runs this session keeps.
 *
 * Session-only and deliberately not persisted: a run is an event, and its verdict is about the
 * project as it was at that moment. A record restored on the next launch would be a green tick over
 * a project that has changed since.
 */
const MAX_TEST_RUN_HISTORY = 50;

/** Log lines kept on a record. The same ceiling the console keeps per channel, for the same reason. */
const MAX_TEST_LOG_ENTRIES = 500;

/** How many findings a run prints one by one on the console. See {@link TestRunService.appendFinding}. */
const CONSOLE_FINDING_LIMIT = 200;

/** Finding severity -> the console level its line is written at. */
const FINDING_CONSOLE_LEVELS: Record<TestFindingSeverity, TestLogLevel> = {
  error: "error",
  warning: "warning",
  info: "info"
};

/**
 * How long `stop()` waits for main to report the exit before it gives up.
 *
 * Not a nicety: the run slot is exclusive (ruling R7), so a stop that never resolves leaves Dev
 * Mode, Preview and every other test inert for the rest of the session. Giving up records the exit
 * we asked for - `stopped-by-host` is true either way, we did ask - rather than hanging on the
 * chance that a process which is already gone will announce itself.
 */
const SESSION_STOP_TIMEOUT_MS = 10_000;

type TestRunServiceEvents = {
  /** Any run-state change. Payload-free: subscribers re-read what they render. */
  changed: null;
};

type ActiveRun = {
  record: TestRunRecord;
  definition: TestDefinition;
  controller: AbortController;
  /**
   * Set when the *host* refuses something mid-run - today, a headless test asking for a window
   * (ruling R6). Forces `errored` when the run settles, so a test that swallowed the refusal and
   * returned `passed` cannot report a pass for a run the host broke.
   */
  hostError: string | null;
  session: HostedGameSession | null;
  /** True between the launch request and its answer, so a second `launch()` is refused. */
  launching: boolean;
};

/**
 * A game process owned by one run.
 *
 * The buffer is the point. `launch()` has to resolve before the caller can hold a session to
 * subscribe to, so every event main pushed in between - the game's first console lines, and a
 * `failed-to-start` exit - would land with nobody listening. Those are exactly the events a test
 * that launches a game is looking for, so they are kept and replayed to the first listener.
 */
class HostedGameSession implements TestGameSession {
  private readonly listeners = new Set<(event: TestGameEvent) => void>();
  private buffered: TestGameEvent[] = [];
  private exit: TestGameExit | null = null;
  private exitWaiters: ((exit: TestGameExit) => void)[] = [];

  public constructor(
    public readonly id: string,
    private readonly requestStop: (sessionId: string) => Promise<void>
  ) {}

  public accept(event: TestGameEvent): void {
    if (this.listeners.size === 0) {
      this.buffered.push(event);
    } else {
      for (const listener of [...this.listeners]) {
        listener(event);
      }
    }
    if (event.kind === "exit") {
      this.settleExit(event.exit);
    }
  }

  public onEvent(listener: (event: TestGameEvent) => void): () => void {
    this.listeners.add(listener);
    if (this.buffered.length > 0) {
      const replay = this.buffered;
      this.buffered = [];
      for (const event of replay) {
        listener(event);
      }
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  public waitForExit(): Promise<TestGameExit> {
    if (this.exit) {
      return Promise.resolve(this.exit);
    }
    return new Promise<TestGameExit>((resolve) => {
      this.exitWaiters.push(resolve);
    });
  }

  public hasExited(): boolean {
    return this.exit !== null;
  }

  public async stop(): Promise<void> {
    if (this.exit) {
      return;
    }
    try {
      await this.requestStop(this.id);
    } catch (error) {
      console.warn(`[TestRunService] stopping game session ${this.id} failed`, error);
    }
    if (this.exit) {
      return;
    }
    await Promise.race([
      this.waitForExit(),
      new Promise<void>((resolve) => setTimeout(resolve, SESSION_STOP_TIMEOUT_MS))
    ]);
    // See SESSION_STOP_TIMEOUT_MS: record the exit we asked for rather than hold the run slot.
    this.settleExit({ reason: "stopped-by-host", code: null, signal: null });
  }

  private settleExit(exit: TestGameExit): void {
    if (this.exit) {
      return;
    }
    this.exit = exit;
    const waiters = this.exitWaiters;
    this.exitWaiters = [];
    for (const waiter of waiters) {
      waiter(exit);
    }
  }
}

export class TestRunService extends Service<TestRunService> implements ITestRunService {
  private active: ActiveRun | null = null;
  /** Newest first. */
  private runs: TestRunRecord[] = [];
  private sequence = 0;
  private readonly events = new EventEmitter<TestRunServiceEvents>();
  private disposeChannel: (() => void) | null = null;
  private disposeGameTestEvents: (() => void) | null = null;
  private clearProgressTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Events for a session whose `launch()` has not resolved yet, keyed by session id.
   *
   * Main can push before the request's answer gets back across IPC, and dropping those lines
   * would lose the startup failures a test launched a game to observe.
   */
  private readonly pendingSessionEvents = new Map<string, TestGameEvent[]>();

  protected async init(
    ctx: WorkspaceContext,
    depend: (services: Service[]) => Promise<void>
  ): Promise<void> {
    const consoleService = ctx.services.get<ConsoleService>(Services.Console);
    await depend([consoleService]);

    this.disposeChannel?.();
    this.disposeChannel = consoleService.registerChannel({
      id: TEST_CONSOLE_CHANNEL,
      label: translate("test.console.channel"),
      description: "Test runs: their live output and their verdict"
    });

    this.disposeGameTestEvents?.();
    this.disposeGameTestEvents = null;
    try {
      const token = getInterface().gameTest.onEvent((payload) => this.routeGameTestEvent(payload));
      this.disposeGameTestEvents = () => token.cancel();
    } catch (error) {
      // A preload without the namespace must not take the workspace down on startup: every
      // headless test still runs, and a windowed one fails at `launch()` with a real message
      // instead of the whole service failing to initialise.
      console.warn("[TestRunService] gameTest event channel unavailable", error);
    }
  }

  public override dispose(_ctx: WorkspaceContext): void {
    this.active?.controller.abort();
    void this.active?.session?.stop();
    this.active = null;
    this.runs = [];
    this.pendingSessionEvents.clear();
    if (this.clearProgressTimer) {
      clearTimeout(this.clearProgressTimer);
      this.clearProgressTimer = null;
    }
    this.disposeGameTestEvents?.();
    this.disposeGameTestEvents = null;
    this.disposeChannel?.();
    this.disposeChannel = null;
    this.events.clear();
  }

  // -----------------------------------------------------------------------
  // Registry reads
  // -----------------------------------------------------------------------

  public listTests(): RegisteredTest[] {
    this.ensureBuiltInTestsRegistered();
    return testRegistry.list();
  }

  public getTest(id: TestId): RegisteredTest | undefined {
    this.ensureBuiltInTestsRegistered();
    return testRegistry.get(id);
  }

  /**
   * The definition's own answer, with the host's gates on top.
   *
   * Host gates first, and they win: they are the same refusals `start` enforces, so the reason the
   * picker greys a row out is the reason the author would have been given had they pressed Start.
   * A definition's `checkAvailability` speaks only for itself and cannot know about either.
   */
  public getAvailability(id: TestId): TestAvailability {
    this.ensureBuiltInTestsRegistered();
    const registered = testRegistry.get(id);
    if (!registered) {
      // Untranslated, on the same principle the build gate applies to its own failures: this
      // reports a caller asking for a test that does not exist - Studio (or a plugin)
      // malfunctioning - not something the author's project did.
      return { available: false, reason: { text: `Test not registered: ${id}` } };
    }
    if (this.active) {
      return { available: false, reason: { key: "test.reason.alreadyRunning" } };
    }
    const frozen = this.isFrozen();
    // Ruling R9: a headless test is a read-only observer and runs while frozen exactly as
    // `lint:project` does; a windowed one is refused because Preview already is, and a test must
    // not become the way around that gate.
    if (frozen && registered.definition.presentation === "windowed") {
      return { available: false, reason: { key: "test.reason.frozen" } };
    }
    try {
      return (
        registered.definition.checkAvailability?.({ projectPath: this.projectPath(), frozen }) ?? {
          available: true
        }
      );
    } catch (error) {
      // A definition that throws while the picker is opening is a defect in it, not a reason
      // to take the picker down - and offering to run it would only move the throw later.
      console.error(`[TestRunService] checkAvailability failed for ${id}`, error);
      return { available: false, reason: { text: `${id} could not report whether it can run` } };
    }
  }

  // -----------------------------------------------------------------------
  // Runs
  // -----------------------------------------------------------------------

  /** Resolves the run id once the run is accepted - not when it finishes. */
  public async start(testId: TestId): Promise<string> {
    this.ensureBuiltInTestsRegistered();
    const registered = testRegistry.get(testId);
    if (!registered) {
      throw new Error(`Test not registered: ${testId}`);
    }
    const availability = this.getAvailability(testId);
    if (!availability.available) {
      throw new Error(formatTestText(availability.reason));
    }

    const runId = this.nextRunId();
    const record: TestRunRecord = {
      runId,
      testId,
      // Snapshotted: a plugin reload can unregister the definition while its run is still on
      // screen, and a record that could no longer say what it ran would be worthless.
      title: registered.definition.title,
      ownerPluginId: registered.ownerPluginId,
      protocolVersion: TEST_PROTOCOL_VERSION,
      status: "running",
      startedAt: Date.now(),
      findings: [],
      log: [],
      progress: null
    };
    const active: ActiveRun = {
      record,
      definition: registered.definition,
      controller: new AbortController(),
      hostError: null,
      session: null,
      launching: false
    };
    this.active = active;
    this.runs.unshift(record);
    if (this.runs.length > MAX_TEST_RUN_HISTORY) {
      this.runs.length = MAX_TEST_RUN_HISTORY;
    }

    this.syncConsoleProgress("running");
    this.logToConsole(
      "info",
      translate("test.console.started", { title: formatTestText(record.title) })
    );
    this.events.emit("changed", null);

    // Deliberately not awaited: `start` answers "accepted", and the run outlives the call.
    //
    // The catch is about the run *slot*, not about the test: the slot is exclusive (ruling R7),
    // so a defect in the controller itself would otherwise leave Dev Mode, Preview and every
    // other test inert for the rest of the session with nothing on screen to explain it.
    void this.execute(active).catch((error) => {
      console.error("[TestRunService] the run controller failed", error);
      if (this.active === active) {
        this.active = null;
        this.events.emit("changed", null);
      }
    });
    return runId;
  }

  public cancel(runId: string): void {
    const active = this.active;
    if (!active || active.record.runId !== runId) {
      return;
    }
    active.controller.abort();
    // The game must not outlive the run that owns it, and a test that ignores its signal would
    // otherwise leave a window on screen after Stop.
    void active.session?.stop();
    this.events.emit("changed", null);
  }

  public getActiveRun(): TestRunRecord | null {
    return this.active?.record ?? null;
  }

  public getRun(runId: string): TestRunRecord | null {
    return this.runs.find((run) => run.runId === runId) ?? null;
  }

  public listRuns(): TestRunRecord[] {
    return [...this.runs];
  }

  public onChanged(listener: () => void): () => void {
    return this.events.on("changed", listener);
  }

  // -----------------------------------------------------------------------
  // Execution
  // -----------------------------------------------------------------------

  private async execute(active: ActiveRun): Promise<void> {
    let status: TestRunStatus;
    let summary: TestText | undefined;
    let error: string | undefined;

    try {
      const verdict = await active.definition.run(this.createRunContext(active));
      status = verdict.status;
      summary = verdict.summary;
    } catch (thrown) {
      // The two host-owned verdicts, told apart by whether the author had asked to stop.
      // A returned verdict is honoured even after an abort: ruling R4 is explicit that a test
      // whose contract is "close the window when satisfied" expresses author-termination by
      // catching the abort and returning `failed`, and the host second-guessing that would
      // take away the only way to write it.
      if (active.controller.signal.aborted) {
        status = "cancelled";
      } else {
        status = "errored";
        error = stringifyError(thrown);
      }
    }

    if (active.hostError) {
      // See ActiveRun.hostError: the run was broken by the host, so whatever the test claimed
      // about it is void.
      status = "errored";
      error = active.hostError;
      summary = undefined;
    }

    await this.teardownSession(active);

    // Findings and log stay exactly as they accumulated - a cancelled run is still evidence.
    this.patchRecord(active, {
      status,
      summary,
      error,
      finishedAt: Date.now(),
      progress: null
    });
    const finished = active.record;
    this.active = null;
    this.pendingSessionEvents.clear();

    if (summary) {
      this.logToConsole(consoleLevelForStatus(status), formatTestText(summary));
    }
    this.logToConsole(
      consoleLevelForStatus(status),
      translate("test.console.finished", {
        title: formatTestText(finished.title),
        // One key per status, addressed by the status itself - the same shape the build's lint
        // summary uses for severities, and the reason `TEST_TERMINAL_STATUSES` is a closed set.
        status: translate(`test.status.${status}` as TranslationKey),
        duration: `${(((finished.finishedAt ?? Date.now()) - finished.startedAt) / 1000).toFixed(1)}s`
      })
    );
    this.syncConsoleProgress(status);
    this.events.emit("changed", null);
  }

  private createRunContext(active: ActiveRun): TestRunContext {
    const requires = active.definition.requires ?? [];
    // Annotated, not inferred: `protocolVersion` is the literal `1` on the contract and an
    // object literal would widen it to `number`.
    const base: Omit<TestRunContext, "project" | "game"> = {
      runId: active.record.runId,
      protocolVersion: TEST_PROTOCOL_VERSION,
      signal: active.controller.signal,
      log: (level: TestLogLevel, message: TestText) => this.appendLog(active, level, message),
      progress: (progress: TestProgress | null) => this.setProgress(active, progress),
      report: (finding: TestFinding) => this.appendFinding(active, finding)
    };
    // Spread-in rather than assigned-undefined: ruling R5 says an undeclared capability is
    // *absent*, and `"game" in ctx` is how a test written against a newer host feature-detects.
    return {
      ...base,
      ...(requires.includes("project.read") ? { project: this.createProjectHandle() } : {}),
      ...(requires.includes("game.launch") ? { game: this.createGameHandle(active) } : {})
    };
  }

  /** `project.read`: the read half of the story service, and nothing more (see `TestProjectHandle`). */
  private createProjectHandle(): TestProjectHandle {
    const services = () => this.getContext().services;
    return {
      projectPath: this.projectPath(),
      listStories: async (): Promise<TestStoryRef[]> => {
        const story = services().get<StoryService>(Services.Story);
        return story.getLibraryIndex().stories.map((entry) => ({ id: entry.id, name: entry.name }));
      },
      listScenes: async (storyId: string): Promise<TestSceneRef[]> => {
        const story = services().get<StoryService>(Services.Story);
        const document = await story.loadStory(storyId);
        return listSceneIdsInDocumentOrder(document)
          .map((sceneId) => document.scenes[sceneId])
          .filter((scene) => Boolean(scene))
          .map((scene) => ({ id: scene.id, name: scene.name }));
      }
    };
  }

  /** `game.launch`: one session at a time, and never for a test that declared itself headless. */
  private createGameHandle(active: ActiveRun): TestGameHandle {
    return {
      launch: (options?: TestGameLaunchOptions) => this.launchGame(active, options)
    };
  }

  private async launchGame(
    active: ActiveRun,
    options?: TestGameLaunchOptions
  ): Promise<TestGameSession> {
    // Every refusal in this method is deliberately untranslated. They are addressed to whoever
    // wrote the test - Studio or a plugin author - about a contract they broke, the same class
    // of message the build gate leaves in English for the same reason. The *author* never sees
    // one directly: it arrives as the run's `error`, under a localized "Errored" verdict.

    // Ruling R6, the belt behind `requires`: `presentation` is a declaration about what the
    // author is about to see, so a headless test that opens a window is a host error and not a
    // silent success. The run is failed rather than only the call refused, because a test that
    // caught this and carried on would be reporting a verdict about something it did not do.
    if (active.definition.presentation === "headless") {
      const message = `${active.definition.id} is declared headless and may not launch a game`;
      this.failWithHostError(active, message);
      throw new Error(message);
    }
    // Two preview processes contend for the same compiled-artifact directory and the second
    // would silently win, so the second launch is refused rather than queued.
    if (active.launching || (active.session && !active.session.hasExited())) {
      throw new Error(`${active.definition.id} already has a game session in this run`);
    }
    if (active.controller.signal.aborted) {
      throw new Error("The run was cancelled before the game could be launched");
    }

    active.launching = true;
    try {
      const result = await getInterface().gameTest.launch({
        projectPath: this.projectPath(),
        runId: active.record.runId,
        network: options?.network
      });
      if (!result.success) {
        throw new Error(
          `Could not launch a game for the test: ${result.error ?? "no reason given"}`
        );
      }
      if (!result.data.ok) {
        // A refusal Studio can explain - frozen workspace, compile failure, no runner
        // binary - so the reason is passed through rather than flattened.
        throw new Error(`Could not launch a game for the test: ${result.data.reason}`);
      }

      const session = new HostedGameSession(result.data.sessionId, (sessionId) =>
        this.stopSession(sessionId)
      );
      if (this.active !== active) {
        // The run ended while the launch was in flight (a cancel, most likely). Do not hand
        // back a window nothing will ever close.
        void session.stop();
        throw new Error("The run ended while the game was starting");
      }
      active.session = session;
      const parked = this.pendingSessionEvents.get(session.id);
      if (parked) {
        this.pendingSessionEvents.delete(session.id);
        for (const event of parked) {
          session.accept(event);
        }
      }
      return session;
    } finally {
      active.launching = false;
    }
  }

  private async stopSession(sessionId: string): Promise<void> {
    const result = await getInterface().gameTest.stop(this.projectPath(), sessionId);
    if (!result.success) {
      throw new Error(result.error ?? `Could not stop game session ${sessionId}`);
    }
  }

  private async teardownSession(active: ActiveRun): Promise<void> {
    const session = active.session;
    if (!session || session.hasExited()) {
      return;
    }
    await session.stop();
  }

  /**
   * Route one pushed event to the session it belongs to.
   *
   * Keyed by run first: a session outlives no run, so an event carrying a stale run id is from a
   * process that is on its way out and has no business reaching a live test.
   */
  private routeGameTestEvent(payload: GameTestEventPayload): void {
    const active = this.active;
    if (!active || active.record.runId !== payload.runId) {
      return;
    }
    const session = active.session;
    if (session && session.id === payload.sessionId) {
      session.accept(payload.event);
      return;
    }
    const parked = this.pendingSessionEvents.get(payload.sessionId) ?? [];
    parked.push(payload.event);
    this.pendingSessionEvents.set(payload.sessionId, parked);
  }

  private failWithHostError(active: ActiveRun, message: string): void {
    if (!active.hostError) {
      active.hostError = message;
    }
    this.appendLog(active, "error", { text: message });
    active.controller.abort();
  }

  // -----------------------------------------------------------------------
  // Record bookkeeping
  // -----------------------------------------------------------------------

  private appendLog(active: ActiveRun, level: TestLogLevel, message: TestText): void {
    if (active.record.status !== "running") {
      return;
    }
    const log = active.record.log;
    log.push({ level, message, timestamp: Date.now() });
    if (log.length > MAX_TEST_LOG_ENTRIES) {
      log.splice(0, log.length - MAX_TEST_LOG_ENTRIES);
    }
    // Ruling R8: the live half of a run is the console channel, so a line goes to both.
    this.logToConsole(level, formatTestText(message));
    this.patchRecord(active, {});
  }

  private appendFinding(active: ActiveRun, finding: TestFinding): void {
    if (active.record.status !== "running") {
      return;
    }
    active.record.findings.push(finding);
    // Mirrored, but capped: `project-diagnostics` on a real VN returns thousands of findings
    // (`story/label-unused` alone is one per label), and pasting all of them onto the console
    // would bury the run's own output under a list that already exists, complete and navigable,
    // in the report tab. The same call the build's lint gate makes, for the same reason.
    if (active.record.findings.length <= CONSOLE_FINDING_LIMIT) {
      this.logToConsole(
        FINDING_CONSOLE_LEVELS[finding.severity],
        translate("test.console.finding", {
          severity: translate(`test.severity.${finding.severity}` as TranslationKey),
          message: formatTestText(finding.message)
        })
      );
    } else if (active.record.findings.length === CONSOLE_FINDING_LIMIT + 1) {
      // Once, and only to say that the console stopped short - the total cannot be known
      // while the run is still producing findings, and the full list is one click away.
      this.logToConsole("info", "…");
    }
    this.patchRecord(active, {});
  }

  private setProgress(active: ActiveRun, progress: TestProgress | null): void {
    if (active.record.status !== "running") {
      return;
    }
    this.patchRecord(active, { progress });
    const consoleService = this.tryGetConsole();
    if (!consoleService) {
      return;
    }
    if (!progress || progress.total === undefined || progress.total <= 0) {
      // No known fraction: the indeterminate animation, never a made-up fill level.
      consoleService.setProgress(TEST_CONSOLE_CHANNEL, { indeterminate: true });
      return;
    }
    consoleService.setProgress(TEST_CONSOLE_CHANNEL, {
      value: progress.completed / progress.total,
      indeterminate: false,
      label: progress.label ? formatTestText(progress.label) : undefined
    });
  }

  /**
   * Swap in a new record object.
   *
   * The shell is replaced on every change so a `useSyncExternalStore` reader sees a new identity
   * and re-renders; the `findings` and `log` arrays are carried over by reference and appended in
   * place, because a project-diagnostics sweep on a real VN reports thousands of findings and
   * copying the array per finding is quadratic for no reader that would notice.
   */
  private patchRecord(active: ActiveRun, patch: Partial<TestRunRecord>): void {
    const next: TestRunRecord = { ...active.record, ...patch };
    active.record = next;
    if (this.runs[0]?.runId === next.runId) {
      this.runs[0] = next;
    } else {
      const index = this.runs.findIndex((run) => run.runId === next.runId);
      if (index >= 0) {
        this.runs[index] = next;
      }
    }
    this.events.emit("changed", null);
  }

  // -----------------------------------------------------------------------
  // Console
  // -----------------------------------------------------------------------

  private logToConsole(level: TestLogLevel, message: string): void {
    this.tryGetConsole()?.log(TEST_CONSOLE_CHANNEL, level, message, {
      source: TEST_CONSOLE_SOURCE
    });
  }

  /**
   * Reflect the run onto the console's progress bar. Same policy as `BuildService`: an active run
   * with no known fraction shows the indeterminate animation (an honest "working"), a finished one
   * snaps to a solid full bar and lingers, and a run that did not pass turns the bar warning.
   */
  private syncConsoleProgress(status: TestRunStatus): void {
    const consoleService = this.tryGetConsole();
    if (!consoleService) {
      return;
    }
    if (this.clearProgressTimer) {
      clearTimeout(this.clearProgressTimer);
      this.clearProgressTimer = null;
    }

    if (status === "running") {
      // Drop any bar the previous run left behind before starting a clean one, so an earlier
      // failure's warning colour does not carry into this run.
      consoleService.setProgress(TEST_CONSOLE_CHANNEL, null);
      consoleService.setProgress(TEST_CONSOLE_CHANNEL, { indeterminate: true, error: false });
      return;
    }

    consoleService.setProgress(TEST_CONSOLE_CHANNEL, {
      value: 1,
      indeterminate: false,
      error: status !== "passed" && status !== "skipped"
    });
    this.clearProgressTimer = setTimeout(() => {
      this.clearProgressTimer = null;
      this.tryGetConsole()?.setProgress(TEST_CONSOLE_CHANNEL, null);
    }, TEST_DONE_LINGER_MS);
  }

  private tryGetConsole(): ConsoleService | null {
    try {
      return this.getContext().services.get<ConsoleService>(Services.Console);
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Workspace access
  // -----------------------------------------------------------------------

  private ensureBuiltInTestsRegistered(): void {
    testRegistry.ensureBuiltInTestsRegistered({ services: () => this.getContext().services });
  }

  private isFrozen(): boolean {
    try {
      return this.getContext()
        .services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze)
        .isFrozen();
    } catch {
      // No freeze service to ask means nothing has frozen anything.
      return false;
    }
  }

  private projectPath(): string {
    return this.getContext().project.getConfig().projectPath;
  }

  private nextRunId(): string {
    this.sequence += 1;
    return `test-${Date.now().toString(36)}-${this.sequence.toString(36)}`;
  }
}

/** Verdict -> the console level its lines are written at. */
function consoleLevelForStatus(status: TestRunStatus): TestLogLevel {
  switch (status) {
    case "passed":
      return "success";
    case "failed":
    case "errored":
      return "error";
    case "cancelled":
    case "skipped":
      return "warning";
    default:
      return "info";
  }
}

/**
 * A thrown value as a line of text.
 *
 * `Error.stack` and not just the message: `errored` means Studio or the test malfunctioned, which is
 * the one case where the reader is a developer and the frames are the answer.
 */
export function stringifyError(thrown: unknown): string {
  if (thrown instanceof Error) {
    return thrown.stack ?? `${thrown.name}: ${thrown.message}`;
  }
  if (typeof thrown === "string") {
    return thrown;
  }
  try {
    return JSON.stringify(thrown) ?? String(thrown);
  } catch {
    return String(thrown);
  }
}
