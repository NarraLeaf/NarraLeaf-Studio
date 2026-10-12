import path from "path";
import {
    AGENT_INTERNAL_TOOL_BUILD,
    AGENT_INTERNAL_TOOL_TEST,
    agentRefusal,
    agentText,
    type AgentCallResult,
    type AgentFolderAccessAnswer,
    type AgentFolderRefusalReason,
    type AgentSessionPolicy,
    type AgentWorkspaceState,
} from "@shared/agent/protocol";
import { AGENT_GUIDE_CHAPTERS, type AgentGuideChapter } from "@shared/agent/tools";
import { AGENT_PLUGIN_GUIDE_CHAPTER_PREFIX } from "@shared/agent/pluginTools";
import { describeAgentFolderAccess, describeAgentFolderRefusal } from "@shared/agent/folderAccess";
import type { AgentCallContext } from "./agentMcpServer";
import type { AgentRoutingChoice } from "./agentRouting";
import type { AgentProjectCreateInput } from "./agentProjectCreate";

/**
 * The tools the main process answers itself: the session's state, the guide, and the operations
 * that are about projects rather than inside one - creating, opening, testing and building.
 *
 * Written against {@link AgentMainToolHost} rather than the app, so each tool's rules can be tested
 * without Electron, and so this file is the whole of what each tool does with its arguments.
 */

/** One open workspace, as the tools see it. */
export type AgentWorkspaceHandle = {
    projectPath: string;
    /** The project's own name, when its config could be read. */
    name: string | null;
};

export type AgentOpenProjectOutcome =
    | { ok: true; handle: AgentWorkspaceHandle; alreadyOpen: boolean }
    | { ok: false; result: AgentCallResult };

export interface AgentMainToolHost {
    openWorkspaces(): Promise<AgentWorkspaceHandle[]>;
    /** The workspace's `__state` answer, or null when it did not answer in time. */
    workspaceState(handle: AgentWorkspaceHandle): Promise<AgentWorkspaceState | null>;
    policy(): AgentSessionPolicy;
    endpointUrl(): string | null;
    readGuide(chapter: AgentGuideChapter): Promise<string | null>;
    /** Enabled plugins that ship an agent guide chapter (`contributes.agentGuide`). */
    listPluginGuides(): Promise<AgentPluginGuideEntry[]>;
    /** One plugin's chapter, or null when the plugin ships none or it cannot be read. */
    readPluginGuide(pluginId: string): Promise<string | null>;
    /** The advertised names of the plugin tools a workspace reported, sorted. */
    pluginToolsOf(handle: AgentWorkspaceHandle): string[];
    route(project: string | null): AgentRoutingChoice<AgentWorkspaceHandle>;
    /** Send a call to a workspace; timeouts and closed windows come back as refusals. */
    forward(handle: AgentWorkspaceHandle, tool: string, args: Record<string, unknown>, context: AgentCallContext): Promise<AgentCallResult>;
    isProjectDirectory(directory: string): Promise<boolean>;
    isTrusted(projectPath: string): boolean;
    /**
     * Why an agent may never be handed `folder` (absolute, resolved) - Studio's own folders, the home
     * folder itself, a file-system root or a folder holding the home folder - or null. The rule
     * folder reads are held to (`agentFolderRefusal`), applied here to the folders a tool writes into.
     */
    folderRefusal(folder: string): AgentFolderRefusalReason | null;
    defaultProjectsDir(): string;
    /** Open (or find) a project's workspace and wait until it answers `__state`. */
    openProject(projectPath: string): Promise<AgentOpenProjectOutcome>;
    /** Write a new project, register it as Studio's own, open it and wait for it to answer. */
    createProject(input: AgentProjectCreateInput): Promise<AgentCallResult>;
    /** Run a registered test headlessly on a project that is not open. */
    runHeadlessTest(projectPath: string, testId: string): Promise<AgentCallResult>;
    /**
     * Ask the author, in a dialog parented to the workspace, to let agents read the folders holding
     * `paths`. Answers within about a minute; folders still unanswered then come back `pending`.
     */
    requestFolderAccess(handle: AgentWorkspaceHandle, paths: readonly string[], context: AgentCallContext, reason?: string): Promise<AgentFolderAccessAnswer>;
}

