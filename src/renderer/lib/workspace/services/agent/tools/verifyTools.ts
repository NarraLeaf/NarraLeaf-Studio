/**
 * Checking and playing the game: `lint`, `console_read`, `playtest_*`, and the two calls main hands a
 * workspace that already has the project open - a project test (`__test`) and a build (`__build`).
 *
 * Everything an agent reads here is rendered in English whatever language the author's Studio is
 * in: the model reads it, and an answer in the author's language would be a second thing for it to
 * translate before it could act.
 *
 * Comments in English per project convention.
 */

import { createTranslator, type TranslationKey } from "@shared/i18n";
import { listSceneBlocksInDocumentOrder } from "@shared/types/story";
import type { DevModeAgentGameState, DevModeEntry } from "@shared/types/devMode";
import type { GameBuildPlatform, GameBuildStateSnapshot } from "@shared/types/gameBuild";
import { getInterface } from "@/lib/app/bridge";
import { describeLintLocation } from "@/lib/lint/locationText";
import { resolveLintMessageParams, type LintSeverity } from "@/lib/lint/types";
import type { TestRunRecord, TestText } from "@/lib/testing/types";
import { TEST_TERMINAL_STATUSES } from "@/lib/testing/types";
import type { TestRunService } from "@/lib/testing/TestRunService";
import { isProjectTrusted } from "@/lib/workspace/projectTrust";
import { Services, type WorkspaceContext } from "../../services";
import type { LintService } from "../../core/LintService";
import type { ConsoleService, ConsoleLogLevel } from "../../core/ConsoleService";
import type { DevModeService } from "../../core/DevModeService";
import type { BuildService } from "../../core/BuildService";
import {
    answer,
    answerJson,
    readOptionalInteger,
    readOptionalRecord,
    readOptionalString,
    readString,
    refuse,
    type AgentToolHandler,
} from "../agentCall";
import { resolveScene, resolveStory } from "../agentLookups";
import { downscaleImage } from "../domRaster";
import { describeAdvance, describeGameState, gameStateData, launchIsUp, playtestHint } from "./playtestReport";

const english = createTranslator("en");
const translate = (key: TranslationKey, params?: Record<string, string | number>) => english.t(key, params);

// ── lint ─────────────────────────────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };
const LINT_FINDINGS_CAP = 150;

export const lint: AgentToolHandler = async (args, { ctx }) => {
    const threshold = (readOptionalString(args, "severity") ?? "warning") as LintSeverity;
    if (!(threshold in SEVERITY_RANK)) {
        throw refuse("invalid_args", "`severity` must be error, warning or info.");
    }
    const report = await ctx.services.get<LintService>(Services.Lint).run();
    const findings = report.entries
        .filter(entry => SEVERITY_RANK[entry.severity] <= SEVERITY_RANK[threshold])
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
        .map(entry => {
            const location = describeLintLocation(entry.location, key => translate(key));
            return {
                severity: entry.severity,
                rule: entry.ruleId,
                message: translate(entry.messageKey, resolveLintMessageParams(entry, key => translate(key), (base, count, params) => english.tn(base, count, params))),
                ...(location ? { location } : {}),
            };
        });
    const shown = findings.slice(0, LINT_FINDINGS_CAP);
    return answerJson(
        { counts: report.counts, shown: shown.length, total: findings.length, findings: shown },
        `${report.counts.error} error(s), ${report.counts.warning} warning(s), ${report.counts.info} info.`
            + (findings.length > shown.length ? ` Showing the first ${shown.length} of ${findings.length}.` : "")
            + (report.counts.error > 0 ? " Fix every error before building." : ""),
    );
};

// ── console_read ─────────────────────────────────────────────────────────────────────────────────

const LEVEL_RANK: Record<ConsoleLogLevel, number> = { verbose: 0, info: 1, success: 1, warning: 2, error: 3 };
const ARG_LEVEL_RANK: Record<string, number> = { debug: 0, info: 1, warning: 2, error: 3 };

