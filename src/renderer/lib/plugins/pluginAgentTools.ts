/**
 * `app.services.agent`: a plugin's tools for the AI agents an author connects to Studio.
 *
 * One facade per loaded plugin, built by `createPluginApp`. It does three things, and the third is
 * why it exists as a module of its own rather than a few lines in the app object:
 *
 *  - **Registers** a tool after holding it to its declaration: owned name, declared in
 *    `contributes.agentTools` with the same `write`, an advertised name a client accepts, a schema
 *    the argument checker understands, title and description within their limits. Anything else
 *    throws at load, which is when the plugin's author is looking.
 *  - **Runs** a call: arguments checked against the plugin's own schema (main checked them against
 *    the advertised copy already; this is the copy that matters), `project` taken out, the handler
 *    given the arguments and the client's name and nothing else, and whatever it returns held to
 *    the answer limits (`normalizePluginAgentToolResult`). The gate - write access, pause, freeze,
 *    a live session - is the bridge's, before any of this, and a plugin cannot opt out of it.
 *  - **Watches the plugin's storage** for the length of the call. A reading tool that writes its
 *    plugin's storage is refused at `writeJson` - and that is all a reading tool is held to: the
 *    host sees no other route a plugin has to the project, and the author's write switch gates only
 *    tools declared `write: true`. A writing tool's writes are captured - the store as it was before the
 *    first write to each namespace, and as the last write left it - and pushed as one command on
 *    the project's undo stack, labelled with the tool's title. Undo and redo write the snapshots
 *    back through the same store and then run the plugin's reloader, the hook it already has for
 *    version-control restores, so a plugin that keeps its data in storage gets one-step undo of an
 *    agent's edit without writing a line for it.
 *
 * Calls reach a plugin one at a time (the bridge queues every call in the window), so "during the
 * call" is a single flag rather than something that has to follow async work around. The cost of
 * that simplicity: a write the author makes in the plugin's own panel while one of its tools is
 * running is treated as the tool's - refused if the tool reads, part of the step if it writes.
 * Scoping it to the tool's own writes would take either an async context the renderer does not
 * have, or a writer handed to the handler - and plugins (the Gallery among them) write through
 * `services.storage` from code shared with their panels, so that would be an API change for every
 * plugin with a tool, not a fix inside the host.
 *
 * Comments in English per project convention.
 */

import { agentRefusal, type AgentCallResult } from "@shared/agent/protocol";
import { validateAgentArgs } from "@shared/agent/validateArgs";
import {
    AGENT_PLUGIN_TOOL_DESCRIPTION_MAX,
    AGENT_PLUGIN_TOOL_TITLE_MAX,
    agentPluginToolMcpName,
    checkAgentPluginToolSchema,
    normalizePluginAgentToolResult,
    withAgentProjectArgument,
    withoutAgentProjectArgument,
    type AgentPluginToolDescriptor,
    type PluginAgentToolDef,
} from "@shared/agent/pluginTools";
import { AGENT_TOOLS_BY_NAME } from "@shared/agent/tools";
import type { PluginAgentToolContribution } from "@shared/types/plugins";
import type { TranslationKey } from "@shared/i18n";
import type { HistoryLabel } from "@/lib/workspace/services/history/historyModel";
import type { PluginAgentToolRegistry } from "@/lib/workspace/services/agent/pluginToolRegistry";

/** The plugin's own store namespaces, unprefixed, as `services.storage` names them. */
export type PluginAgentStorageAccess = {
    /** The stored JSON, or null when the namespace has never been written. Throws when it cannot be read. */
    read(namespace: string): Promise<unknown | null>;
    write(namespace: string, data: unknown): Promise<void>;
    /** Remove a namespace that did not exist before the call wrote it. */
    remove(namespace: string): Promise<void>;
};

export type PluginAgentHistory = {
    pushCommand(request: { label: HistoryLabel; undo: () => Promise<void>; redo: () => Promise<void> }): void;
};

export type PluginAgentFacadeOptions = {
    pluginId: string;
    /** The manifest's name: identity, untranslated, for main's listings. */
    pluginName: string;
    declared: readonly PluginAgentToolContribution[];
    registry: PluginAgentToolRegistry;
    /** The plugin's disposables bag: every registration is taken back with the plugin. */
    track: (disposer: () => void) => void;
    storage: PluginAgentStorageAccess;
    /** The project's undo stack, or null when there is none (a unit test, a command-line run). */
    history: () => PluginAgentHistory | null;
    /** Run the reloader the plugin registered with `services.workspace.registerReloader`, if any. */
    reload: () => Promise<void>;
};