/** A plugin's guide chapter, as the chapter list names it. */
export type AgentPluginGuideEntry = { pluginId: string; name: string };

export type AgentMainToolHandler = (
    host: AgentMainToolHost,
    args: Record<string, unknown>,
    context: AgentCallContext,
) => Promise<AgentCallResult>;

/**
 * One handler per `side: "main"` row of the tool table, and nothing else - a test holds the two to
 * the same set of names.
 */
export const AGENT_MAIN_TOOL_HANDLERS: Readonly<Record<string, AgentMainToolHandler>> = {
    agent_status: agentStatus,
    agent_guide: agentGuide,
    request_folder_access: requestFolderAccess,
    project_create: projectCreate,
    project_open: projectOpen,
    test: runTest,
    build: runBuild,
};

async function agentStatus(host: AgentMainToolHost): Promise<AgentCallResult> {
    const policy = host.policy();
    const workspaces = await host.openWorkspaces();
    const projects = await Promise.all(workspaces.map(async handle => {
        const state = await host.workspaceState(handle);
        return {
            path: handle.projectPath,
            name: handle.name,
            trusted: host.isTrusted(handle.projectPath),
            responding: state !== null,
            paused: state?.paused ?? null,
            follow: state?.follow ?? null,
            pluginTools: host.pluginToolsOf(handle),
        };
    }));
    const lines = [
        projects.length === 0
            ? "No project is open in Studio. Call project_open with a project directory, or project_create to start a new one."
            : `Open projects (${projects.length}):`,
        ...projects.map(project => {
            const flags = !project.responding
                ? "not answering yet"
                : [project.paused ? "PAUSED by the author - writes are refused until they resume" : "active", project.follow ? "follow mode on" : "follow mode off"].join(", ");
            const tools = project.pluginTools.length > 0
                ? `\n  Plugin tools here: ${project.pluginTools.join(", ")}. If your tool list lacks them, list tools again (your client may cache the list).`
                : "";
            const trust = project.trusted
                ? ""
                : "\n  NOT TRUSTED by the author: you may read it, but changes, folder access outside it and imports are refused until they trust it.";
            return `- ${project.name ?? path.basename(project.path)} (${project.path}): ${flags}${trust}${tools}`;
        }),
        projects.length > 1 ? "More than one project is open: pass `project` (its path) to every workspace tool." : "",
        policy.writesEnabled
            ? "Write access: on."
            : "Write access: OFF. Read tools work; every write is refused until the author turns on \"Allow agents to change projects\" in Studio's Settings > Agent access.",
        policy.fullAccess
            ? "Full access: on. You may read files in any folder without asking, except Studio's own folders, the home folder as a whole and file-system roots."
            : policy.allowedImportRoots.length > 0
                ? `You may import files from: ${policy.allowedImportRoots.join(", ")} (and from inside each project). For a file anywhere else, Studio asks the author to allow its folder; call request_folder_access first for a big import.`
                : "You may import files from inside the project. For a file anywhere else, Studio asks the author to allow its folder; call request_folder_access first for a big import.",
        "Before starting a game, read the workflow with agent_guide { chapter: \"workflow\" }.",
    ].filter(Boolean);
    return agentText(lines.join("\n"), {
        projects,
        writesEnabled: policy.writesEnabled,
        fullAccess: policy.fullAccess === true,
        allowedImportRoots: policy.allowedImportRoots,
        endpoint: host.endpointUrl(),
    });
}