export const consoleRead: AgentToolHandler = async (args, { ctx }) => {
    const channel = readOptionalString(args, "channel");
    const level = readOptionalString(args, "level") ?? "info";
    const limit = readOptionalInteger(args, "limit", { min: 1, max: 1000 }) ?? 100;
    if (!(level in ARG_LEVEL_RANK)) {
        throw refuse("invalid_args", "`level` must be debug, info, warning or error.");
    }
    const console = ctx.services.get<ConsoleService>(Services.Console);
    const channels = console.getChannels();
    if (channel && !channels.some(item => item.id === channel)) {
        throw refuse("not_found", `No console channel "${channel}".`, `Channels: ${channels.map(item => item.id).join(", ")}.`);
    }
    const minimum = ARG_LEVEL_RANK[level];
    const entries = (channel ? [channel] : channels.map(item => item.id))
        .flatMap(id => console.getEntries(id))
        .filter(entry => LEVEL_RANK[entry.level] >= minimum)
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-limit);
    const lines = entries.map(entry => {
        const time = new Date(entry.timestamp).toISOString().slice(11, 19);
        const text = entry.segments.map(segment => segment.text).join("");
        return `${time} [${entry.channel}] ${entry.level}${entry.source ? ` ${entry.source}` : ""}: ${text}`;
    });
    return answer(lines.length > 0 ? lines.join("\n") : "No console lines at this level.", {
        channels: channels.map(item => item.id),
        lines: entries.length,
    });
};

// ── playtest ─────────────────────────────────────────────────────────────────────────────────────

function devMode(ctx: WorkspaceContext): DevModeService {
    return ctx.services.get<DevModeService>(Services.DevMode);
}

