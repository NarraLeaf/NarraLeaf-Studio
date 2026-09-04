import { getInterface } from "@/lib/app/bridge";
import { DEFAULT_LOCALE } from "@shared/i18n";
import { i18nStore } from "@/lib/i18n/store";
import type {
    CommandLineTestListing,
    CommandLineTestParameterListing,
} from "@shared/types/commandLineCheck";
import type { CommandLineRunFinding } from "@shared/types/commandLineRun";
import { Services, type WorkspaceContext } from "../workspace/services/services";
import { ConsoleService, type ConsoleEntry } from "../workspace/services/core/ConsoleService";
import { TEST_CONSOLE_CHANNEL, TestRunService } from "./TestRunService";
import { formatTestText } from "./testText";
import { resolveTestParameterValue, testParameterId, type ResolvedTestParameter } from "./parameters";
import { TEST_TERMINAL_STATUSES, type TestParameterValue, type TestRunRecord } from "./types";

/**
 * The workspace half of `narraleaf-studio --test` and `--test-list`.
 *
 * **`TestRunService.start` is called exactly as the Run > Test picker calls it**, which is the whole
 * reason this runs in a workspace at all: the registry is populated by Studio's own modules and by
 * every installed plugin as they come up, the capabilities a test reaches are lent by the run
 * controller, and the gates in front of a run - one at a time, a windowed test on a frozen
 * workspace, a project nobody has vouched for - are that controller's. A second implementation of
 * any of it would eventually let a scripted run do what the picker refuses.
 *
 * ## Both modes, and why the mode is the point
 *
 * A test declares itself `headless` or `windowed` and the host obeys that declaration rather than
 * the caller: `presentation` is reported for every test `--test-list` names and on every result, so
 * a job on a machine with no screen can see which is which before it starts one. Nothing here can
 * ask for a mode - a test that says `headless` and opens a window is a host error, not a choice.
 *
 * ## Parameters
 *
 * The line carries strings; the test declares what they mean. A value for a parameter the test does
 * not declare, or a `select` value the test does not offer, is refused as a bad invocation rather
 * than falling back on the default - a run that silently walked to a different ending than the one
 * the line named would report a green verdict about something nobody asked for.
 */

/** How long a run may go without any change before the launch stops waiting on it. */
const TEST_SILENCE_TIMEOUT_MS = 30 * 60 * 1000;

function reportFailure(error: string, refusal?: "invocation" | "unavailable"): void {
    getInterface().workspace.reportCommandLineRun({
        kind: "finished",
        ok: false,
        error,
        ...(refusal ? { refusal } : {}),
    });
}

/** Pin the log to the source language, for the reason `runCommandLineBuild` sets out. */
function pinLocale(): void {
    i18nStore.setLocale(DEFAULT_LOCALE);
}

/** How the test console's lines reach the launch: one line per entry, in order. */
function toLogEvent(entry: ConsoleEntry) {
    return {
        kind: "log" as const,
        timestamp: entry.timestamp,
        level: entry.level,
        ...(entry.source ? { source: entry.source } : {}),
        message: entry.segments.map(segment => segment.text).join(""),
    };
}

/** Everything the registry holds, with each test's mode and each parameter's accepted values. */
export async function listCommandLineTests(context: WorkspaceContext): Promise<void> {
    pinLocale();
    const service = context.services.get<TestRunService>(Services.TestRun);
    await service.prepareParameterSources();
    await service.prepareAvailability();

    const tests: CommandLineTestListing[] = service.listTests().map(registered => {
        const definition = registered.definition;
        const availability = service.getAvailability(definition.id);
        const parameters: CommandLineTestParameterListing[] = service.listParameters(definition.id)
            .map(parameter => describeParameter(parameter));
        return {
            id: definition.id,
            title: formatTestText(definition.title),
            category: definition.category ?? "custom",
            presentation: definition.presentation,
            ...(registered.ownerPluginId ? { ownerPluginId: registered.ownerPluginId } : {}),
            available: availability.available,
            ...(availability.available
                ? {}
                : { unavailableReason: formatTestText(availability.reason) }),
            parameters,
        };
    });

    getInterface().workspace.reportCommandLineRun({ kind: "finished", ok: true, tests });
}

function describeParameter(parameter: ResolvedTestParameter): CommandLineTestParameterListing {
    const fallback = resolveTestParameterValue(parameter, undefined);
    return {
        id: testParameterId(parameter),
        kind: parameter.kind,
        label: formatTestText(parameter.definition.label),
        ...(parameter.kind === "select" ? { values: parameter.options.map(option => option.value) } : {}),
        ...(fallback === undefined ? {} : { defaultValue: String(fallback) }),
    };
}

/**
 * What a `--test-parameter` string means for one declared parameter, or why it means nothing.
 *
 * The boolean spellings are the ones a shell script writes without thinking about it. A `select` is
 * matched against the option *values* rather than the labels: a label is a display string that
 * follows the editor language, and a line written against one would stop working when somebody
 * changed Studio's language.
 */
function coerceParameter(
    parameter: ResolvedTestParameter,
    raw: string,
): { ok: true; value: TestParameterValue } | { ok: false; reason: string } {
    const id = testParameterId(parameter);
    if (parameter.kind === "boolean") {
        const value = raw.trim().toLowerCase();
        if (["true", "yes", "on", "1"].includes(value)) {
            return { ok: true, value: true };
        }
        if (["false", "no", "off", "0"].includes(value)) {
            return { ok: true, value: false };
        }
        return { ok: false, reason: `--test-parameter ${id}: expected true or false, got "${raw}"` };
    }
    if (parameter.options.some(option => option.value === raw)) {
        return { ok: true, value: raw };
    }
    const accepted = parameter.options.map(option => option.value).join(", ");
    return {
        ok: false,
        reason: `--test-parameter ${id}: "${raw}" is not one this project offers.`
            + (accepted ? ` It accepts: ${accepted}.` : " It offers no values at all."),
    };
}

