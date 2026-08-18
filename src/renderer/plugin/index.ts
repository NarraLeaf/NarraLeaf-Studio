import type { BoundPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { PanelPosition } from "@/apps/workspace/registry/types";
import type {
  PanelDefinition,
  ActionDefinition,
  ActionGroup,
  EditorTabDefinition
} from "@/apps/workspace/registry/types";
import type { Keybinding } from "@/lib/workspace/services/ui/types";
import type {
  StoryPluginActionCreateInput,
  StoryPluginActionRegistration
} from "@/lib/workspace/services/services";
import type { PluginIdentity } from "@shared/types/pluginPermissions";
import type { NormalizedPluginManifestV2 } from "@shared/types/plugins";
import type {
  BlueprintInspectorParamSelectOption,
  BlueprintNodeDef
} from "@/lib/ui-editor/blueprint-nodes/types";
import type {
  RuntimeBlueprintNodeContext,
  RuntimeBlueprintNodeExecute
} from "@/lib/ui-editor/runtime/plugins/runtimePluginApi";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules";
import type {
  PluginTextEditorActionDef,
  PluginTextEditorLanguageDef,
  PluginTextEditorPreviewDef
} from "@/lib/workspace/services/ui/textEditorContributions";
import type { TestDefinition } from "@/lib/testing/types";
import {
  AssetExtensions,
  AssetType,
  type AssetData
} from "@/lib/workspace/services/assets/assetTypes";
import {
  AssetSource,
  type Asset,
  type AssetGroup,
  type AssetsMap
} from "@/lib/workspace/services/assets/types";
import { pluginUi } from "./ui";

export type {
  PluginIdentity,
  PluginInstallPermission,
  PluginPermissionRequest,
  PluginPermissionPromptResult
} from "@shared/types/pluginPermissions";
export type {
  PluginManifestV2,
  NormalizedPluginManifestV2,
  PluginManifestEntries,
  PluginInstallRecord,
  PluginListItem,
  WorkspacePluginDescriptor,
  RuntimePluginDescriptor
} from "@shared/types/plugins";
export { PanelPosition, AssetExtensions, AssetType, AssetSource };
export type { AssetData, Asset, AssetGroup, AssetsMap };
export type {
  AssetSelectorProps,
  AssetSelectorVirtualGroup
} from "@/apps/workspace/modules/assets/components/AssetSelector";
export type {
  BlueprintInspectorParamSelectOption,
  BlueprintNodeDef,
  BlueprintNodeExecuteFn,
  BlueprintNodePinDef
} from "@/lib/ui-editor/blueprint-nodes/types";

/**
 * A blueprint node as a *plugin* writes it: the editor's full palette metadata,
 * but with the narrowed execute of `narraleaf-studio/runtime`.
 *
 * The host's own `BlueprintNodeDef.execute` receives a `BehaviorNodeExecutionContext`,
 * which carries `hostAdapter` — and through it every host API: saves, localization,
 * quit. A plugin node reaching that would be exercising powers its manifest never
 * declared and the user never approved. So a plugin's execute gets the very same
 * capability-gated context its runtime entry gets, in both targets: one node module
 * can be shared by the studio and runtime entries, and neither is the privileged one.
 *
 * The editor is an environment that backs no game, so the gated domains on
 * `ctx.game` (`saves`, `store`, `state`, …) are absent while a node runs in Studio.
 * Nodes must degrade rather than assume them — the same discipline a plugin already
 * needs for the web export versus the desktop shell.
 */
export type PluginBlueprintNodeDef = Omit<BlueprintNodeDef, "execute"> & {
  execute: RuntimeBlueprintNodeExecute;
};

/**
 * The context a {@link PluginBlueprintNodeDef}'s execute receives — `params`,
 * `resolveInput`, the event slot, and the capability-gated `game`. Nothing else:
 * this is the whole of a node's reach.
 *
 * Structurally identical to the runtime entry's `RuntimeBlueprintNodeContext`,
 * re-named rather than re-exported so the two type packages do not collide.
 */
export type PluginBlueprintNodeContext = RuntimeBlueprintNodeContext;

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
  SwitchVariant
} from "@/lib/components/elements";
export type {
  PluginPanelEmptyStateProps,
  PluginPanelHeaderProps,
  PluginPanelRootProps,
  PluginPanelRowProps,
  PluginPanelSectionProps,
  PluginPanelToolbarProps,
  PluginUiKit
} from "./ui";
export type { FreezeGuard, FrozenControlProps } from "@/apps/workspace/components/ui/freezeGuard";
export type { StoryPluginActionCreateInput, StoryPluginActionRegistration };
export type { StoryBlock, StoryBlockId, StoryBlockKind } from "@shared/types/story";
/**
 * Every one of these has to be listed explicitly. The types package is generated with
 * `exportReferencedTypes: false`, so a type that is only reachable *through* another export is
 * emitted without being exported - and silently disappears from `narraleaf-studio/plugin`.
 */
