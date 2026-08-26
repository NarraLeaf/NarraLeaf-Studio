/**
 * How Studio raises a file or folder picker - and the one experimental condition that answers one
 * without opening anything.
 *
 * Every open/save dialog in the app goes through here rather than calling `dialog` directly, so
 * there is one place that decides whether the system dialog is what appears. In a normal launch it
 * is, and this module is a pass-through.
 *
 * Under `scripted-file-dialog` it is not. A native dialog runs its own input loop outside Chromium:
 * nothing driving the app over CDP can see it, let alone type into it, so a scripted run has to
 * reach outside the process and poke the Win32 dialog by hand (`tools/ui-verify/file-dialog.ps1`) -
 * slow, platform-specific, and fragile enough to have its own page of notes. With the condition on,
 * no dialog opens; the request waits in the page that raised it, on `window.__NLS_STUDIO_DIALOG__`,
 * until something answers it with a path.
 *
 * What it deliberately does NOT change is what happens to that path. The answer becomes the same
 * return value the native dialog would have produced, and the caller mints the same grant with the
 * same reach as always. This is another way to answer a picker, not a way around the permission a
 * picker hands out - which is why an answer is checked against what the dialog could actually have
 * returned (a file that exists, a folder that exists, one path where one was asked for) and refused
 * when it is not. A picker that could hand back a path no author is able to pick would make every
 * acceptance run that used it a test of something the product cannot do.
 *
 * All of it lives in the main process and is injected into the page on demand: a Studio that is not
 * in this mode has no such global, no IPC event, and no renderer code for one.
 */
import fs from "fs";
import path from "path";
import { dialog } from "electron";
import type { AppWindow } from "./appWindow";

/** The page-side object a driving session talks to. */
const BRIDGE_GLOBAL = "__NLS_STUDIO_DIALOG__";
/** Bumped when the injected object changes shape, so a page holding an older one is replaced. */
const BRIDGE_VERSION = 1;
/** How often main collects answers from a page while one of its requests is waiting. */
const POLL_INTERVAL_MS = 150;

type ScriptedDialogKind = "open" | "save";

/** One waiting request, as the page is shown it. Everything here is JSON. */
type ScriptedRequestView = {
    id: number;
    kind: ScriptedDialogKind;
    /** The window type that raised it, so a driver can tell two pages' requests apart. */
    window: string;
    title: string;
    /** What an open request is picking. Absent on a save. */
    selects?: "file" | "directory";
    /** Whether more than one path is accepted. */
    multiple: boolean;
    defaultPath?: string;
    /** Extensions the caller filtered on, flattened. Informational: answers are not filtered. */
    extensions: string[];
    /** Why the last answer was refused, when one was. The request is still waiting. */
    rejected?: string;
};

type ScriptedAnswer = {
    id: number;
    canceled: boolean;
    paths: string[];
};

type PendingRequest = ScriptedRequestView & {
    /** Rejects nothing: a request settles on an answer, a cancel, or the window going away. */
    settle: (answer: { canceled: boolean; paths: string[] }) => void;
    /** What an answer has to satisfy to be one this dialog could have produced. */
    validate: (paths: string[]) => string | null;
};

/**
 * The requests waiting in one page, keyed by webContents id.
 *
 * Per page rather than app-wide because the answer has to come from the page that asked: that is
 * the window whose grant is about to be minted, and it is the CDP target a driver is already on.
 */
type PageQueue = {
    window: AppWindow;
    webContents: Electron.WebContents;
    requests: PendingRequest[];
    timer: NodeJS.Timeout | null;
    /** Set while an evaluation is in flight, so a slow page does not stack up round trips. */
    busy: boolean;
};

const queues = new Map<number, PageQueue>();
let nextRequestId = 1;

function isScripted(window: AppWindow): boolean {
    return window.getApp().hasExperimentalCondition("scripted-file-dialog");
}

/**
 * Open a file or folder picker for `window`.
 *
 * Same contract as `dialog.showOpenDialog`, including that a cancel is an ordinary answer rather
 * than an error.
 */
