import type { AgentFolderAccessAnswer, AgentFolderRefusalReason } from "@shared/agent/protocol";

/**
 * Which folders an agent may be let read, and the one-dialog-at-a-time conversation that asks the
 * author about the rest.
 *
 * An agent that wants to import the author's files names the files; what the author is asked about
 * is the folders that hold them - each distinct folder, the one the files sit in, so an answer
 * covers no more than the call needs. A dialog names at most {@link AGENT_FOLDER_PROMPT_CAP}
 * folders: past that, folders are merged into the deepest folder they share (never into one that
 * is too broad to hand out), and what still does not fit is refused as `tooMany` for the agent to
 * ask again.
 *
 * Some folders are never put to the author at all, because "Allow" on them would hand out far more
 * than an import needs or something that is not the author's to give away casually: a file-system
 * root (or a folder holding the home folder, like `/Users`), the home folder itself, and Studio's
 * own folders - its user data, which holds the agent token, and the application. A folder that
 * holds one of Studio's folders counts as one, since reading `~/Library` reads the token as well.
 * Full access does not open them either.
 *
 * The rules are pure and take their path flavour as an argument, so both platforms' behaviour is
 * tested on either. The conversation ({@link AgentFolderAccess}) is written against a host so it
 * can be driven without Electron.
 *
 * Comments in English per project convention.
 */

/** The parts of Node's `path` the rules use; `path.posix` and `path.win32` both fit. */
export type AgentFolderPathApi = {
    resolve(...segments: string[]): string;
    dirname(value: string): string;
    relative(from: string, to: string): string;
    isAbsolute(value: string): boolean;
    parse(value: string): { root: string };
};

export type AgentFolderRules = {
    pathApi: AgentFolderPathApi;
    /** Windows: one folder whatever the case of its spelling. */
    caseInsensitive: boolean;
    home: string;
    /** Studio's own folders: user data, the application, its resources. */
    studioDirs: readonly string[];
};

/** Most folders one dialog names. */
export const AGENT_FOLDER_PROMPT_CAP = 5;

/** How long a folder the author declined is answered `denied` without asking again. */
export const AGENT_FOLDER_DECLINE_QUIET_MS = 60 * 1000;

function fold(value: string, rules: AgentFolderRules): string {
    const resolved = rules.pathApi.resolve(value);
    return rules.caseInsensitive ? resolved.toLowerCase() : resolved;
}

/** One spelling per folder, for comparing and keying. Never shown. */
export function agentFolderKey(folder: string, rules: AgentFolderRules): string {
    return fold(folder, rules);
}

/** Whether `child` is `root` or inside it, after normalisation. */
export function isAgentFolderInside(child: string, root: string, rules: AgentFolderRules): boolean {
    const { pathApi } = rules;
    if (!pathApi.isAbsolute(child) || !pathApi.isAbsolute(root)) {
        return false;
    }
    const rel = pathApi.relative(fold(root, rules), fold(child, rules));
    if (rel === "") {
        return true;
    }
    const escapes = rel === ".." || rel.startsWith("../") || rel.startsWith("..\\");
    return !escapes && !pathApi.isAbsolute(rel);
}

function isFileSystemRoot(folder: string, rules: AgentFolderRules): boolean {
    const resolved = rules.pathApi.resolve(folder);
    return rules.pathApi.parse(resolved).root === resolved || rules.pathApi.dirname(resolved) === resolved;
}

/** Why `folder` may never be handed to an agent, or null when it may be asked about. */
export function agentFolderRefusal(folder: string, rules: AgentFolderRules): AgentFolderRefusalReason | null {
    if (!rules.pathApi.isAbsolute(folder)) {
        return "relative";
    }
    if (isFileSystemRoot(folder, rules)) {
        return "root";
    }
    const key = agentFolderKey(folder, rules);
    if (key === agentFolderKey(rules.home, rules)) {
        return "home";
    }
    if (isAgentFolderInside(rules.home, folder, rules)) {
        return "root";
    }
    if (rules.studioDirs.some(dir => isAgentFolderInside(folder, dir, rules) || isAgentFolderInside(dir, folder, rules))) {
        return "studio";
    }
    return null;
}

/**
 * Whether folders may be merged into `folder` to fit a dialog: not one that is refused, and not one
 * just below the home folder or a file-system root (`~/Downloads`, `/Volumes`, `D:\Games`) - asking
 * for those to save a dialog line hands out far more than the call named.
 */
function isTooBroadToMergeInto(folder: string, rules: AgentFolderRules): boolean {
    if (agentFolderRefusal(folder, rules) !== null) {
        return true;
    }
    const parent = rules.pathApi.dirname(rules.pathApi.resolve(folder));
    return isFileSystemRoot(parent, rules) || agentFolderKey(parent, rules) === agentFolderKey(rules.home, rules);
}

