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
}

export class WidgetModuleRegistry {
    private readonly modules = new Map<string, UIWidgetModule>();
    /** type -> owning plugin id, for widgets contributed by a plugin. */
    private readonly owners = new Map<string, string>();

    public register(module: UIWidgetModule, options?: WidgetModuleRegisterOptions): void {
        if (this.modules.has(module.type)) {
            console.warn(`[WidgetModuleRegistry] Overwriting module: ${module.type}`);
        }
        this.modules.set(module.type, module);
        // The last writer defines ownership: a plugin registration claims the
        // type; a core (owner-less) registration clears any prior claim.
        if (options?.ownerPluginId) {
            this.owners.set(module.type, options.ownerPluginId);
        } else {
            this.owners.delete(module.type);
        }
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
        this.modules.delete(type);
        this.owners.delete(type);
    }

    /** The plugin id that owns a widget type, or undefined for core widgets. */
    public getOwner(type: string): string | undefined {
        return this.owners.get(type);
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
}
