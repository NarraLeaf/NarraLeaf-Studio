import { getInterface } from "@/lib/app/bridge";
import { DEFAULT_LOCALE } from "@shared/i18n";
import { i18nStore } from "@/lib/i18n/store";
import type { GameBuildRequest, GameBuildStateSnapshot } from "@shared/types/gameBuild";
import type { CommandLineRunEvent } from "@shared/types/commandLineRun";
import { Services, type WorkspaceContext } from "../services/services";
import { BUILD_CONSOLE_CHANNEL, BuildService } from "../services/core/BuildService";
import { ConsoleService, type ConsoleEntry } from "../services/core/ConsoleService";

/**
 * The workspace half of `narraleaf-studio --build`.
 *
 * It starts the build the ordinary way and reports what happens. **`BuildService.start` is called
 * exactly as the Build dialog calls it**, which is the whole point of running this in a workspace at
 * all: the eight checks in front of a build read documents the editor is holding and services only
 * this process has, and a second implementation of them would eventually let a command-line build
 * ship what a dialog build refused.
 *
 * Nothing here decides anything. It subscribes, it starts, it waits, it reports; the outcome is
 * classified in the main process, which is the side that knows whether a compile ever began.
 *
 * ## Why the log is pinned to the source language
 *
 * A workspace opens in the author's language, and where none was ever chosen - which is every fresh
 * profile, including every build agent - it opens in the machine's. That is right for a window and
 * wrong for this: half of a build's console comes from the main process and is untranslated, so a
 * machine set to another language produced a log in two languages at once, neither of them chosen.
 * A command-line log is also read by whoever is debugging the pipeline rather than by whoever owns
 * the machine, and it is pasted into issues.
 *
 * So the run states its language instead of inheriting one. This changes what the lines *say*, never
 * which lines there are: every check refuses exactly the same projects, and the rule id inside a lint
 * finding - the part anything would search for - was never localized to begin with.
 */

/** How the build's console reaches the launch: one line per entry, in order. */
function toLogEvent(entry: ConsoleEntry): CommandLineRunEvent {
    return {
        kind: "log",
        timestamp: entry.timestamp,
        level: entry.level,
        ...(entry.source ? { source: entry.source } : {}),
        message: entry.segments.map(segment => segment.text).join(""),
    };
}

function isTerminal(status: GameBuildStateSnapshot["status"]): boolean {
    return status === "done" || status === "error";
}

/**
 * Run one build and report it, then resolve.
 *
 * Resolving means the launch has been told the outcome; the process it belongs to exits shortly
 * afterwards, so nothing is expected to happen in this window again.
 */
export async function runCommandLineBuild(
    context: WorkspaceContext,
    request: GameBuildRequest,
): Promise<void> {
    // Before the first check runs, because `translate` reads this at the moment a line is written.
    // Window-local: it sets this renderer's store, not the `app.language` preference, so nothing on
    // disk and no other window is touched by a build.
    i18nStore.setLocale(DEFAULT_LOCALE);

    const workspace = getInterface().workspace;
    const services = context.services;
    const consoleService = services.get<ConsoleService>(Services.Console);
    const buildService = services.get<BuildService>(Services.Build);

    // Subscribed before the build starts rather than after, so the first refusal - which several of
    // the checks reach before `start` has returned - is on the log like every other line.
    //
    // The build channel only. It is the one the whole pipeline writes to, both halves of it: the
    // checks in this process and the packager in the main one, which sends its lines here. What the
    // author reads in the Build tab is exactly what the launch prints.
    const unsubscribe = consoleService.onEntriesChanged(event => {
        if (event.channel !== BUILD_CONSOLE_CHANNEL || event.reason !== "append" || !event.entry) {
            return;
        }
        workspace.reportCommandLineRun(toLogEvent(event.entry));
    });

    try {
        const snapshot = await buildService.start(request);
        const settled = isTerminal(snapshot.status)
            ? snapshot
            : await new Promise<GameBuildStateSnapshot>(resolve => {
                const stop = buildService.onStateChanged(next => {
                    if (!isTerminal(next.status)) {
                        return;
                    }
                    stop();
                    resolve(next);
                });
            });

        workspace.reportCommandLineRun({
            kind: "finished",
            ok: settled.status === "done",
            ...(settled.error ? { error: settled.error } : {}),
            ...(settled.outputDir ? { outputDir: settled.outputDir } : {}),
            ...(settled.artifacts ? { artifacts: settled.artifacts } : {}),
            ...(settled.artifactSizes ? { artifactSizes: settled.artifactSizes } : {}),
            ...(settled.startedAt ? { startedAt: settled.startedAt } : {}),
            ...(settled.finishedAt ? { finishedAt: settled.finishedAt } : {}),
        });
    } catch (error) {
        // A throw here is this window failing, not the project failing, and the launch has to hear
        // something either way: without a report it would sit until its deadline and then say the
        // workspace never answered, which is true but says nothing about what went wrong.
        workspace.reportCommandLineRun({
            kind: "finished",
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    } finally {
        unsubscribe();
    }
}