async function agentGuide(host: AgentMainToolHost, args: Record<string, unknown>): Promise<AgentCallResult> {
    const chapter = typeof args.chapter === "string" ? args.chapter.trim() : "";
    if (!chapter) {
        return agentText(await chapterList(host), { chapters: [...AGENT_GUIDE_CHAPTERS], plugins: await host.listPluginGuides() });
    }
    if (chapter.startsWith(AGENT_PLUGIN_GUIDE_CHAPTER_PREFIX)) {
        const pluginId = chapter.slice(AGENT_PLUGIN_GUIDE_CHAPTER_PREFIX.length).trim();
        const guides = await host.listPluginGuides();
        if (!guides.some(guide => guide.pluginId === pluginId)) {
            return agentRefusal("not_found", `No enabled plugin called "${pluginId}" ships a guide chapter.`, await chapterList(host));
        }
        const text = await host.readPluginGuide(pluginId);
        if (text === null) {
            return agentRefusal("unavailable", `The guide chapter of the plugin ${pluginId} could not be read.`, "Work from that plugin's tool descriptions instead.");
        }
        return agentText(text, { chapter });
    }
    if (!(AGENT_GUIDE_CHAPTERS as readonly string[]).includes(chapter)) {
        return agentRefusal("not_found", `There is no guide chapter called "${chapter}".`, await chapterList(host));
    }
    const text = await host.readGuide(chapter as AgentGuideChapter);
    if (text === null) {
        return agentRefusal(
            "unavailable",
            `The "${chapter}" chapter of the guide is not installed with this Studio.`,
            "Work from the tool descriptions and the catalogue tools (story_commands, ui_widgets, blueprint_nodes) instead.",
        );
    }
    return agentText(text, { chapter });
}

/** Every chapter there is: Studio's own, then the ones the enabled plugins ship. */
async function chapterList(host: AgentMainToolHost): Promise<string> {
    const plugins = await host.listPluginGuides();
    return [
        `Chapters: ${AGENT_GUIDE_CHAPTERS.join(", ")}.`,
        plugins.length > 0
            ? `Plugin chapters: ${plugins.map(guide => `${AGENT_PLUGIN_GUIDE_CHAPTER_PREFIX}${guide.pluginId} (${guide.name})`).join(", ")}.`
            : "No enabled plugin ships a chapter.",
        "Pass one as `chapter`; start with `workflow`.",
    ].join("\n");
}

/** Longest `reason` shown in the dialog; the rest is cut, so an agent cannot fill the author's screen. */
const FOLDER_REASON_MAX = 300;

async function requestFolderAccess(host: AgentMainToolHost, args: Record<string, unknown>, context: AgentCallContext): Promise<AgentCallResult> {
    const paths = Array.isArray(args.paths) ? args.paths.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "") : [];
    if (paths.length === 0) {
        return agentRefusal("invalid_args", "`paths` must list at least one absolute path.");
    }
    if (paths.length > 500) {
        return agentRefusal("invalid_args", "Ask about at most 500 paths per call.");
    }
    const relative = paths.filter(entry => !path.isAbsolute(entry));
    if (relative.length > 0) {
        return agentRefusal("invalid_args", `Paths must be absolute: ${relative.slice(0, 5).join(", ")}.`);
    }
    const project = typeof args.project === "string" && args.project ? path.resolve(args.project) : null;
    const choice = host.route(project);
    if (!choice.ok) {
        return noWorkspace(choice);
    }
    if (!host.isTrusted(choice.window.projectPath)) {
        // Refused before the author is asked: a dialog whose "Allow" main would not act on is noise.
        return agentRefusal(
            "untrusted",
            `${choice.window.projectPath} is not trusted in Studio, so agents are given no folders outside it.`,
            "Ask the author to trust the project (Studio's status bar, or Settings > Data > Trusted projects), or to copy the files into the project directory.",
        );
    }
    const reason = typeof args.reason === "string" ? oneLine(args.reason).slice(0, FOLDER_REASON_MAX) : "";
    const answer = await host.requestFolderAccess(choice.window, paths, context, reason || undefined);
    return agentText(describeAgentFolderAccess(answer).join("\n") || "Nothing to ask about.", { ...answer, project: choice.window.projectPath });
}

