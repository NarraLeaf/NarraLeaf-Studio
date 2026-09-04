import type { AppWindow } from "../managers/window/appWindow";
import { windowProjectPath } from "./windowProject";
import { emitWorkspaceConsoleLog } from "./workspaceConsole";

/**
 * How long one window's refusals of one request are summarised into a single line.
 *
 * Two of the guarded channels - `preview.getStatus` and `devMode.getStatus` - are polled once a
 * second, so a renderer stuck asking about the wrong project would write a line a second for as
 * long as it is open. A console that fills with one repeated sentence is a console the author stops
 * reading, which costs more than the lines are worth; a minute is long enough that a stuck poll
 * shows as a slow drip rather than a flood, and short enough that the author sees a fresh line
 * while they are still looking at the thing that caused it.
 */
const REPORT_INTERVAL_MS = 60_000;

/**
 * A ceiling on how many (window, request) pairs are remembered at once.
 *
 * The map only holds a timestamp and a count per pair, and pairs are bounded in practice by the
 * windows open times the guarded channels. This exists so that a caller inventing request names
 * cannot grow it without limit; dropping the lot costs at most one duplicated line per pair.
 */
const MAX_TRACKED = 256;

type RefusalRecord = {
    lastReportedAt: number;
    /** Refusals that arrived inside the interval and were folded into the next line. */
    suppressed: number;
};

const recentRefusals = new Map<string, RefusalRecord>();

/** Only for tests: the throttle is process-wide state, and one test must not colour the next. */
export function resetWindowProjectRefusalReporting(): void {
    recentRefusals.clear();
}

/**
 * Say, where the author can find it, that a request was refused for naming another project.
 *
 * # Why this exists at all
 *
 * Until now the refusal existed only as an IPC return value. That is enough when a button is
 * waiting on it - the caller can put a sentence on screen - but a good half of what asks these
 * channels is not a click: a status poll, a watcher relaunching a preview, a save flush on the way
 * into a run. A refusal nobody is waiting for is a refusal nobody hears, and what the author then
 * sees is Studio quietly not doing something, which is the shape of failure this project has spent
 * a great deal of time paying for. The trust gate next door reached the same conclusion and writes
 * its refusals to the same console for the same reason.
 *
 * # Where it lands, and why not somewhere better
 *
 * The workspace console of **this window's own project**. That is the only console the author of
 * this window would read as theirs, and it is the one place a line can appear without inventing an
 * interface for an event that should never happen. A window with no project - the launcher,
 * settings, the wizard - has no such console, so its refusals go to the application log alone;
 * there is no author's project to attribute them to, and a request naming a project from one of
 * those windows is a renderer bug rather than something an author can act on.
 *
 * # Why the line does not name the project that was asked for
 *
 * Because it is not this project. The whole point of the refusal is that the named path belongs to
 * something the author of this window is not editing, and a path printed in their console reads as
 * part of their own project - it would be copied into bug reports, searched for on disk, and
 * generally believed. Naming it would also turn every window into a way of learning where other
 * projects live, which is a smaller version of the hole the guard just closed. What the line does
 * carry is the request, which is the half that says what did not happen.
 *
 * # Why it is an error rather than a warning
 *
 * The severity question is whether the result deviates severely from what was expected, not whether
 * the author will find the line annoying. An operation that was asked for and did not happen, with
 * nothing else anywhere to say so, is exactly that.
 */
export function reportWindowProjectRefusal(window: AppWindow, request: string): void {
    const app = window.getApp();
    const own = windowProjectPath(window);
    app.logger.warn(
        `[Project] Refused ${request}: the request named a project other than the window's own`,
    );
    if (!own) {
        return;
    }

    const key = `${window.getWebContents().id}:${request}`;
    const now = Date.now();
    const seen = recentRefusals.get(key);
    if (seen && now - seen.lastReportedAt < REPORT_INTERVAL_MS) {
        seen.suppressed += 1;
        return;
    }
    const folded = seen?.suppressed ?? 0;
    if (recentRefusals.size >= MAX_TRACKED) {
        recentRefusals.clear();
    }
    recentRefusals.set(key, { lastReportedAt: now, suppressed: 0 });

    emitWorkspaceConsoleLog(app, own, {
        level: "error",
        source: "Project",
        message: `Refused ${request}: it named a project other than the one open in this window, `
            + "so nothing was done."
            + (folded > 0 ? ` ${folded} more like it were refused since the last of these lines.` : ""),
    });
}