export type PluginAgentService = {
    /** Offer one tool to agents. Returns a cleanup that withdraws it; the host also withdraws it on unload. */
    registerTool(def: PluginAgentToolDef): () => void;
    /** Several at once; all are checked before any is offered. */
    registerTools(defs: PluginAgentToolDef[]): () => void;
};

export type PluginAgentFacade = {
    service: PluginAgentService;
    /**
     * Called by `services.storage.writeJson` before it writes. Throws while a reading tool runs.
     * While a writing tool runs, captures the namespace's current content (once per call) and
     * answers the function to call with what was written; outside a call, answers null.
     */
    beforeStorageWrite(namespace: string): Promise<((written: unknown) => void) | null>;
};

/** The undo step's name: "agent: <tool title>". */
export const PLUGIN_AGENT_HISTORY_LABEL_KEY = "workspace.history.entry.agentPluginEdit" as TranslationKey;

type Capture = {
    /** Read before the first write; null when the namespace did not exist. */
    before: Promise<unknown | null>;
    after: unknown;
    wrote: boolean;
};

type ActiveCall = {
    write: boolean;
    pluginToolName: string;
    captures: Map<string, Capture>;
};

export function createPluginAgentFacade(options: PluginAgentFacadeOptions): PluginAgentFacade {
    const { pluginId } = options;
    let active: ActiveCall | null = null;

    const prepare = (def: PluginAgentToolDef): AgentPluginToolDescriptor => {
        const fail = (reason: string): never => {
            throw new Error(`[plugin:${pluginId}] agent tool ${JSON.stringify(def?.name)}: ${reason}`);
        };
        if (!def || typeof def !== "object") {
            fail("the definition must be an object");
        }
        const name = typeof def.name === "string" ? def.name.trim() : "";
        if (!name.startsWith(`${pluginId}.`)) {
            fail(`the name must be prefixed with "${pluginId}."`);
        }
        const mcpName = agentPluginToolMcpName(pluginId, name);
        if (!mcpName) {
            fail("the name may use only lower-case letters, digits, \"_\", \".\" and \"-\", and must map to an advertised name of at most 64 characters");
        }
        if (AGENT_TOOLS_BY_NAME.has(mcpName!)) {
            fail(`it would be offered as ${mcpName}, which is a built-in tool`);
        }
        const declared = options.declared.find(entry => entry.name === name);
        if (!declared) {
            fail("it is not declared in the manifest's contributes.agentTools. Declare it so the author is told about it before the plugin loads");
        }
        if (typeof def.write !== "boolean" || def.write !== declared!.write) {
            fail(`write must be ${declared!.write}, as contributes.agentTools declares it`);
        }
        const title = typeof def.title === "string" ? def.title.trim() : "";
        if (!title || title.length > AGENT_PLUGIN_TOOL_TITLE_MAX) {
            fail(`the title must be 1-${AGENT_PLUGIN_TOOL_TITLE_MAX} characters`);
        }
        const description = typeof def.description === "string" ? def.description.trim() : "";
        if (!description || description.length > AGENT_PLUGIN_TOOL_DESCRIPTION_MAX) {
            fail(`the description must be 1-${AGENT_PLUGIN_TOOL_DESCRIPTION_MAX} characters`);
        }
        const schemaErrors = checkAgentPluginToolSchema(def.inputSchema);
        if (schemaErrors.length > 0) {
            fail(schemaErrors.join("; "));
        }
        if (typeof def.handler !== "function") {
            fail("handler must be a function");
        }
        return {
            name: mcpName!,
            title,
            description,
            side: "workspace",
            write: def.write,
            // A copy, so the plugin cannot change what is advertised after it was checked.
            inputSchema: withAgentProjectArgument(JSON.parse(JSON.stringify(def.inputSchema))),
            pluginId,
            pluginName: options.pluginName,
            pluginToolName: name,
        };
    };

    const recordUndo = async (call: ActiveCall, title: string): Promise<void> => {
        const steps: { namespace: string; before: unknown | null; after: unknown }[] = [];
        for (const [namespace, capture] of call.captures) {
            if (!capture.wrote) {
                continue;
            }
            const before = await capture.before.catch(() => undefined);
            if (before === undefined) {
                continue;
            }
            if (JSON.stringify(before) !== JSON.stringify(capture.after)) {
                steps.push({ namespace, before, after: capture.after });
            }
        }
        if (steps.length === 0) {
            return;
        }
        const restore = async (side: "before" | "after") => {
            const ordered = side === "before" ? [...steps].reverse() : steps;
            for (const step of ordered) {
                const value = step[side];
                if (value === null) {
                    await options.storage.remove(step.namespace);
                } else {
                    await options.storage.write(step.namespace, clone(value));
                }
            }
            await options.reload();
        };
        options.history()?.pushCommand({
            label: { key: PLUGIN_AGENT_HISTORY_LABEL_KEY, params: { tool: title } },
            undo: () => restore("before"),
            redo: () => restore("after"),
        });
    };

    const runnerFor = (def: PluginAgentToolDef, descriptor: AgentPluginToolDescriptor) =>
        async (args: Record<string, unknown>, call: { clientName: string | null }): Promise<AgentCallResult> => {
            const own = withoutAgentProjectArgument(args);
            const validation = validateAgentArgs(def.inputSchema, own);
            if (!validation.ok) {
                return agentRefusal("invalid_args", validation.errors.join("; "), `Check ${descriptor.name}'s inputSchema in tools/list.`);
            }
            if (active) {
                return agentRefusal("unavailable", `${descriptor.name} cannot run while another of this plugin's tools is running.`, "Wait for the other call to answer, then try again.");
            }
            const current: ActiveCall = { write: def.write, pluginToolName: descriptor.pluginToolName, captures: new Map() };
            active = current;
            let result: AgentCallResult;
            try {
                const answer = await def.handler(clone(own) as Record<string, unknown>, Object.freeze({ clientName: call.clientName }));
                result = normalizePluginAgentToolResult(answer, descriptor.name);
            } catch (error) {
                result = agentRefusal(
                    "internal",
                    `${descriptor.name} (plugin ${pluginId}) failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            } finally {
                active = null;
            }
            // Recorded whether the handler answered or threw: what it wrote before failing is on disk
            // either way, and the author must be able to take it back.
            if (current.write && current.captures.size > 0) {
                try {
                    await recordUndo(current, descriptor.title);
                } catch (error) {
                    console.error(`[plugin:${pluginId}] could not record undo for ${descriptor.name}`, error);
                }
            }
            return result;
        };

    const register = (def: PluginAgentToolDef, descriptor: AgentPluginToolDescriptor): (() => void) => {
        const dispose = options.registry.register({ descriptor, run: runnerFor(def, descriptor) });
        options.track(dispose);
        return dispose;
    };

    return {
        service: {
            registerTool: def => register(def, prepare(def)),
            registerTools: defs => {
                if (!Array.isArray(defs)) {
                    throw new Error(`[plugin:${pluginId}] registerTools takes an array of tool definitions`);
                }
                // Every definition checked before any is offered, so a mistake in the last one does
                // not leave the first half registered.
                const prepared = defs.map(def => ({ def, descriptor: prepare(def) }));
                const disposers = prepared.map(({ def, descriptor }) => register(def, descriptor));
                return () => {
                    for (const dispose of disposers.reverse()) {
                        dispose();
                    }
                };
            },
        },
        async beforeStorageWrite(namespace) {
            const call = active;
            if (!call) {
                return null;
            }
            if (!call.write) {
                throw new Error(
                    `${call.pluginToolName} is registered as a reading tool (write: false), so it may not write plugin storage. `
                    + "Declare and register it with write: true if it changes the project.",
                );
            }
            let capture = call.captures.get(namespace);
            if (!capture) {
                capture = { before: options.storage.read(namespace).then(clone), after: undefined, wrote: false };
                call.captures.set(namespace, capture);
            }
            // A store that cannot be read first cannot be put back, so it is not written either.
            await capture.before;
            const target = capture;
            return written => {
                target.after = clone(written);
                target.wrote = true;
            };
        },
    };
}

function clone<T>(value: T): T {
    return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}