/** Run one test and report its verdict, then resolve. */
export async function runCommandLineTest(
    context: WorkspaceContext,
    testId: string,
    parameters: Record<string, string>,
): Promise<void> {
    pinLocale();

    const workspace = getInterface().workspace;
    const services = context.services;
    const consoleService = services.get<ConsoleService>(Services.Console);
    const service = services.get<TestRunService>(Services.TestRun);

    const registered = service.getTest(testId);
    if (!registered) {
        const known = service.listTests().map(test => test.definition.id).join(", ");
        reportFailure(
            `No test is registered as "${testId}".${known ? ` This project's Studio has: ${known}.` : ""}`,
            "invocation",
        );
        return;
    }

    // Before the parameters are read and before availability is asked: both answers are drawn from
    // the project, and a story nobody has opened this session is not loaded yet.
    await service.prepareParameterSources();
    await service.prepareAvailability();

    const declared = service.listParameters(testId);
    const values: Record<string, TestParameterValue> = {};
    for (const [id, raw] of Object.entries(parameters)) {
        const parameter = declared.find(candidate => testParameterId(candidate) === id);
        if (!parameter) {
            const names = declared.map(testParameterId).join(", ");
            reportFailure(
                `--test-parameter ${id}: "${testId}" declares no such parameter.`
                + (names ? ` It declares: ${names}.` : " It declares none."),
                "invocation",
            );
            return;
        }
        const coerced = coerceParameter(parameter, raw);
        if (!coerced.ok) {
            reportFailure(coerced.reason, "invocation");
            return;
        }
        values[id] = coerced.value;
    }
    // Everything the line did not name falls to the declaration's own default, which is what the
    // picker would have started on.
    for (const parameter of declared) {
        const id = testParameterId(parameter);
        if (!(id in values)) {
            const fallback = resolveTestParameterValue(parameter, undefined);
            if (fallback !== undefined) {
                values[id] = fallback;
            }
        }
    }

    const availability = service.getAvailability(testId);
    if (!availability.available) {
        reportFailure(`"${testId}" cannot run here: ${formatTestText(availability.reason)}`, "unavailable");
        return;
    }

    // Subscribed before the run starts rather than after, so the first line - which several tests
    // write before `start` has returned - is on the log like every other one.
    const unsubscribe = consoleService.onEntriesChanged(event => {
        if (event.channel !== TEST_CONSOLE_CHANNEL || event.reason !== "append" || !event.entry) {
            return;
        }
        workspace.reportCommandLineRun(toLogEvent(event.entry));
    });

    try {
        const runId = await service.start(testId, values);
        const record = await waitForVerdict(service, runId);
        if (!record) {
            reportFailure("The test run stopped reporting and never reached a verdict.");
            return;
        }
        const findings: CommandLineRunFinding[] = record.findings.map(finding => ({
            severity: finding.severity,
            message: formatTestText(finding.message),
        }));
        const status = record.status as Exclude<TestRunRecord["status"], "running">;
        workspace.reportCommandLineRun({
            kind: "finished",
            // Only `passed` is a pass. `skipped` is the test declining to answer, and a job that
            // read it as a green tick would ship on a check that never ran.
            ok: status === "passed",
            ...(status === "passed" ? {} : { error: verdictSentence(record) }),
            startedAt: record.startedAt,
            ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
            test: {
                testId,
                title: formatTestText(record.title),
                presentation: registered.definition.presentation,
                status,
                ...(record.summary ? { summary: formatTestText(record.summary) } : {}),
                findings,
                startedAt: record.startedAt,
                ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
            },
        });
    } catch (error) {
        // `start` rejects when the controller refuses the run - the slot is taken, the project is
        // not trusted. That is the host declining, not this window failing.
        reportFailure(error instanceof Error ? error.message : String(error), "unavailable");
    } finally {
        unsubscribe();
    }
}

/** One sentence for a run that did not pass, in the words the report tab would use. */
function verdictSentence(record: TestRunRecord): string {
    const summary = record.summary ? formatTestText(record.summary) : record.error;
    return summary
        ? `Test ${record.status}: ${summary}`
        : `Test ${record.status}.`;
}

/**
 * Wait until the run reaches one of the five terminal states.
 *
 * The idle deadline is reset by every change the service reports, for the reason the build's is: a
 * walkthrough of a long story takes as long as it takes, and a total deadline would cancel exactly
 * the runs that most needed to finish. Null means the deadline expired.
 */
function waitForVerdict(service: TestRunService, runId: string): Promise<TestRunRecord | null> {
    return new Promise<TestRunRecord | null>(resolve => {
        let deadline: ReturnType<typeof setTimeout>;
        let stop: (() => void) | null = null;
        const settle = (record: TestRunRecord | null) => {
            clearTimeout(deadline);
            stop?.();
            resolve(record);
        };
        const armDeadline = () => {
            clearTimeout(deadline);
            deadline = setTimeout(() => settle(null), TEST_SILENCE_TIMEOUT_MS);
        };
        const check = (): boolean => {
            const record = service.getRun(runId);
            if (record && TEST_TERMINAL_STATUSES.includes(record.status)) {
                settle(record);
                return true;
            }
            return false;
        };
        armDeadline();
        stop = service.onChanged(() => {
            armDeadline();
            check();
        });
        // A run short enough to have finished before this subscribed is not a run that never ends.
        check();
    });
}