export async function showOpenDialog(
    window: AppWindow,
    options: Electron.OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
    if (!isScripted(window)) {
        return dialog.showOpenDialog(window.win, options);
    }

    const properties = options.properties ?? [];
    const answer = await raise(
        window,
        {
            kind: "open",
            title: options.title ?? "Open",
            selects: properties.includes("openDirectory") && !properties.includes("openFile")
                ? "directory"
                : "file",
            multiple: properties.includes("multiSelections"),
            defaultPath: options.defaultPath,
            extensions: flattenExtensions(options.filters),
        },
        paths => validateOpenAnswer(properties, paths),
    );

    // No bookmarks: those come from the macOS dialog itself and stand for a scope it opened. A
    // scripted answer never had one, and inventing a string here would only fail later, further
    // from the cause.
    return { canceled: answer.canceled, filePaths: answer.paths, bookmarks: [] };
}

/** Open a save picker for `window`. Same contract as `dialog.showSaveDialog`. */
export async function showSaveDialog(
    window: AppWindow,
    options: Electron.SaveDialogOptions,
): Promise<Electron.SaveDialogReturnValue> {
    if (!isScripted(window)) {
        return dialog.showSaveDialog(window.win, options);
    }

    const answer = await raise(
        window,
        {
            kind: "save",
            title: options.title ?? "Save",
            multiple: false,
            defaultPath: options.defaultPath,
            extensions: flattenExtensions(options.filters),
        },
        validateSaveAnswer,
    );

    // Electron gives an empty string for a cancelled save, not undefined; callers test `canceled`
    // or the emptiness, and both have to keep working.
    return { canceled: answer.canceled, filePath: answer.canceled ? "" : answer.paths[0] ?? "" };
}

/**
 * Put the page-side object in `window` before it raises anything, so a session that goes looking
 * for it finds it. No-op unless the condition is on.
 *
 * Called on every load: a reload rebuilds the page, and everything in it.
 */
export function installScriptedFileDialogBridge(window: AppWindow): void {
    if (!isScripted(window)) {
        return;
    }
    void evaluate(window.getWebContents(), bridgeSource() + ";true").catch(() => {
        /* A page already navigating away gets the object from the next load. */
    });
}

/**
 * What an answer to an open dialog has to look like.
 *
 * Exported for its own test: this is the line between "answered the picker differently" and "handed
 * the product a path no picker could have produced".
 */
export function validateOpenAnswer(
    properties: readonly string[],
    paths: readonly string[],
): string | null {
    if (paths.length === 0) {
        return "an open dialog needs at least one path; cancel it instead of answering with none";
    }
    if (!properties.includes("multiSelections") && paths.length > 1) {
        return `this picker takes one path, and was answered with ${paths.length}`;
    }
    const wantsDirectory = properties.includes("openDirectory");
    const wantsFile = properties.includes("openFile") || !wantsDirectory;

    for (const target of paths) {
        const absolute = absoluteOrNull(target);
        if (!absolute) {
            return `${String(target)} is not an absolute path`;
        }
        const stat = statOrNull(absolute);
        if (!stat) {
            return `${absolute} does not exist, and a picker only ever returns paths that do`;
        }
        if (stat.isDirectory() && !wantsDirectory) {
            return `${absolute} is a folder, and this picker is picking a file`;
        }
        if (!stat.isDirectory() && !wantsFile) {
            return `${absolute} is a file, and this picker is picking a folder`;
        }
    }
    return null;
}

/**
 * What an answer to a save dialog has to look like: one path, inside a folder that exists, that is
 * not itself a folder. The file need not exist - that is what a save dialog is for.
 */
export function validateSaveAnswer(paths: readonly string[]): string | null {
    if (paths.length !== 1) {
        return `a save dialog takes exactly one path, and was answered with ${paths.length}`;
    }
    const absolute = absoluteOrNull(paths[0]);
    if (!absolute) {
        return `${String(paths[0])} is not an absolute path`;
    }
    if (statOrNull(absolute)?.isDirectory()) {
        return `${absolute} is a folder, not a file to save into`;
    }
    const parent = path.dirname(absolute);
    if (!statOrNull(parent)?.isDirectory()) {
        return `${parent} does not exist, and a save dialog only returns paths inside a folder that does`;
    }
    return null;
}