async function requireTrusted(ctx: WorkspaceContext): Promise<void> {
    if (!(await isProjectTrusted(ctx.project.getConfig().projectPath))) {
        throw refuse("untrusted", "This project is not trusted in Studio, so its game may not run.", "Ask the author to trust the project (the shield in the status bar).");
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

export const playtestStart: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const sceneRef = readOptionalString(args, "scene");
    const row = readOptionalInteger(args, "row", { min: 1 });
    await requireTrusted(ctx);

    let entry: DevModeEntry = { kind: "surface" };
    let from = "the title page";
    if (sceneRef) {
        const { entry: story, document } = await resolveStory(ctx, undefined);
        const scene = resolveScene(document, sceneRef);
        let blockId: string | undefined;
        if (row !== undefined) {
            const block = listSceneBlocksInDocumentOrder(scene)[row - 1];
            if (!block) {
                throw refuse("invalid_args", `Scene "${scene.name}" has no row ${row}.`);
            }
            blockId = block.id;
        }
        entry = { kind: "story", storyId: story.id, sceneId: scene.id, ...(blockId ? { blockId } : {}) };
        from = row !== undefined ? `row ${row} of "${scene.name}"` : `scene "${scene.name}"`;
    } else if (row !== undefined) {
        throw refuse("invalid_args", "`row` needs a `scene`.");
    }
    follow.describeCall(request.callId, from);

    const service = devMode(ctx);
    const projectPath = ctx.project.getConfig().projectPath;
    // A game already running in place is replaced by this launch; how many times it had entered a
    // story is what tells the new game from it below. Nothing running reads as "none yet".
    const before = await getInterface().devMode.agentControl(projectPath, { kind: "state" });
    const entriesBefore = before.success && before.data.kind === "state" && before.data.state.ready
        ? before.data.state.entries
        : -1;
    let status = await service.launch(entry);
    // The launch answers once the window is asked for; compiling follows. Wait (bounded) for the game
    // to be running so the next playtest call has something to act on.
    const deadline = Date.now() + 60_000;
    while ((status === "starting" || status === "compiling" || status === "reloading") && Date.now() < deadline) {
        await delay(500);
        status = await service.refreshStatus();
    }
    if (status === "error") {
        throw refuse("check_failed", "Dev Mode could not start the game.", "Call console_read with channel \"build\" for the reason, fix it, and start again.");
    }
    // "Running" is main having sent the game its documents, not the game being on its first line: an
    // advance sent now used to land in the scene's fade-in and be lost. So wait (bounded) until the
    // game this launch asked for is up - a story entered since the launch, with a line or a menu
    // showing - and then let that first line finish typing, so the first screenshot shows it whole.
    const story = entry.kind === "story";
    let state: DevModeAgentGameState | null = null;
    let sawOutOfStory = false;
    const readyBy = Date.now() + 20_000;
    while (status === "running" && Date.now() < readyBy) {
        const read = await getInterface().devMode.agentControl(projectPath, { kind: "state" });
        if (read.success && read.data.kind === "state") {
            state = read.data.state;
            sawOutOfStory = sawOutOfStory || (state.ready && !state.inGame);
            if (launchIsUp(state, { story, entriesBefore, sawOutOfStory })) {
                break;
            }
        }
        await delay(250);
    }
    if (story && state && launchIsUp(state, { story, entriesBefore, sawOutOfStory })) {
        const settled = await getInterface().devMode.agentControl(projectPath, { kind: "state", settle: true });
        if (settled.success && settled.data.kind === "state") {
            state = settled.data.state;
        }
    }
    const where = state ? ` ${describeGameState(state)}` : "";
    return answerJson(
        { status, from, ...(state ? gameStateData(state) : {}) },
        `Dev Mode is ${status}, from ${from}.${where} Use playtest_screenshot to look and playtest_advance to read on.`,
    );
};

function playtestRefusal(result: { error?: string; code?: string }) {
    return refuse("unavailable", result.error ?? "The game did not answer.", playtestHint(result.code));
}

export const playtestAdvance: AgentToolHandler = async (args, { ctx }) => {
    const steps = readOptionalInteger(args, "steps", { min: 1, max: 50 }) ?? 1;
    const choice = readOptionalInteger(args, "choice", { min: 1, max: 50 });
    // `choice` crosses as the agent gave it - 1-based, over the options as shown - and the window
    // maps it onto the engine's own index (see `DevModeAgentAction`).
    const result = await getInterface().devMode.agentControl(ctx.project.getConfig().projectPath, {
        kind: "advance",
        steps,
        ...(choice !== undefined ? { choice } : {}),
    });
    if (!result.success) {
        throw playtestRefusal(result);
    }
    if (result.data.kind !== "advance") {
        throw refuse("internal", "The game answered something other than an advance.");
    }
    const { advanced, error, ending, state } = result.data;
    const where = state ? ` ${describeGameState(state)}` : "";
    return answerJson(
        {
            advanced,
            ...(error ? { stoppedBecause: error } : {}),
            ...(ending ? { ending: ending.name } : {}),
            ...(state ? gameStateData(state) : {}),
        },
        `${describeAdvance(result.data)}${where}`,
    );
};

export const playtestScreenshot: AgentToolHandler = async (args, { ctx }) => {
    const maxSize = readOptionalInteger(args, "maxSize", { min: 64, max: 4096 }) ?? 1280;
    const result = await getInterface().devMode.agentControl(ctx.project.getConfig().projectPath, { kind: "capture" });
    if (!result.success) {
        throw playtestRefusal(result);
    }
    if (result.data.kind !== "capture" || !result.data.png) {
        throw refuse("unavailable", "The game had nothing to capture.");
    }
    const scaled = await downscaleImage(result.data.png, maxSize);
    const note = result.data.source === "window"
        ? "Captured from the window (no game has been entered yet, so this is a page such as the title)."
        : "The game stage as the engine draws it, Game UI included.";
    return {
        ok: true,
        content: [
            { type: "image", mimeType: "image/png", data: scaled.png },
            { type: "text", text: `${scaled.width}x${scaled.height} px. ${note}` },
        ],
        structured: { width: scaled.width, height: scaled.height, source: result.data.source },
    };
};

export const playtestStop: AgentToolHandler = async (_args, { ctx }) => {
    const status = await devMode(ctx).stop();
    return answer(`Dev Mode is ${status}.`, { status });
};

// ── Main's internal calls ────────────────────────────────────────────────────────────────────────

function testText(text: TestText | undefined): string {
    if (!text) {
        return "";
    }
    return text.key ? translate(text.key, text.params) : text.text;
}

function waitFor<T>(subscribe: (listener: () => void) => () => void, read: () => T | null, timeoutMs: number): Promise<T | null> {
    return new Promise(resolve => {
        const immediate = read();
        if (immediate !== null) {
            resolve(immediate);
            return;
        }
        let done = false;
        const finish = (value: T | null) => {
            if (done) {
                return;
            }
            done = true;
            window.clearTimeout(timer);
            unsubscribe();
            resolve(value);
        };
        const unsubscribe = subscribe(() => {
            const value = read();
            if (value !== null) {
                finish(value);
            }
        });
        const timer = window.setTimeout(() => finish(read()), timeoutMs);
    });
}

/** `__test`: run one registered project test here, through the window's own test service. */
export const internalTest: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const id = readString(args, "id");
    const parameters = readOptionalRecord(args, "parameters") as Record<string, string> | undefined;
    const tests = ctx.services.get<TestRunService>(Services.TestRun);
    const definition = tests.listTests().find(test => test.definition.id === id)?.definition;
    if (!definition) {
        throw refuse("not_found", `No test "${id}".`, `Tests: ${tests.listTests().map(test => test.definition.id).join(", ")}.`);
    }
    await tests.prepareAvailability();
    const availability = tests.getAvailability(id);
    if (!availability.available) {
        throw refuse("unavailable", `Test "${id}" cannot run now: ${testText(availability.reason)}`);
    }
    // The test's title, as Studio's test list shows it: the id is internal.
    follow.describeCall(request.callId, testText(definition.title));
    let runId: string;
    try {
        runId = await tests.start(id, parameters);
    } catch (error) {
        throw refuse("unavailable", error instanceof Error ? error.message : String(error));
    }
    const run = await waitFor<TestRunRecord>(
        listener => tests.onChanged(listener),
        () => {
            const record = tests.getRun(runId);
            return record && TEST_TERMINAL_STATUSES.includes(record.status) ? record : null;
        },
        30 * 60_000,
    );
    if (!run) {
        throw refuse("internal", `Test "${id}" did not finish in time.`);
    }
    const findings = run.findings.map(finding => ({ severity: finding.severity, message: testText(finding.message) }));
    return answerJson(
        { testId: id, status: run.status, summary: testText(run.summary) || null, findings, ...(run.error ? { error: run.error } : {}) },
        `Test ${id}: ${run.status}.${run.summary ? ` ${testText(run.summary)}` : ""}`,
    );
};

