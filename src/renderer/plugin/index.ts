import type { BoundPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { PanelPosition } from "@/apps/workspace/registry/types";
import type { PanelDefinition, ActionDefinition, ActionGroup, EditorTabDefinition } from "@/apps/workspace/registry/types";
import type { Keybinding } from "@/lib/workspace/services/ui/types";
import type {
    StoryPluginActionCreateInput,
    StoryPluginActionRegistration,
} from "@/lib/workspace/services/services";
import type { PluginIdentity } from "@shared/types/pluginPermissions";
import type { NormalizedPluginManifestV2 } from "@shared/types/plugins";
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
    PluginManifestV2,
    NormalizedPluginManifestV2,
    PluginManifestEntries,
    PluginInstallRecord,
    PluginListItem,
    WorkspacePluginDescriptor,
    RuntimePluginDescriptor,
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
export type {
    StoryPluginActionCreateInput,
    StoryPluginActionRegistration,
};
export type {
    StoryBlock,
    StoryBlockId,
    StoryBlockKind,
} from "@shared/types/story";

export const ui = pluginUi;

export type PluginCleanup = () => void | Promise<void>;

export type PluginSetupResult = void | PluginCleanup;

export type PluginSetup = (app: PluginApp) => PluginSetupResult | Promise<PluginSetupResult>;

export type PluginDefinition = {
    setup: PluginSetup;
};

export type PluginApp = {
    plugin: PluginIdentity;
    manifest: NormalizedPluginManifestV2;
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

/** An active editor locale code (built-in like "en"/"zh", or a plugin-provided locale). */
export type LocaleCode = string;

/**
 * A plugin's own message tables: `locale code -> (message key -> string)`. This
 * is the plugin's private catalog, unrelated to Studio's own translations.
 * `fallbackLocale` resolves keys the active locale's table lacks (defaults to the
 * first table declared).
 */
export type PluginMessageBundle = {
    messages: Record<string, Record<string, string>>;
    fallbackLocale?: string;
};

/**
 * A translator over a {@link PluginMessageBundle} that follows the editor's
 * active locale. `t()` resolves against the active locale's table, then the
 * fallback table, then returns the key. `{placeholder}` tokens are filled from
 * `params`. Live: `.locale` and `t()` read the current editor locale at call
 * time, so one translator instance is enough - subscribe via
 * {@link PluginI18n.onLocaleChange} to re-render on a language switch.
 */
export type PluginTranslator = {
    readonly locale: LocaleCode;
    t(key: string, params?: Record<string, string | number>): string;
};

/**
 * Read access to the editor's language, so a plugin can localize its OWN strings
 * against the current editor locale and react to live language switches. This is
 * the editor UI language; it is unrelated to a game's player-facing localization.
 */
export type PluginI18n = {
    /** The editor's active locale code. */
    readonly locale: LocaleCode;
    /**
     * Subscribe to editor-language changes. The listener fires with the new
     * locale code whenever the active editor language changes. Returns a
     * {@link PluginCleanup} (also tracked by the host, so it is reclaimed on
     * unload even if you forget to call it).
     */
    onLocaleChange(listener: (locale: LocaleCode) => void): PluginCleanup;
    /** Locale-aware number formatting bound to the editor's active locale. */
    formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
    /** Locale-aware date formatting bound to the editor's active locale. */
    formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
    /** Locale-aware list formatting bound to the editor's active locale. */
    formatList(items: string[], options?: Intl.ListFormatOptions): string;
    /** Build a translator over the plugin's own message bundle (see {@link PluginTranslator}). */
    createTranslator(bundle: PluginMessageBundle): PluginTranslator;
};

/**
 * The curated plugin API surface. This is intentionally a whitelist:
 * plugins do NOT get access to the workspace service registry. Anything
 * beyond this surface (arbitrary file system access, bash, permission
 * grants) must go through the privileged facade, which is enforced
 * per-plugin by the main process.
 */
/**
 * The curated studio plugin API surface.
 *
 * Convention: every `register*` on a registration sub-service returns a
 * {@link PluginCleanup} that removes exactly that contribution; `registerMany`
 * returns one cleanup removing all of them. The host also tracks each
 * registration, so unload reclaims everything even if you never call the
 * returned cleanup. Registration ids/types must be prefixed with your plugin id.
 * Imperative operations (`editors.*`, `notifications.*`, `i18n.format*`,
 * `blueprintNodes.notify*`) return their natural value, not a cleanup.
 *
 * The one exception: `blueprintNodes.register`/`registerMany` return `void`.
 * Node definitions are session-persistent - removing a live def would orphan
 * nodes in open documents, and the catalog has no removal path - so there is
 * nothing to dispose.
 */
export type PluginServices = {
    storage: PluginStorageService;
    assets: PluginAssetsService;
    i18n: PluginI18n;
    ui: {
        panels: {
            register<TPayload = unknown>(panel: PanelDefinition<TPayload>): PluginCleanup;
            registerMany(panels: PanelDefinition[]): PluginCleanup;
        };
        actions: {
            register(action: ActionDefinition): PluginCleanup;
            registerMany(actions: ActionDefinition[]): PluginCleanup;
            registerGroup(group: ActionGroup): PluginCleanup;
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
        register(module: UIWidgetModule): PluginCleanup;
        registerMany(modules: UIWidgetModule[]): PluginCleanup;
        get(type: string): UIWidgetModule | undefined;
        list(): UIWidgetModule[];
        has(type: string): boolean;
    };
    story: {
        actions: {
            /**
             * Register a scene-editor palette action (shown under the Plugin
             * category) that creates story blocks. The blocks it returns are
             * standard story blocks - the document does not depend on the
             * plugin after creation. Action ids must be prefixed with the
             * plugin id.
             */
            register(registration: StoryPluginActionRegistration): PluginCleanup;
            registerMany(registrations: StoryPluginActionRegistration[]): PluginCleanup;
        };
    };
    blueprintNodes: {
        /** Session-persistent: returns `void` (node defs cannot be removed once registered). */
        register(def: BlueprintNodeDef): void;
        /** Session-persistent: returns `void` (node defs cannot be removed once registered). */
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
