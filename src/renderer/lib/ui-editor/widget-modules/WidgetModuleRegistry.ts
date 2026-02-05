import type { UIWidgetModule } from "./types";

/**
 * Central registry for widget modules.
 * Replaces the separate ElementTypeRegistry, ElementRendererRegistry,
 * and inspector registry with a single unified registry.
 */
export class WidgetModuleRegistry {
    private readonly modules = new Map<string, UIWidgetModule>();

    public register(module: UIWidgetModule): void {
        if (this.modules.has(module.type)) {
            console.warn(`[WidgetModuleRegistry] Overwriting module: ${module.type}`);
        }
        this.modules.set(module.type, module);
    }

    public registerMany(modules: UIWidgetModule[]): void {
        for (const mod of modules) {
            this.register(mod);
        }
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
