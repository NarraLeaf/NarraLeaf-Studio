import path from "path";
import type { AgentCallResult } from "@shared/agent/protocol";
import type { AgentMainActivity } from "@shared/agent/workspaceAccess";

/**
 * The main-process halves of the workspace's Agent menu and Agent log that are worth testing on
 * their own: what a log line says about a call main answered, which window it belongs to, and how
 * the bundled skill is copied out.
 *
 * Comments in English per project convention.
 */

/**
 * The one thing a main-answered call was about, for its log row - from a fixed field per tool, so a
 * row can never carry an argument nobody chose to show.
 */
export function summarizeMainCall(tool: string, args: Record<string, unknown>, result: AgentCallResult): string | null {
    const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
    switch (tool) {
        case "project_create":
            return text(args.name);
        case "project_open": {
            const target = text(args.path);
            return target ? path.basename(target) : null;
        }
        case "agent_guide":
            return text(args.chapter);
        case "test":
            return text(args.id);
        case "build":
            return text(args.target) ?? (result.ok ? "current" : null);
        default:
            return null;
    }
}

/**
 * The project a main-answered call concerns, when it names one: the project it created or opened,
 * else the `project` argument. Null sends the log line to every workspace window.
 */
export function activityProjectPath(tool: string, args: Record<string, unknown>, result: AgentCallResult): string | null {
    if (result.ok && typeof result.structured?.project === "string" && result.structured.project) {
        return path.resolve(result.structured.project);
    }
    if (tool === "project_open" && typeof args.path === "string" && args.path) {
        return path.resolve(args.path);
    }
    if (typeof args.project === "string" && args.project) {
        return path.resolve(args.project);
    }
    return null;
}

/** Build the line a workspace's Agent log records for a call main answered. */
export function mainActivity(
    tool: string,
    args: Record<string, unknown>,
    result: AgentCallResult,
    clientName: string | null,
    durationMs: number,
): AgentMainActivity {
    const base = { tool, clientName, durationMs: Math.max(0, Math.round(durationMs)), summary: summarizeMainCall(tool, args, result) };
    return result.ok
        ? { ...base, ok: true }
        : { ...base, ok: false, code: result.error.code, message: result.error.message, ...(result.error.hint ? { hint: result.error.hint } : {}) };
}

/** The file operations a skill export needs; injected so the copy can be tested on a temporary directory. */
export type SkillExportFs = {
    readdir(dir: string, options: { withFileTypes: true }): Promise<{ name: string; isDirectory(): boolean; isFile(): boolean }[]>;
    mkdir(dir: string, options: { recursive: true }): Promise<unknown>;
    copyFile(from: string, to: string): Promise<void>;
};

/** Whether `dir` exists and holds anything. A missing directory is empty. */
export async function isNonEmptyDirectory(fs: Pick<SkillExportFs, "readdir">, dir: string): Promise<boolean> {
    try {
        return (await fs.readdir(dir, { withFileTypes: true })).length > 0;
    } catch {
        return false;
    }
}

/**
 * Copy the skill tree into `target`, file by file. Files of the same name are replaced; anything
 * else already in `target` is left where it is - an export never deletes the author's files.
 * Symbolic links and other special entries in the source are skipped.
 */
export async function copySkillTree(fs: SkillExportFs, source: string, target: string): Promise<number> {
    await fs.mkdir(target, { recursive: true });
    let copied = 0;
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name);
        const to = path.join(target, entry.name);
        if (entry.isDirectory()) {
            copied += await copySkillTree(fs, from, to);
        } else if (entry.isFile()) {
            await fs.copyFile(from, to);
            copied += 1;
        }
    }
    return copied;
}