export type {
  PluginTextEditorActionContext,
  PluginTextEditorActionDef,
  PluginTextEditorEncodingId,
  PluginTextEditorLanguageConfiguration,
  PluginTextEditorLanguageDef,
  PluginTextEditorMonarchGrammar,
  PluginTextEditorPreviewDef,
  PluginTextEditorPreviewProps
} from "@/lib/workspace/services/ui/textEditorContributions";
/**
 * The test protocol, whole. Same rule as the block above and the reason it is
 * spelled out one name at a time: `TestDefinition` alone would publish a type
 * whose `run` parameter a plugin author cannot name.
 *
 * `TEST_PROTOCOL_VERSION` is the compile-time constant a definition compares
 * against. At *runtime* read `app.services.tests.protocolVersion` instead - the
 * host module Studio serves for this specifier re-exports only `definePlugin`
 * and the enums, so a value import of anything else fails to link.
 *
 * See `docs/plugin-test-protocol.md`.
 */
export { TEST_PROTOCOL_VERSION } from "@/lib/testing/types";
export type {
  TestAvailability,
  TestAvailabilityContext,
  TestCapability,
  TestCategory,
  TestDefinition,
  TestFinding,
  TestFindingSeverity,
  TestGameEvent,
  TestGameExit,
  TestGameExitReason,
  TestGameHandle,
  TestGameLaunchOptions,
  TestGameSession,
  TestId,
  TestLogLevel,
  TestPresentation,
  TestProgress,
  TestProjectHandle,
  TestRunContext,
  TestSceneRef,
  TestStoryRef,
  TestText,
  TestVerdict
} from "@/lib/testing/types";
/**
 * Where a {@link TestFinding} points. Not a testing type - it is the global-search navigation
 * layer, exported here because `TestFinding.target` is the only way a plugin reaches it and an
 * unnameable field is one an author has to build blind.
 */
export type { SearchJumpTarget } from "@/lib/workspace/services/search/searchIndexModel";

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

/** One story in the project, as a plugin panel sees it. */
export type PluginStoryEntry = {
  id: string;
  name: string;
};

/** One scene of a story, in the author's own document order. */
export type PluginSceneEntry = {
  id: string;
  name: string;
  storyId: string;
};

/**
 * One voice line the project has recorded, for a plugin that curates spoken
 * content (a voice EXTRA list). Keyed by `unitId`, which is the story line's
 * `textId` - the same key the translation table and the engine's voiceId use, so
 * a plugin storing the unit id needs no asset id of its own.
 */
export type PluginVoiceUnitEntry = {
  unitId: string;
  /** Voice language this take belongs to. */
  locale: string;
  /** The line as it currently reads, for the author to recognise it. */
  text: string;
  /** Speaker name when the line has one. */
  character: string | null;
  durationSec: number | null;
};

/**
 * Studio's built-in text editor, as a plugin extends it.
 *
 * Studio ships the editor (monaco over a text asset, encodings, autosave) and stops there: no
 * Markdown preview, no lint, no formatter. Those are plugin work, and this is the whole seam for
 * them - a grammar to colour the document, a pane to render it beside the editor, a command to
 * transform it.
 *
 * Two things worth knowing before you register:
 *
 *  - **Nothing is drawn for an empty registry.** The preview toggle and the action buttons appear
 *    in the editor's status bar only while a contribution matches the open document's extension.
 *    A Studio with no such plugin shows no dead controls, so a preview that never appears means
 *    your `extensions` did not match - not that the API is unimplemented.
 *  - **Languages install lazily.** `registerLanguage` records the definition; monaco receives it
 *    the first time a matching document is opened. Registering at `setup` time therefore costs
 *    nothing at startup.
 */
export type PluginTextEditorService = {
  registerLanguage(def: PluginTextEditorLanguageDef): PluginCleanup;
  registerPreview(def: PluginTextEditorPreviewDef): PluginCleanup;
  registerAction(def: PluginTextEditorActionDef): PluginCleanup;
};

/**
 * Contribute checks an author can run against their own game from Run > Test.
 *
 * "Test" here has nothing to do with the repo's or your plugin's unit tests: it is a check the
 * *author* starts, that observes *their project*, and that reports a verdict and findings into
 * Studio's Test Report tab. `docs/plugin-test-protocol.md` is the normative contract; four things
 * bite before you have read it:
 *
 *  - **Declare every id in `contributes.tests`.** Registering an id the manifest does not list
 *    throws at load, exactly as an undeclared blueprint node or widget does. Ids must be prefixed
 *    with your plugin id, because the registry is one flat id space shared with Studio's own tests.
 *  - **Declaring a test asks the author for nothing at install time.** It derives no permission,
 *    deliberately - nothing runs until they pick it and press Start.
 *  - **Your `run` may return `passed`, `failed` or `skipped` and nothing else.** `cancelled` and
 *    `errored` are the host's verdicts about you. Cancellation reaches you as `ctx.signal`.
 *  - **What you did not declare in `requires` is absent, not throwing.** `ctx.game` is `undefined`
 *    unless you asked for `game.launch`, so a test must read the handle rather than assume it.
 */
