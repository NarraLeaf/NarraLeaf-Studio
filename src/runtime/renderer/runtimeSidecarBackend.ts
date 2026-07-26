/**
 * The game shell's sidecar backend: the preload bridge, plus the one thing the
 * bridge cannot answer.
 *
 * `RuntimePluginSidecarBackend.available()` is synchronous, and deliberately so
 * — a plugin decides at setup time whether its feature exists at all, and an
 * await there would make "do I have a sidecar" a question with a loading state.
 * Nothing over IPC can answer synchronously, so availability is computed from
 * two things the renderer can hold locally:
 *
 *   1. the pack, which is the authority on which sidecars this build shipped for
 *      this platform (a plugin may declare five and ship none here), and
 *   2. the `unavailable` push, which is the main process saying it has stopped
 *      restarting one and will not try again.
 *
 * The pack arrives before any plugin's `setup()` runs (the loader is started
 * from the same effect that read it), so the answer is never a racy "not yet".
 */

import type { GameRuntimePackV1, GameRuntimeSidecarBridge } from "@shared/types/gameRuntime";
import type { RuntimePluginSidecarBackend } from "@/lib/ui-editor/runtime/plugins/runtimePluginHost";

function key(pluginId: string, sidecarId: string): string {
    return `${pluginId} ${sidecarId}`;
}

export class RuntimeSidecarBackend implements RuntimePluginSidecarBackend {
    private declared = new Set<string>();
    private readonly unavailable = new Set<string>();

    public constructor(
        private readonly bridge: GameRuntimeSidecarBridge,
        private readonly log: (level: "info" | "warning" | "error", message: string) => void,
    ) {
        bridge.onUnavailable(({ pluginId, sidecarId, reason }) => {
            this.unavailable.add(key(pluginId, sidecarId));
            this.log("warning", `sidecar ${pluginId}/${sidecarId} is no longer available: ${reason}`);
        });
    }

    /** Seed the declared set from the pack. Called once, before plugins load. */
    public applyPack(pack: GameRuntimePackV1): void {
        const declared = new Set<string>();
        for (const plugin of pack.plugins ?? []) {
            for (const sidecar of plugin.sidecars ?? []) {
                declared.add(key(plugin.manifest.id, sidecar.id));
            }
        }
        this.declared = declared;
    }

    public available(ownerPluginId: string, sidecarId: string): boolean {
        const id = key(ownerPluginId, sidecarId);
        return this.declared.has(id) && !this.unavailable.has(id);
    }

    public start(ownerPluginId: string, sidecarId: string): Promise<void> {
        return this.bridge.start(ownerPluginId, sidecarId);
    }

    public stop(ownerPluginId: string, sidecarId: string): Promise<void> {
        return this.bridge.stop(ownerPluginId, sidecarId);
    }

    public request(ownerPluginId: string, sidecarId: string, method: string, params?: unknown): Promise<unknown> {
        return this.bridge.request(ownerPluginId, sidecarId, method, params);
    }

    public notify(ownerPluginId: string, sidecarId: string, method: string, params?: unknown): void {
        this.bridge.notify(ownerPluginId, sidecarId, method, params);
    }

    public onEvent(
        ownerPluginId: string,
        sidecarId: string,
        listener: (method: string, params: unknown) => void,
    ): () => void {
        return this.bridge.onEvent(ownerPluginId, sidecarId, listener);
    }

    public onExit(
        ownerPluginId: string,
        sidecarId: string,
        listener: (info: { code: number | null; signal: string | null }) => void,
    ): () => void {
        return this.bridge.onExit(ownerPluginId, sidecarId, listener);
    }
}
