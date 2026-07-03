import type { BoundPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { PanelPosition } from "@/apps/workspace/registry/types";
import type { PanelDefinition, ActionDefinition, ActionGroup, EditorTabDefinition } from "@/apps/workspace/registry/types";
import type { Keybinding } from "@/lib/workspace/services/ui/types";
import type { PluginIdentity } from "@shared/types/pluginPermissions";
import type { NormalizedPluginManifestV1 } from "@shared/types/plugins";
import type {
    BlueprintInspectorParamSelectOption,
    BlueprintNodeDef,
} from "@/lib/ui-editor/blueprint-nodes/types";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules";
import {
    AssetExtensions,
    AssetType,
    type AssetData,
} from "@/lib/workspace/services/assets/assetTypes";
import {
    AssetSource,
    type Asset,
    type AssetGroup,
    type AssetsMap,
} from "@/lib/workspace/services/assets/types";
import { pluginUi } from "./ui";

export type {
    PluginIdentity,
    PluginInstallPermission,
    PluginPermissionRequest,
    PluginPermissionPromptResult,
} from "@shared/types/pluginPermissions";
export type {
    PluginManifestV1,
    NormalizedPluginManifestV1,
    PluginInstallRecord,
    PluginListItem,
    WorkspacePluginDescriptor,
} from "@shared/types/plugins";
export { PanelPosition, AssetExtensions, AssetType, AssetSource };
export type { AssetData, Asset, AssetGroup, AssetsMap };
export type {
    AssetSelectorProps,
    AssetSelectorVirtualGroup,
} from "@/apps/workspace/modules/assets/components/AssetSelector";
export type {
    BlueprintInspectorParamSelectOption,
    BlueprintNodeDef,
    BlueprintNodeExecuteFn,
    BlueprintNodePinDef,
} from "@/lib/ui-editor/blueprint-nodes/types";
export type {
    AccordionItemProps,
    AccordionProps,
    BaseInputProps,
    ButtonProps,
    ButtonSize,
    ButtonVariant,
    CardProps,
    CardSize,
    CardVariant,
    ContextMenuDef,
    ContextMenuItemDef,
    ContextMenuProps,
    ContextMenuSeparatorDef,
    InputSize,
    InputVariant,
    ModalProps,
    ProgressProps,
    ProgressSize,
    ProgressVariant,
    SelectOption,
    SelectProps,
    SwitchProps,
    SwitchSize,
    SwitchVariant,
} from "@/lib/components/elements";
export type {
    PluginPanelEmptyStateProps,
    PluginPanelHeaderProps,
    PluginPanelRootProps,
    PluginPanelRowProps,
    PluginPanelSectionProps,
    PluginPanelToolbarProps,
    PluginUiKit,
} from "./ui";

export const ui = pluginUi;

export type PluginCleanup = () => void | Promise<void>;

export type PluginSetupResult = void | PluginCleanup;

export type PluginSetup = (app: PluginApp) => PluginSetupResult | Promise<PluginSetupResult>;

export type PluginDefinition = {
    setup: PluginSetup;
};

export type PluginApp = {
    plugin: PluginIdentity;
    manifest: NormalizedPluginManifestV1;
    services: PluginServices;
    privileged: BoundPrivilegedFacade;
};

export type PluginStorageService = {
    readJson<T extends Record<string, any>>(namespace: string): Promise<T | null>;
    writeJson<T extends Record<string, any>>(namespace: string, data: T): Promise<void>;
};

export type PluginAssetsService = {
    getMap(): AssetsMap;
    list<T extends AssetType>(type: T): Asset<T, AssetSource>[];
    get<T extends AssetType>(type: T, assetId: string): Asset<T, AssetSource> | undefined;
    fetch<T extends AssetType>(asset: Asset<T, AssetSource>): Promise<AssetData<T>>;
    createObjectUrl(asset: Asset): Promise<string>;
    revokeObjectUrl(url: string): void;
};

/**
 * The curated plugin API surface. This is intentionally a whitelist:
 * plugins do NOT get access to the workspace service registry. Anything
 * beyond this surface (arbitrary file system access, bash, permission
 * grants) must go through the privileged facade, which is enforced
 * per-plugin by the main process.
 */
export type PluginServices = {
    storage: PluginStorageService;
    assets: PluginAssetsService;
    ui: {
        panels: {
            register<TPayload = unknown>(panel: PanelDefinition<TPayload>): void;
            unregister(id: string): void;
        };
        actions: {
            register(action: ActionDefinition): void;
            unregister(id: string): void;
            registerGroup(group: ActionGroup): void;
            unregisterGroup(id: string): void;
        };
        editors: {
            open<TPayload = unknown>(tab: EditorTabDefinition<TPayload>, groupId?: string): void;
            close(tabId: string, groupId?: string): void;
        };
        keybindings: {
            register(keybinding: Keybinding): PluginCleanup;
            registerMany(keybindings: Keybinding[]): PluginCleanup;
        };
        notifications: {
            info(message: string): void;
            success(message: string): void;
            warning(message: string): void;
            error(message: string): void;
        };
    };
    widgets: {
        register(module: UIWidgetModule): void;
        registerMany(modules: UIWidgetModule[]): void;
        get(type: string): UIWidgetModule | undefined;
        list(): UIWidgetModule[];
        has(type: string): boolean;
    };
    blueprintNodes: {
        register(def: BlueprintNodeDef): void;
        registerMany(defs: BlueprintNodeDef[]): void;
        registerDynamicSelectOptionsSource(
            sourceId: string,
            provider: () => BlueprintInspectorParamSelectOption[],
        ): PluginCleanup;
        notifyDynamicSelectOptionsChanged(): void;
    };
};

const PLUGIN_DEFINITION_MARKER = "__nlsPluginDefinition";

export function definePlugin(definition: PluginDefinition): PluginDefinition {
    if (!definition || typeof definition.setup !== "function") {
        throw new Error("Plugin definition requires a setup(app) function");
    }
    return Object.freeze({
        ...definition,
        [PLUGIN_DEFINITION_MARKER]: true,
    });
}

export function isPluginDefinition(value: unknown): value is PluginDefinition {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as Record<string, unknown>)[PLUGIN_DEFINITION_MARKER] === true &&
        typeof (value as PluginDefinition).setup === "function"
    );
}