export type PluginTestService = {
  /**
   * The host's {@link TEST_PROTOCOL_VERSION}. Read it at `setup` if your definition needs a
   * contract newer than some Studio you support: refuse there, where you can still decline to
   * register, rather than half-way through a run.
   */
  readonly protocolVersion: number;
  register(definition: TestDefinition): PluginCleanup;
  registerMany(definitions: TestDefinition[]): PluginCleanup;
};

/**
 * Anything a plugin writes through {@link PluginStorageService} is **project content**: it lands in
 * `editor/services/`, inside the versioned working tree, alongside the story and the assets. Two
 * consequences follow, and this service is how a plugin answers both of them.
 */
export type PluginStorageService = {
  readJson<T extends Record<string, any>>(namespace: string): Promise<T | null>;
  /**
   * Writes are **silently discarded while the project is frozen** ({@link PluginWorkspaceService}).
   * That is deliberate at the boundary - it is what keeps a version the author is only *looking* at
   * from being written over - but it means a plugin that mutates its own memory first and writes
   * second ends up with memory the disk does not have. Check `workspace.frozen` before you mutate,
   * not after.
   */
  writeJson<T extends Record<string, any>>(namespace: string, data: T): Promise<void>;
};

/**
 * Why project data is currently read-only: an older version is on screen, or the author froze it.
 *
 * `recovery` is listed for completeness and is one no plugin observes in practice - a recovery shell
 * loads no plugins at all - but it is a state the workspace can be in, and leaving it out of the
 * union would make an exhaustive switch here wrong rather than complete.
 */
export type PluginFreezeReason = "revision" | "manual" | "merge" | "recovery";

/**
 * The state of the project a plugin's data lives in.
 *
 * Studio's version control moves the whole working tree under the editors' feet - restoring a past
 * version, or displaying one read-only while the author browses history - and a plugin store is part
 * of that tree. So there are exactly two things a plugin has to do to be version-controlled, and both
 * are here:
 *
 *  - **Do not offer a write that cannot happen.** While `frozen`, project writes are refused at the
 *    boundary; a plugin that keeps its buttons live lets the author edit and then throws the edit
 *    away. Grey them out (`ui.useFreezeGuard()` renders exactly what Studio's own panels render) and
 *    make every mutation bail before it touches memory.
 *  - **Re-read when Studio does.** {@link registerReloader} enrols your store in the pass Studio runs
 *    after a restore, a thaw, or entering a version view. Skipping it is not a cosmetic staleness
 *    bug: your pre-restore memory is still in RAM, and the author's next edit writes it back over the
 *    version they just restored.
 */
export type PluginWorkspaceService = {
  /** Whether project data may be written right now. Read at call time; never cached. */
  readonly frozen: boolean;
  /** Why, or `null` when the project is writable. */
  readonly freezeReason: PluginFreezeReason | null;
  /** Fires on every change, with the new state. */
  onFreezeChange(
    listener: (frozen: boolean, reason: PluginFreezeReason | null) => void
  ): PluginCleanup;
  /**
   * Re-read everything this plugin holds in memory, because the project's documents have been
   * replaced.
   *
   * Called with project writes held off and the new version already installed at the read
   * boundary, so a plain `storage.readJson` inside it returns the right bytes. Read before you drop
   * what you have: throwing must leave the plugin with its old data rather than with half of a
   * document. Register once per store, at `setup`.
   */
  registerReloader(reload: () => Promise<void> | void): PluginCleanup;
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
  /** The state of the project your data lives in; see {@link PluginWorkspaceService}. */
  workspace: PluginWorkspaceService;
  /** Extend Studio's built-in text editor; see {@link PluginTextEditorService}. */
  textEditor: PluginTextEditorService;
  /** Contribute checks to Run > Test; see {@link PluginTestService}. */
  tests: PluginTestService;
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
      /**
       * The editor group clips its content host, so a tab component must size itself to the
       * host (`h-full`) and bring its own scroller for anything taller — overflowing content
       * is not scrolled for it.
       */
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
    /**
     * Read-only project catalogue, for a plugin panel that has to let the
     * author point at a story location - a recollection entry naming the
     * scene it replays, an achievement naming where it unlocks.
     *
     * Read-only on purpose: creating and editing stories stays with Studio.
     * `listScenes` needs the story document, so it awaits a load; the
     * story list itself is already in memory.
     */
    listStories(): PluginStoryEntry[];
    listScenes(storyId: string): Promise<PluginSceneEntry[]>;
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
  /**
   * Read-only view of the project's recorded voice, for a plugin that curates
   * spoken content. Absent tables (a project with no voice set up) read as an
   * empty list rather than throwing.
   */
  voice: {
    listUnits(localeCode?: string): Promise<PluginVoiceUnitEntry[]>;
  };
  blueprintNodes: {
    /** Session-persistent: returns `void` (node defs cannot be removed once registered). */
    register(def: PluginBlueprintNodeDef): void;
    /** Session-persistent: returns `void` (node defs cannot be removed once registered). */
    registerMany(defs: PluginBlueprintNodeDef[]): void;
    registerDynamicSelectOptionsSource(
      sourceId: string,
      provider: () => BlueprintInspectorParamSelectOption[]
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
    [PLUGIN_DEFINITION_MARKER]: true
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
