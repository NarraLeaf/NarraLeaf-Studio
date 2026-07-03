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
    BlueprintInspectorParamSelectOption,
    BlueprintPaletteContext,
} from "@/lib/ui-editor/blueprint-nodes/types";
import { Service } from "../Service";
import { IBlueprintNodeCatalogService, WorkspaceContext } from "../services";

type DynamicSelectOptionsProvider = () => BlueprintInspectorParamSelectOption[];
type PluginRegistrationOptions = {
    ownerPluginId?: string;
    replaceExisting?: boolean;
};
type DynamicSelectOptionsSourceRecord = {
    provider: DynamicSelectOptionsProvider;
    ownerPluginId?: string;
};

export class BlueprintNodeCatalogService
    extends Service<BlueprintNodeCatalogService>
    implements IBlueprintNodeCatalogService
{
    private readonly dynamicSelectOptionsSources = new Map<string, DynamicSelectOptionsSourceRecord>();
    private readonly dynamicSelectOptionsListeners = new Set<() => void>();
    private readonly pluginNodeOwners = new Map<string, string>();

    protected init(_ctx: WorkspaceContext): void {
        this.ensureBuiltinsRegistered();
    }

    public ensureBuiltinsRegistered(): void {
        registerCoreBlueprintNodes();
    }

    public register(def: BlueprintNodeDef, options?: PluginRegistrationOptions): void {
        this.ensureBuiltinsRegistered();
        this.validatePluginOwnedNode(def, options);
        const existingOwner = this.pluginNodeOwners.get(def.type);
        const replaceExisting = Boolean(
            options?.replaceExisting &&
            options.ownerPluginId &&
            existingOwner === options.ownerPluginId
        );
        if (options?.ownerPluginId && blueprintNodeRegistry.get(def.type) && existingOwner !== options.ownerPluginId) {
            throw new Error(`Blueprint node type already registered by another owner: ${def.type}`);
        }
        if (replaceExisting) {
            blueprintNodeRegistry.register(def, { replaceExisting: true });
        } else {
            defineBlueprintNode(def);
        }
        if (options?.ownerPluginId) {
            this.pluginNodeOwners.set(def.type, options.ownerPluginId);
        }
    }

    public registerMany(defs: BlueprintNodeDef[], options?: PluginRegistrationOptions): void {
        this.ensureBuiltinsRegistered();
        if (!options?.ownerPluginId) {
            defineBlueprintNodes(defs);
            return;
        }
        for (const def of defs) {
            this.register(def, options);
        }
    }

    public registerDynamicSelectOptionsSource(
        sourceId: string,
        provider: DynamicSelectOptionsProvider,
        options?: PluginRegistrationOptions,
    ): () => void {
        const normalized = sourceId.trim();
        if (!normalized) {
            throw new Error("Dynamic select options source id is required");
        }
        if (options?.ownerPluginId && !normalized.startsWith(`${options.ownerPluginId}.`)) {
            throw new Error(`Dynamic select options source id must be prefixed with plugin id: ${options.ownerPluginId}`);
        }

        const existing = this.dynamicSelectOptionsSources.get(normalized);
        const canReplace = Boolean(
            existing &&
            options?.replaceExisting &&
            options.ownerPluginId &&
            existing.ownerPluginId === options.ownerPluginId
        );
        if (existing && !canReplace) {
            throw new Error(`Dynamic select options source already registered: ${normalized}`);
        }
        this.dynamicSelectOptionsSources.set(normalized, {
            provider,
            ownerPluginId: options?.ownerPluginId,
        });
        this.notifyDynamicSelectOptionsChanged();
        return () => {
            if (this.dynamicSelectOptionsSources.get(normalized)?.provider === provider) {
                this.dynamicSelectOptionsSources.delete(normalized);
                this.notifyDynamicSelectOptionsChanged();
            }
        };
    }

    public getDynamicSelectOptions(): Record<string, BlueprintInspectorParamSelectOption[]> {
        const options: Record<string, BlueprintInspectorParamSelectOption[]> = {};
        for (const [sourceId, record] of this.dynamicSelectOptionsSources.entries()) {
            try {
                options[sourceId] = record.provider();
            } catch (error) {
                console.error(`[BlueprintNodeCatalogService] Dynamic options source failed: ${sourceId}`, error);
                options[sourceId] = [];
            }
        }
        return options;
    }

    public notifyDynamicSelectOptionsChanged(): void {
        for (const listener of this.dynamicSelectOptionsListeners) {
            listener();
        }
    }

    public onDynamicSelectOptionsChanged(handler: () => void): () => void {
        this.dynamicSelectOptionsListeners.add(handler);
        return () => {
            this.dynamicSelectOptionsListeners.delete(handler);
        };
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

    private validatePluginOwnedNode(def: BlueprintNodeDef, options?: PluginRegistrationOptions): void {
        const ownerPluginId = options?.ownerPluginId;
        if (!ownerPluginId) {
            return;
        }
        if (!def.type.startsWith(`${ownerPluginId}.`)) {
            throw new Error(`Blueprint node type must be prefixed with plugin id: ${ownerPluginId}`);
        }
    }
}
