import path from "path";
import {
    AGENT_INTERNAL_TOOL_BUILD,
    AGENT_INTERNAL_TOOL_TEST,
    agentRefusal,
    agentText,
    type AgentCallResult,
    type AgentSessionPolicy,
    type AgentWorkspaceState,
} from "@shared/agent/protocol";
import type { AgentGuideChapter } from "@shared/agent/tools";
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
    route(project: string | null): AgentRoutingChoice<AgentWorkspaceHandle>;
    /** Send a call to a workspace; timeouts and closed windows come back as refusals. */
    forward(handle: AgentWorkspaceHandle, tool: string, args: Record<string, unknown>, context: AgentCallContext): Promise<AgentCallResult>;
    isProjectDirectory(directory: string): Promise<boolean>;
    isTrusted(projectPath: string): boolean;
    defaultProjectsDir(): string;
    /** Open (or find) a project's workspace and wait until it answers `__state`. */
    openProject(projectPath: string): Promise<AgentOpenProjectOutcome>;
    /** Write a new project, register it as Studio's own, open it and wait for it to answer. */
    createProject(input: AgentProjectCreateInput): Promise<AgentCallResult>;
    /** Run a registered test headlessly on a project that is not open. */
    runHeadlessTest(projectPath: string, testId: string): Promise<AgentCallResult>;
}

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
            responding: state !== null,
            paused: state?.paused ?? null,
            follow: state?.follow ?? null,
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
            return `- ${project.name ?? path.basename(project.path)} (${project.path}): ${flags}`;
        }),
        projects.length > 1 ? "More than one project is open: pass `project` (its path) to every workspace tool." : "",
        policy.writesEnabled
            ? "Write access: on."
            : "Write access: OFF. Read tools work; every write is refused until the author turns on \"Allow agents to make changes\" in Studio's Settings > Agent access.",
        policy.allowedImportRoots.length > 0
            ? `You may import files from: ${policy.allowedImportRoots.join(", ")} (and from inside each project).`
            : "You may import files only from inside the project; the author can allow more folders in Settings > Agent access.",
        "Before starting a game, read the workflow with agent_guide { chapter: \"workflow\" }.",
    ].filter(Boolean);
    return agentText(lines.join("\n"), {
        projects,
        writesEnabled: policy.writesEnabled,
        allowedImportRoots: policy.allowedImportRoots,
        endpoint: host.endpointUrl(),
    });
}

async function agentGuide(host: AgentMainToolHost, args: Record<string, unknown>): Promise<AgentCallResult> {
    const chapter = args.chapter as AgentGuideChapter;
    const text = await host.readGuide(chapter);
    if (text === null) {
        return agentRefusal(
            "unavailable",
            `The "${chapter}" chapter of the guide is not installed with this Studio.`,
            "Work from the tool descriptions and the catalogue tools (story_commands, ui_widgets, blueprint_nodes) instead.",
        );
    }
    return agentText(text, { chapter });
}

async function projectCreate(host: AgentMainToolHost, args: Record<string, unknown>): Promise<AgentCallResult> {
    return host.createProject({
        name: String(args.name),
        parentDir: typeof args.dir === "string" && args.dir.trim() ? args.dir : host.defaultProjectsDir(),
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
