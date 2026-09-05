import type { UIWidgetModule } from "./types";

/**
 * Central registry for widget modules.
 * Replaces the separate ElementTypeRegistry, ElementRendererRegistry,
 * and inspector registry with a single unified registry.
 */
export interface WidgetModuleRegisterOptions {
    /**
     * Plugin id that owns this widget type, recorded so the dependency scanner
     * can attribute a used widget type back to its plugin. Omit for built-in
     * (core) widgets, which have no owner.
     */
    ownerPluginId?: string;
    /**
     * The owning plugin's own name, as its manifest states it. Recorded beside the id because
     * the insert palette has to say where a widget came from, and an id is not what the author
     * knows the plugin as - the plugins panel and the dependency table both name it this way.
     */
    ownerPluginName?: string;
}

export class WidgetModuleRegistry {
    private readonly modules = new Map<string, UIWidgetModule>();
    /** type -> owning plugin id, for widgets contributed by a plugin. */
    private readonly owners = new Map<string, string>();
    /** type -> owning plugin's display name; only set when the registration carried one. */
    private readonly ownerNames = new Map<string, string>();
    private readonly listeners = new Set<() => void>();
    private revision = 0;

    public register(module: UIWidgetModule, options?: WidgetModuleRegisterOptions): void {
        if (this.modules.has(module.type)) {
            console.warn(`[WidgetModuleRegistry] Overwriting module: ${module.type}`);
        }
        this.modules.set(module.type, module);
        // The last writer defines ownership: a plugin registration claims the
        // type; a core (owner-less) registration clears any prior claim.
        if (options?.ownerPluginId) {
            this.owners.set(module.type, options.ownerPluginId);
            if (options.ownerPluginName) {
                this.ownerNames.set(module.type, options.ownerPluginName);
            } else {
                this.ownerNames.delete(module.type);
            }
        } else {
            this.owners.delete(module.type);
            this.ownerNames.delete(module.type);
        }
        this.publish();
    }

    public registerMany(modules: UIWidgetModule[] | undefined, options?: WidgetModuleRegisterOptions): void {
        if (modules == null) {
            console.error("[WidgetModuleRegistry] registerMany called with undefined (import cycle?)");
            return;
        }
        for (const mod of modules) {
            this.register(mod, options);
        }
    }

    public unregister(type: string): void {
        const had = this.modules.delete(type);
        this.owners.delete(type);
        this.ownerNames.delete(type);
        if (had) {
            this.publish();
        }
    }

    /** The plugin id that owns a widget type, or undefined for core widgets. */
    public getOwner(type: string): string | undefined {
        return this.owners.get(type);
    }

    /** The owning plugin's name, falling back to its id when the registration carried none. */
    public getOwnerName(type: string): string | undefined {
        const pluginId = this.owners.get(type);
        if (!pluginId) {
            return undefined;
        }
        return this.ownerNames.get(type) ?? pluginId;
    }

    /** Plugin ids that currently contribute at least one registered widget type. */
    public getOwnerPluginIds(): string[] {
        return Array.from(new Set(this.owners.values()));
    }

    public get(type: string): UIWidgetModule | undefined {
        return this.modules.get(type);
    }

    public list(): UIWidgetModule[] {
        return Array.from(this.modules.values());
    }

    public has(type: string): boolean {
        return this.modules.has(type);
    }

    /**
     * A number that changes whenever the set of registered types changes.
     *
     * What the canvas subscribes through: a plugin may be switched on or off while a page is open,
     * and the surface renderers are resolved from this registry, so a drawing made before the
     * change is stale rather than merely out of date. Suitable as a `useSyncExternalStore`
     * snapshot - it is a primitive, and it does not move unless a registration did.
     */
    public getRevision(): number {
        return this.revision;
    }

    /** Notified after every registration change. Returns the unsubscribe. */
    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private publish(): void {
        this.revision += 1;
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (error) {
                console.error("[WidgetModuleRegistry] listener failed:", error);
            }
        }
    }
}