/** Line breaks and control characters out: the reason is one line of the dialog, in the agent's words. */
function oneLine(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The refusal for a folder a tool would write into that agents may never be handed. Writing is not
 * narrower than reading here: `project_create` makes every folder down to the one it names, and a
 * web build clears a folder inside its output before writing it, so `/`, the home folder or Studio's
 * settings folder named as either is a request to write - or delete - where nothing of a game belongs.
 */
function writeFolderRefused(argument: string, folder: string, reason: AgentFolderRefusalReason, hint: string): AgentCallResult {
    return agentRefusal(
        "path_not_allowed",
        `\`${argument}\` cannot be ${folder}, which is ${whatTheFolderIs(reason)}: agents are never handed that folder to read, and Studio does not write into it for them either.`,
        hint,
    );
}

function whatTheFolderIs(reason: AgentFolderRefusalReason): string {
    switch (reason) {
        case "root":
            return "a file-system root, or a folder holding the home folder";
        case "home":
            return "the home folder itself";
        case "studio":
            return "one of Studio's own folders (its settings or the application), or a folder holding one";
        default:
            return describeAgentFolderRefusal(reason);
    }
}

async function projectCreate(host: AgentMainToolHost, args: Record<string, unknown>): Promise<AgentCallResult> {
    const dir = typeof args.dir === "string" && args.dir.trim() ? args.dir : null;
    if (dir && path.isAbsolute(dir)) {
        // Only a folder the agent named: the default is Studio's own choice of projects folder.
        const refused = host.folderRefusal(path.resolve(dir));
        if (refused) {
            return writeFolderRefused(
                "dir",
                path.resolve(dir),
                refused,
                "Name a folder of its own for projects (for example one inside Documents), or leave `dir` out to use Studio's projects folder.",
            );
        }
    }
    return host.createProject({
        name: String(args.name),
        parentDir: dir ?? host.defaultProjectsDir(),
        template: args.template === "empty" ? "empty" : "skeleton",
        language: typeof args.language === "string" && args.language.trim() ? args.language : "en",
        languages: Array.isArray(args.languages) ? args.languages.filter((code): code is string => typeof code === "string") : [],
        width: typeof args.width === "number" ? args.width : 1920,
        height: typeof args.height === "number" ? args.height : 1080,
    });
}

async function projectOpen(host: AgentMainToolHost, args: Record<string, unknown>): Promise<AgentCallResult> {
    const requested = String(args.path);
    if (!path.isAbsolute(requested)) {
        return agentRefusal("invalid_args", `path must be absolute: ${requested}`);
    }
    const projectPath = path.resolve(requested);
    if (!await host.isProjectDirectory(projectPath)) {
        return agentRefusal(
            "not_found",
            `${projectPath} is not a NarraLeaf project (no .nlproj file in it).`,
            "Pass the project's own directory, or create one with project_create.",
        );
    }
    const opened = await host.openProject(projectPath);
    if (!opened.ok) {
        return opened.result;
    }
    const name = opened.handle.name ?? path.basename(opened.handle.projectPath);
    return agentText(
        opened.alreadyOpen
            ? `${name} is already open in Studio (${opened.handle.projectPath}).`
            : `Opened ${name} in Studio (${opened.handle.projectPath}). Call project_info for an overview.`,
        { project: opened.handle.projectPath, name: opened.handle.name, alreadyOpen: opened.alreadyOpen },
    );
}

async function runTest(host: AgentMainToolHost, args: Record<string, unknown>, context: AgentCallContext): Promise<AgentCallResult> {
    const testId = String(args.id);
    const project = typeof args.project === "string" && args.project ? path.resolve(args.project) : null;
    const choice = host.route(project);
    if (choice.ok) {
        // One project is one window, so a project the author has open is tested by that window.
        return translateUnsupported(
            await host.forward(choice.window, AGENT_INTERNAL_TOOL_TEST, { id: testId }, context),
            "This Studio's workspace cannot run tests for agents yet.",
        );
    }
    if (!project) {
        return noWorkspace(choice);
    }
    if (!await host.isProjectDirectory(project)) {
        return agentRefusal("not_found", `${project} is not a NarraLeaf project (no .nlproj file in it).`);
    }
    if (!host.isTrusted(project)) {
        return untrusted(project);
    }
    return host.runHeadlessTest(project, testId);
}

async function runBuild(host: AgentMainToolHost, args: Record<string, unknown>, context: AgentCallContext): Promise<AgentCallResult> {
    const project = typeof args.project === "string" && args.project ? path.resolve(args.project) : null;
    const choice = host.route(project);
    if (!choice.ok) {
        if (project && choice.reason !== "ambiguous") {
            return agentRefusal(
                "unavailable",
                `${project} is not open in Studio. Builds run through the open project's own build pipeline.`,
                "Call project_open with that path, then build again.",
            );
        }
        return noWorkspace(choice);
    }
    if (!host.isTrusted(choice.window.projectPath)) {
        return untrusted(choice.window.projectPath);
    }
    if (typeof args.output === "string" && !path.isAbsolute(args.output)) {
        return agentRefusal("invalid_args", `output must be an absolute directory: ${args.output}`);
    }
    if (typeof args.output === "string") {
        const refused = host.folderRefusal(path.resolve(args.output));
        if (refused) {
            return writeFolderRefused(
                "output",
                path.resolve(args.output),
                refused,
                "Name a folder of its own for the build, or leave `output` out to build into the project's usual output folder.",
            );
        }
    }
    return translateUnsupported(
        await host.forward(
            choice.window,
            AGENT_INTERNAL_TOOL_BUILD,
            {
                target: typeof args.target === "string" ? args.target : "current",
                ...(typeof args.output === "string" ? { output: path.resolve(args.output) } : {}),
            },
            context,
        ),
        "This Studio's workspace cannot run builds for agents yet.",
    );
}

/** The refusal for a call that could not be given a workspace, naming the projects that are open. */
export function noWorkspace(choice: Extract<AgentRoutingChoice<unknown>, { ok: false }>): AgentCallResult {
    switch (choice.reason) {
        case "none-open":
            return agentRefusal(
                "no_workspace",
                "No project is open in Studio.",
                "Call project_open with a project directory, or project_create to start one.",
            );
        case "not-open":
            return agentRefusal(
                "no_workspace",
                "That project is not open in Studio.",
                `Open projects: ${choice.openProjects.join(", ")}. Pass one of these as \`project\`, or call project_open first.`,
            );
        case "ambiguous":
            return agentRefusal(
                "no_workspace",
                "More than one project is open in Studio and the call did not say which.",
                `Pass \`project\` with one of: ${choice.openProjects.join(", ")}.`,
            );
    }
}

/**
 * The refusal for a change to a project that is not trusted. Reading it stays open: looking at a
 * project is what an author does before deciding to trust it, and an agent can help with that.
 */
export function untrustedForChanges(projectPath: string): AgentCallResult {
    return agentRefusal(
        "untrusted",
        `${projectPath} is not trusted in Studio, so agents may read it but not change it.`,
        "Ask the author to trust the project (Studio's status bar, or Settings > Data > Trusted projects), then try again. Read tools keep working meanwhile.",
    );
}

function untrusted(projectPath: string): AgentCallResult {
    return agentRefusal(
        "untrusted",
        `${projectPath} is not trusted, so its code may not run here.`,
        "Ask the author to trust the project (Studio's status bar, or Settings > Data > Trusted projects).",
    );
}

/** A workspace that does not know an internal call answers `unknown_tool`; say what that means here. */
function translateUnsupported(result: AgentCallResult, message: string): AgentCallResult {
    return !result.ok && result.error.code === "unknown_tool" ? agentRefusal("unavailable", message) : result;
}