function absoluteOrNull(target: unknown): string | null {
    if (typeof target !== "string" || target.length === 0 || target.includes("\0")) {
        return null;
    }
    return path.isAbsolute(target) ? path.resolve(target) : null;
}

function statOrNull(target: string): fs.Stats | null {
    try {
        return fs.statSync(target);
    } catch {
        return null;
    }
}

function flattenExtensions(filters: Electron.FileFilter[] | undefined): string[] {
    const extensions = (filters ?? []).flatMap(filter => filter.extensions);
    return Array.from(new Set(extensions.filter(extension => extension !== "*")));
}

function raise(
    window: AppWindow,
    view: Omit<ScriptedRequestView, "id" | "window">,
    validate: (paths: string[]) => string | null,
): Promise<{ canceled: boolean; paths: string[] }> {
    return new Promise(resolve => {
        const queue = queueFor(window);
        const request: PendingRequest = {
            ...view,
            id: nextRequestId++,
            window: window.getWindowType(),
            settle: resolve,
            validate,
        };
        queue.requests.push(request);

        window.getApp().logger.warn(
            `[Experimental] scripted-file-dialog: request #${request.id} from the ${request.window} `
            + `window is waiting - "${request.title}"${describeTarget(request)}. Nothing opened. `
            + `Answer it in that page with ${BRIDGE_GLOBAL}.resolve(${request.id}, "<path>") or `
            + `${BRIDGE_GLOBAL}.cancel(${request.id}).`,
        );

        startPump(queue);
    });
}

function describeTarget(request: PendingRequest): string {
    if (request.kind === "save") {
        return " (a file to save)";
    }
    const noun = request.selects === "directory" ? "folder" : "file";
    return request.multiple ? ` (one or more ${noun}s)` : ` (one ${noun})`;
}

function queueFor(window: AppWindow): PageQueue {
    const webContents = window.getWebContents();
    const existing = queues.get(webContents.id);
    if (existing) {
        return existing;
    }

    const queue: PageQueue = { window, webContents, requests: [], timer: null, busy: false };
    queues.set(webContents.id, queue);
    webContents.once("destroyed", () => abandon(queue));
    return queue;
}

function startPump(queue: PageQueue): void {
    if (queue.timer) {
        return;
    }
    queue.timer = setInterval(() => void tick(queue), POLL_INTERVAL_MS);
    // Unreferenced, so a picker nobody is answering is not on its own a reason to stay alive.
    queue.timer.unref?.();
    void tick(queue);
}

function stopPump(queue: PageQueue): void {
    if (queue.timer) {
        clearInterval(queue.timer);
        queue.timer = null;
    }
}

/** Settle everything still waiting in a page that is gone. A closed window is a cancelled picker. */
function abandon(queue: PageQueue): void {
    stopPump(queue);
    queues.delete(queue.webContents.id);
    const abandoned = queue.requests.splice(0, queue.requests.length);
    if (abandoned.length === 0) {
        return;
    }
    queue.window.getApp().logger.warn(
        `[Experimental] scripted-file-dialog: the page went away with ${abandoned.length} `
        + "request(s) unanswered; treating them as cancelled.",
    );
    for (const request of abandoned) {
        request.settle({ canceled: true, paths: [] });
    }
}

/**
 * One round trip: hand the page the current list of waiting requests, take back whatever it has
 * answered since the last one.
 *
 * The bridge is (re)installed in the same evaluation, so a reload in the middle of a wait costs one
 * interval rather than the request.
 */
async function tick(queue: PageQueue): Promise<void> {
    if (queue.busy) {
        return;
    }
    if (queue.webContents.isDestroyed()) {
        abandon(queue);
        return;
    }

    queue.busy = true;
    try {
        apply(queue, await sync(queue));
        if (queue.requests.length === 0) {
            // One last push, so the page stops listing requests that have already been answered.
            apply(queue, await sync(queue));
            stopPump(queue);
        }
    } catch {
        /*
         * A page that is navigating, or one whose renderer has just gone, refuses the evaluation.
         * Neither is a reason to give up on the request: the next tick reinstalls the bridge, and a
         * page that never comes back is settled by the `destroyed` listener above.
         */
    } finally {
        queue.busy = false;
    }
}

