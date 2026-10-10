/**
 * The agent tools the plugins loaded in one workspace have registered.
 *
 * One registry per workspace context, the same keying `workspacePluginSession` uses, because plugins
 * are loaded per window and a tool belongs to the window whose plugin registered it. The plugin side
 * (`lib/plugins/pluginAgentTools.ts`) puts tools in and takes them out with the plugin's disposables;
 * the bridge reads it to run a call, and reports every change to main so `tools/list` follows.
 *
 * Comments in English per project convention.
 */

import { isAgentInternalToolName, type AgentCallResult } from "@shared/agent/protocol";
import type { AgentPluginToolDescriptor } from "@shared/agent/pluginTools";

/** Runs one call to the tool: arguments already checked, `project` already removed. Always resolves. */
export type PluginAgentToolRunner = (args: Record<string, unknown>, call: { clientName: string | null }) => Promise<AgentCallResult>;

export type RegisteredPluginAgentTool = {
    descriptor: AgentPluginToolDescriptor;
    run: PluginAgentToolRunner;
};

export class PluginAgentToolRegistry {
    private readonly tools = new Map<string, RegisteredPluginAgentTool>();
    private readonly listeners = new Set<() => void>();
    private snapshot: readonly AgentPluginToolDescriptor[] = [];

    /**
     * Add a tool under its advertised name. A plugin registering a name it already holds replaces
     * its own tool (a plugin that re-runs setup); a name another plugin holds is refused, since two
     * plugin ids can flatten to the same advertised name.
     */
    public register(tool: RegisteredPluginAgentTool): () => void {
        if (!tool.descriptor.pluginId || isAgentInternalToolName(tool.descriptor.name)) {
            // `agentPluginToolMcpName` never produces such a name; held here as well because the
            // bridge reads a `__` name as an internal call and must never find a plugin under it.
            throw new Error(`Agent tool ${tool.descriptor.pluginToolName} cannot be offered as ${tool.descriptor.name}: names starting with "__" are Studio's own.`);
        }
        const existing = this.tools.get(tool.descriptor.name);
        if (existing && existing.descriptor.pluginId !== tool.descriptor.pluginId) {
            throw new Error(
                `Agent tool ${tool.descriptor.pluginToolName} would be offered as ${tool.descriptor.name}, `
                + `which ${existing.descriptor.pluginId} already offers.`,
            );
        }
        this.tools.set(tool.descriptor.name, tool);
        this.changed();
        return () => {
            if (this.tools.get(tool.descriptor.name) === tool) {
                this.tools.delete(tool.descriptor.name);
                this.changed();
            }
        };
    }

    public get(name: string): RegisteredPluginAgentTool | undefined {
        return this.tools.get(name);
    }

    /** Every descriptor, sorted by name. A new array after every change. */
    public readonly list = (): readonly AgentPluginToolDescriptor[] => this.snapshot;

    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private changed(): void {
        this.snapshot = [...this.tools.values()]
            .map(tool => tool.descriptor)
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (error) {
                console.error("[AgentPluginTools] a listener failed", error);
            }
        }
    }
}

const registries = new WeakMap<object, PluginAgentToolRegistry>();

/** The registry of the workspace `ctx` belongs to. */
export function pluginAgentToolRegistry(ctx: object): PluginAgentToolRegistry {
    let registry = registries.get(ctx);
    if (!registry) {
        registry = new PluginAgentToolRegistry();
        registries.set(ctx, registry);
    }
    return registry;
}