/** The deepest folder holding both, or null when they share only a root. */
export function deepestCommonFolder(a: string, b: string, rules: AgentFolderRules): string | null {
    let candidate = rules.pathApi.resolve(a);
    for (;;) {
        if (isAgentFolderInside(b, candidate, rules)) {
            return candidate;
        }
        const parent = rules.pathApi.dirname(candidate);
        if (parent === candidate) {
            return null;
        }
        candidate = parent;
    }
}

/** Drop every folder that sits inside another one of the list; the first spelling of a folder wins. */
function withoutNested(folders: readonly string[], rules: AgentFolderRules): string[] {
    const kept: string[] = [];
    for (const folder of folders) {
        if (kept.some(other => isAgentFolderInside(folder, other, rules))) {
            continue;
        }
        for (let index = kept.length - 1; index >= 0; index -= 1) {
            if (isAgentFolderInside(kept[index], folder, rules)) {
                kept.splice(index, 1);
            }
        }
        kept.push(folder);
    }
    return kept;
}

export type AgentFolderPlan = {
    /** The folders to put to the author, at most `cap`. */
    ask: string[];
    refused: AgentFolderAccessAnswer["refused"];
};

/**
 * From the folders a call needs (each file's own folder, or a folder it named) to the folders a
 * dialog asks about: refused ones set apart, duplicates and folders inside another dropped, and,
 * only when more than `cap` remain, the closest pair merged into the folder they share until they
 * fit - so a call that needs three folders is asked about those three, not their parent.
 */
export function planAgentFolderRequest(folders: readonly string[], rules: AgentFolderRules, cap: number = AGENT_FOLDER_PROMPT_CAP): AgentFolderPlan {
    const refused: AgentFolderPlan["refused"] = [];
    const candidates: string[] = [];
    const seenRefused = new Set<string>();
    for (const raw of folders) {
        const reason = agentFolderRefusal(raw, rules);
        if (reason) {
            const key = rules.pathApi.isAbsolute(raw) ? agentFolderKey(raw, rules) : raw;
            if (!seenRefused.has(key)) {
                seenRefused.add(key);
                refused.push({ folder: rules.pathApi.isAbsolute(raw) ? rules.pathApi.resolve(raw) : raw, reason });
            }
            continue;
        }
        candidates.push(rules.pathApi.resolve(raw));
    }
    let ask = withoutNested(candidates, rules);
    while (ask.length > cap) {
        let best: { i: number; j: number; folder: string } | null = null;
        for (let i = 0; i < ask.length; i += 1) {
            for (let j = i + 1; j < ask.length; j += 1) {
                const shared = deepestCommonFolder(ask[i], ask[j], rules);
                if (!shared || isTooBroadToMergeInto(shared, rules)) {
                    continue;
                }
                if (!best || shared.length > best.folder.length) {
                    best = { i, j, folder: shared };
                }
            }
        }
        if (!best) {
            break;
        }
        const merged = [...ask];
        merged[best.i] = best.folder;
        merged.splice(best.j, 1);
        ask = withoutNested(merged, rules);
    }
    if (ask.length > cap) {
        refused.push(...ask.slice(cap).map(folder => ({ folder, reason: "tooMany" as const })));
        ask = ask.slice(0, cap);
    }
    return { ask, refused };
}

/** What a dialog says about who is asking. */
export type AgentFolderPrompt = {
    clientName: string | null;
    /** The agent's own words for what it will do, as it gave them. Shown attributed to the agent. */
    reason?: string;
};

export interface AgentFolderAccessHost<W> {
    rules(): AgentFolderRules;
    /** Folders the window may already read for agents: the allowed import roots and its project. */
    allowedFolders(window: W): string[];
    fullAccess(): boolean;
    isClosed(window: W): boolean;
    /** Put the folders to the author in one prompt window over `window`; true on "Allow". */
    ask(window: W, folders: string[], prompt: AgentFolderPrompt): Promise<boolean>;
    /** Add the folders to the allowed list, persist it, and tell the windows that show it. */
    remember(folders: string[]): Promise<void>;
    /** Let `window` read the folders. Called again for folders it may already read; must be cheap then. */
    grant(window: W, folders: string[]): void;
    now(): number;
    warn(message: string): void;
}

/**
 * The conversation with the author about folders. One per app, because the rule it keeps is
 * app-wide: one dialog at a time, whichever window asks.
 *
 * - A request for a folder a dialog is already asking about (or one inside it) waits for that
 *   dialog instead of queueing a second one.
 * - A folder the author declined is answered `denied` without a dialog for a minute, so an agent
 *   that retries at once cannot put the same question in front of them again and again.
 * - A caller waits at most `waitMs`; folders still unanswered come back `pending`, and the dialog
 *   stays up. When the author allows later, the folder is remembered, so the agent's retry passes.
 */
export class AgentFolderAccess<W> {
    private queue: Promise<unknown> = Promise.resolve();
    private readonly asking = new Map<string, Promise<boolean>>();
    private readonly declinedAt = new Map<string, number>();