async function sync(queue: PageQueue): Promise<ScriptedAnswer[]> {
    const payload = JSON.stringify(queue.requests.map(toView));
    const source = `(function(){${bridgeSource()};`
        + `try{return window.${BRIDGE_GLOBAL}.__sync(${payload});}catch(e){return [];}})()`;
    const answers = await evaluate(queue.webContents, source);
    return Array.isArray(answers) ? answers as ScriptedAnswer[] : [];
}

function evaluate(webContents: Electron.WebContents, source: string): Promise<unknown> {
    return webContents.executeJavaScript(source, false);
}

function toView(request: PendingRequest): ScriptedRequestView {
    const { settle: _settle, validate: _validate, ...view } = request;
    return view;
}

function apply(queue: PageQueue, answers: ScriptedAnswer[]): void {
    const logger = queue.window.getApp().logger;
    for (const answer of answers) {
        const index = queue.requests.findIndex(request => request.id === answer?.id);
        if (index < 0) {
            continue;
        }
        const request = queue.requests[index];

        if (answer.canceled) {
            queue.requests.splice(index, 1);
            logger.warn(`[Experimental] scripted-file-dialog: request #${request.id} was cancelled from the page.`);
            request.settle({ canceled: true, paths: [] });
            continue;
        }

        const paths = Array.isArray(answer.paths)
            ? answer.paths.filter(entry => typeof entry === "string")
            : [];
        const rejection = request.validate(paths);
        if (rejection) {
            // Kept waiting rather than failed: a driver can read `rejected` and answer again, which
            // is what a person does with a dialog that will not accept what they typed.
            request.rejected = rejection;
            logger.warn(
                `[Experimental] scripted-file-dialog: request #${request.id} refused an answer - `
                + `${rejection}. It is still waiting.`,
            );
            continue;
        }

        queue.requests.splice(index, 1);
        const resolved = paths.map(entry => path.resolve(entry));
        logger.warn(
            `[Experimental] scripted-file-dialog: request #${request.id} answered with `
            + `${resolved.join(", ")}. The window is granted that path exactly as a picked one.`,
        );
        request.settle({ canceled: false, paths: resolved });
    }
}

/**
 * The page-side object, as source.
 *
 * Idempotent, and written to survive being evaluated on every poll: it returns immediately when a
 * matching version is already there, so answers a driver has queued are not thrown away by the next
 * round trip.
 */
function bridgeSource(): string {
    return `(function(){
        var installed = window.${BRIDGE_GLOBAL};
        if (installed && installed.version === ${BRIDGE_VERSION}) { return; }
        var pending = [];
        var answers = [];
        function waiting(id) {
            return pending.some(function (request) { return request.id === id; });
        }
        function answer(id, canceled, paths) {
            if (!waiting(id)) { return false; }
            answers.push({ id: id, canceled: canceled, paths: paths });
            return true;
        }
        var api = {
            version: ${BRIDGE_VERSION},
            /* Requests this page has raised that nothing has answered yet. */
            pending: function () { return JSON.parse(JSON.stringify(pending)); },
            /* Answer one with a path, or an array of them. False when no such request is waiting. */
            resolve: function (id, paths) {
                var list = (paths === undefined || paths === null)
                    ? []
                    : (Array.isArray(paths) ? paths : [paths]);
                return answer(id, false, list.map(String));
            },
            /* Answer one the way a person closing the dialog would. */
            cancel: function (id) { return answer(id, true, []); },
            __sync: function (next) {
                pending = next;
                var queued = answers;
                answers = [];
                return queued;
            }
        };
        Object.defineProperty(window, "${BRIDGE_GLOBAL}", {
            value: api, configurable: true, enumerable: false
        });
    })()`;
}
