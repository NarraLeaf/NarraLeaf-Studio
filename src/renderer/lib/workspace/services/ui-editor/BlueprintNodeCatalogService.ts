/**
 * Workspace-owned blueprint node catalog: built-in load + extension registration (e.g. plugins).
 * Delegates storage to blueprintNodeRegistry. Comments in English per project convention.
 */

import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { defineBlueprintNode, defineBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/defineBlueprintNode";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import type {
    BlueprintNodeDef,
    BlueprintNodeEditorCatalogEntry,
    BlueprintPaletteContext,
} from "@/lib/ui-editor/blueprint-nodes/types";
import { Service } from "../Service";
import { IBlueprintNodeCatalogService, WorkspaceContext } from "../services";

export class BlueprintNodeCatalogService
    extends Service<BlueprintNodeCatalogService>
    implements IBlueprintNodeCatalogService
{
    protected init(_ctx: WorkspaceContext): void {
        this.ensureBuiltinsRegistered();
    }

    public ensureBuiltinsRegistered(): void {
        registerCoreBlueprintNodes();
    }

    public register(def: BlueprintNodeDef): void {
        this.ensureBuiltinsRegistered();
        defineBlueprintNode(def);
    }

    public registerMany(defs: BlueprintNodeDef[]): void {
        this.ensureBuiltinsRegistered();
        defineBlueprintNodes(defs);
    }

    public get(type: string): BlueprintNodeDef | undefined {
        this.ensureBuiltinsRegistered();
        return blueprintNodeRegistry.get(type);
    }

    public getBlueprintNodeEditorCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry | undefined {
        const def = this.get(type);
        return def ? blueprintNodeRegistry.toCatalogEntry(def) : undefined;
    }

    public listPaletteEntries(ctx: BlueprintPaletteContext): BlueprintNodeEditorCatalogEntry[] {
        this.ensureBuiltinsRegistered();
        return blueprintNodeRegistry.listPaletteEntries(ctx);
    }

    public resolveCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry {
        this.ensureBuiltinsRegistered();
        return blueprintNodeRegistry.resolveCatalogEntry(type);
    }

    public resolveCatalogEntryForNode(type: string, params?: Record<string, unknown>): BlueprintNodeEditorCatalogEntry {
        this.ensureBuiltinsRegistered();
        return blueprintNodeRegistry.resolveCatalogEntryForNode(type, params);
    }
}