function currentPlatform(): GameBuildPlatform {
    const platform = (typeof navigator !== "undefined" ? navigator.platform || navigator.userAgent : "").toLowerCase();
    if (platform.includes("mac")) {
        return "macos";
    }
    if (platform.includes("win")) {
        return "windows";
    }
    return "linux";
}

/** `__build`: build the project through the window's own build pipeline, checks and all. */
export const internalBuild: AgentToolHandler = async (args, { ctx, request, follow }) => {
    const target = readOptionalString(args, "target") ?? "current";
    const output = readOptionalString(args, "output");
    const platform: GameBuildPlatform = target === "current" ? currentPlatform() : (target as GameBuildPlatform);
    if (!["windows", "macos", "linux", "web"].includes(platform)) {
        throw refuse("invalid_args", "`target` must be current, windows, macos, linux or web.");
    }
    const build = ctx.services.get<BuildService>(Services.Build);
    if (build.isBuilding()) {
        throw refuse("unavailable", "A build is already running in Studio.", "Wait for it to finish, then try again.");
    }
    follow.describeCall(request.callId, platform);
    let state = await build.start({ targets: [{ platform, formats: ["dir"] }], ...(output ? { outputDir: output } : {}) });
    const finished = (snapshot: GameBuildStateSnapshot) => snapshot.status === "done" || snapshot.status === "error" || snapshot.status === "idle";
    if (!finished(state)) {
        const settled = await waitFor<GameBuildStateSnapshot>(
            listener => build.onStateChanged(() => listener()),
            () => {
                const snapshot = build.getState();
                return finished(snapshot) ? snapshot : null;
            },
            60 * 60_000,
        );
        state = settled ?? build.getState();
    }
    if (state.status !== "done") {
        throw refuse("check_failed", `The build did not finish: ${state.error ?? state.status}.`, "Run lint and fix its errors, then build again; console_read with channel \"build\" has the log.");
    }
    // The checksum list rides along with the artifacts; it is not something to open.
    const artifacts = (state.artifacts ?? []).filter(artifact => !/(^|[\\/])SHA256SUMS(\.asc)?$/.test(artifact));
    return answerJson(
        { outputDir: state.outputDir ?? null, artifacts, platform },
        `Built for ${platform} into ${state.outputDir ?? "the project's dist directory"}.`
            + (artifacts.length > 0 ? `\nTo play it, open: ${artifacts.join(", ")}` : "")
            + (platform === "macos" ? "\nUnless the project is set up to sign macOS builds, Gatekeeper blocks this app on other Macs: tell the author, and that a player opens it once through System Settings > Privacy & Security > Open Anyway." : ""),
    );
};