    public constructor(private readonly host: AgentFolderAccessHost<W>) {}

    public async request(window: W, folders: readonly string[], prompt: AgentFolderPrompt, waitMs: number): Promise<AgentFolderAccessAnswer> {
        const rules = this.host.rules();
        const answer: AgentFolderAccessAnswer = { granted: [], denied: [], pending: [], refused: [] };
        const allowed = this.host.allowedFolders(window);
        const uncovered: string[] = [];
        for (const folder of folders) {
            const root = rules.pathApi.isAbsolute(folder) ? allowed.find(candidate => isAgentFolderInside(folder, candidate, rules)) : undefined;
            if (root) {
                pushUnique(answer.granted, root, rules);
            } else {
                uncovered.push(folder);
            }
        }

        if (this.host.fullAccess()) {
            const plan = planAgentFolderRequest(uncovered, rules, Number.POSITIVE_INFINITY);
            answer.refused.push(...plan.refused);
            for (const folder of plan.ask) {
                pushUnique(answer.granted, folder, rules);
            }
            this.grant(window, answer.granted);
            return answer;
        }

        const plan = planAgentFolderRequest(uncovered, rules);
        answer.refused.push(...plan.refused);
        const now = this.host.now();
        const waits: { folder: string; outcome: Promise<boolean> }[] = [];
        const fresh: string[] = [];
        for (const folder of plan.ask) {
            const key = agentFolderKey(folder, rules);
            const declined = this.declinedAt.get(key);
            if (declined !== undefined && now - declined < AGENT_FOLDER_DECLINE_QUIET_MS) {
                answer.denied.push(folder);
                continue;
            }
            const existing = this.asking.get(key)
                ?? [...this.asking.entries()].find(([asked]) => isAgentFolderInside(key, asked, rules))?.[1];
            if (existing) {
                waits.push({ folder, outcome: existing });
            } else {
                fresh.push(folder);
            }
        }
        if (fresh.length > 0) {
            const outcome = this.enqueue(window, fresh, prompt);
            for (const folder of fresh) {
                waits.push({ folder, outcome });
            }
        }

        const settled = new Map<string, boolean>();
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
            Promise.all(waits.map(wait => wait.outcome.then(
                allowedNow => settled.set(wait.folder, allowedNow),
                () => settled.set(wait.folder, false),
            ))),
            new Promise<void>(resolve => {
                timer = setTimeout(resolve, Math.max(0, waitMs));
            }),
        ]);
        clearTimeout(timer);

        for (const { folder } of waits) {
            const outcome = settled.get(folder);
            if (outcome === undefined) {
                answer.pending.push(folder);
            } else if (outcome) {
                pushUnique(answer.granted, folder, rules);
            } else {
                answer.denied.push(folder);
            }
        }
        this.grant(window, answer.granted);
        return answer;
    }

    private grant(window: W, folders: readonly string[]): void {
        if (folders.length === 0 || this.host.isClosed(window)) {
            return;
        }
        try {
            this.host.grant(window, [...folders]);
        } catch (error) {
            this.host.warn(`Could not grant folders to a workspace: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** Queue one dialog for `folders`; resolves to the author's answer, false for a window gone or a dialog that failed. */
    private enqueue(window: W, folders: string[], prompt: AgentFolderPrompt): Promise<boolean> {
        const rules = this.host.rules();
        const run = async (): Promise<boolean> => {
            if (this.host.isClosed(window)) {
                return false;
            }
            // Asked while another dialog was up: that one may have allowed these already, or the
            // author may have switched full access on meanwhile.
            const allowed = this.host.allowedFolders(window);
            const still = folders.filter(folder => !allowed.some(root => isAgentFolderInside(folder, root, rules)));
            if (still.length === 0 || this.host.fullAccess()) {
                return true;
            }
            const allowedNow = await this.host.ask(window, still, prompt);
            if (allowedNow) {
                await this.host.remember(still);
            } else {
                const at = this.host.now();
                for (const folder of still) {
                    this.declinedAt.set(agentFolderKey(folder, rules), at);
                }
            }
            return allowedNow;
        };
        const outcome = this.queue.then(run, run).catch(error => {
            this.host.warn(`The folder access dialog failed: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        });
        this.queue = outcome;
        const keys = folders.map(folder => agentFolderKey(folder, rules));
        for (const key of keys) {
            this.asking.set(key, outcome);
        }
        void outcome.finally(() => {
            for (const key of keys) {
                if (this.asking.get(key) === outcome) {
                    this.asking.delete(key);
                }
            }
        });
        return outcome;
    }
}

function pushUnique(list: string[], folder: string, rules: AgentFolderRules): void {
    const key = agentFolderKey(folder, rules);
    if (!list.some(entry => agentFolderKey(entry, rules) === key)) {
        list.push(folder);
    }
}
