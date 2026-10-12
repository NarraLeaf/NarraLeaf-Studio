/**
 * The agent core: the three text formats' parse -> check -> compile -> apply/print logic, runnable
 * inside the Studio renderer.
 *
 * The `ui`, `story` and `blueprint` command lines (`project/app/*.js`) and Studio's agent bridge run
 * the same code. The command lines read a project off disk and pass the parsed documents in; the
 * bridge passes the live documents its services hold. Nothing reachable from this entry touches the
 * filesystem, a Node built-in or esbuild - `bundle.test.ts` bundles it for the browser and fails on
 * the first one.
 *
 * Every command body returns a {@link CommandResult}: the lines the command line prints on stdout
 * (`out`) and stderr (`err`) and its exit code, so the format guides that quote that output are true
 * of the bridge too. The facades (`showUi`, `checkUiSource`, `applyStorySource`, ...) are the same
 * bodies with a context in place of the command line's arguments; what each context must hold is
 * documented on it (`UiAgentContext`, `StoryAgentContext`, `BlueprintProjectDocuments`).
 *
 * Comments in English per project convention.
 */

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export {
    commandText,
    commandWriter,
    emitCommandResult,
    emitPartialOutput,
    type CommandIo,
    type CommandResult,
    type CommandWrite,
    type CommandWriter,
} from "./commandResult";

// ---------------------------------------------------------------------------
// Interface (.ui)
// ---------------------------------------------------------------------------

export {
    applyCompiledUi,
    applyUiSource,
    checkUiProjectText,
    checkUiSource,
    checkUiSourceText,
    compileUiSource,
    printUiComponent,
    printUiProject,
    printUiSurface,
    showUi,
    uiProjectInputOf,
    widgetModuleSourceFromRegistry,
    type UiAgentContext,
} from "./ui";
export {
    DEFAULT_USAGE_LIMIT,
    uiApplyCommand,
    uiCheckProjectCommand,
    uiCheckSourceCommand,
    uiShowCommand,
    uiStructsCommand,
    uiSurfacesCommand,
    uiUsageCommand,
    uiWidgetCommand,
    uiWidgetsCommand,
    type UiApplyOptions,
    type UiApplyResult,
    type UiCheckSourceResult,
    type UiProjectInput,
    type UiShowOptions,
    type UiShowResult,
    type UiUsageOptions,
    type UiWidgetsQuery,
} from "../ui-cli/core";
export { formatApplyResult as formatUiApplyResult, type ApplyResult as UiApplyChanges } from "../ui-cli/apply";
export { formatDiagnostics as formatUiDiagnostics, type UiCheckResult } from "../ui-cli/check";
export type { UiCompileResult } from "../ui-cli/dsl/compile";
export { printUiDocument, type PrintOptions as UiPrintOptions } from "../ui-cli/dsl/print";
export {
    describeWidget,
    formatWidgetDetail,
    formatWidgetList,
    listWidgetModules,
    queryWidgets,
    WIDGET_STAGE_SLOTS,
    WIDGET_SURFACE_KINDS,
    type WidgetDetail,
    type WidgetSummary,
} from "../ui-cli/catalog";
export { findUsages, formatPropValues, formatUsages, type UsageSite } from "../ui-cli/usage";
export {
    collectTree,
    deriveElementId,
    elementPath,
    findComponent,
    findSurface,
    indexBlueprintDocument,
    readableUiDocument,
    textKeysOf,
    type BlueprintIndex,
    type TextKeys,
} from "../ui-cli/model";
export {
    activeWidgetModuleSource,
    registryWidgetModuleSource,
    withWidgetModuleSource,
    type WidgetModuleSource,
} from "../ui-cli/widgetSource";

// ---------------------------------------------------------------------------
// Story (.story)
// ---------------------------------------------------------------------------

export {
    applyStorySource,
    checkStoryProjectText,
    checkStorySourceText,
    resolveStory,
    showStoryScene,
    storedStoriesOf,
    type StoryAgentContext,
} from "./story";
export {
    DEFAULT_COMMAND_LIMIT,
    formatOpaqueRowNotice,
    storyApplyCommand,
    storyCategoriesCommand,
    storyCheckProjectCommand,
    storyCheckSourceCommand,
    storyCommandCommand,
    storyCommandsCommand,
    storyLinesCommand,
    storyScenesCommand,
    storyShowCommand,
    storyStoriesCommand,
    storyTargetsCommand,
    type StoryApplyInput,
    type StoryApplyOptions,
    type StoryApplyResult,
    type StoryCheckResult,
    type StoryShowResult,
} from "../story-cli/core";
export {
    checkStorySource,
    formatDiagnostics as formatStoryDiagnostics,
    hasErrors as storyHasErrors,
    lintStoredStories,
    type CheckResult as StoryCheckReport,
    type StoredStories,
    type StoryLintStory,
} from "../story-cli/check";
export { applySceneToDocument, type ApplySummary as StoryApplySummary } from "../story-cli/apply";
export { COMMAND_CATEGORIES as STORY_COMMAND_CATEGORIES } from "../story-cli/catalog";
export {
    buildContext as buildStoryCommandContextFor,
    buildStoryProjectContext,
    emptyProjectData as emptyStoryProjectContext,
    findScene,
    findStory,
    orderedScenes,
    readableStoryDocument,
    storySummariesOf,
    type ProjectData as StoryProjectContext,
    type StoryProjectDocuments,
    type StorySummary,
} from "../story-cli/model";

// ---------------------------------------------------------------------------
// Blueprint (.bp)
// ---------------------------------------------------------------------------

export {
    applyBlueprintSource,
    buildBlueprintProjectContext,
    checkBlueprintProjectText,
    checkBlueprintSource,
    checkBlueprintSourceText,
    ensureCoreBlueprintNodes,
    type BlueprintProjectDocuments,
} from "./blueprint";
export {
    DEFAULT_NODE_LIST_LIMIT,
    blueprintApplyCommand,
    blueprintCategoriesCommand,
    blueprintCheckProjectCommand,
    blueprintCheckSourceCommand,
    blueprintListCommand,
    blueprintNodeCommand,
    blueprintNodesCommand,
    blueprintShowCommand,
    blueprintStructsCommand,
    blueprintTargetsCommand,
    checkOptionsFor as blueprintCheckOptionsFor,
    matchBlueprints,
    unscopedWidgetWarning,
    type BlueprintApplyOptions,
    type BlueprintApplyResult,
    type BlueprintCheckSourceResult,
    type BlueprintNodeOptions,
    type BlueprintNodesQuery,
    type BlueprintProjectInput,
    type BlueprintShowResult,
} from "../blueprint-cli/core";
export { formatDiagnostics as formatBlueprintDiagnostics, type CheckResult as BlueprintCheckReport } from "../blueprint-cli/check";
export { BLUEPRINT_GRAPH_KINDS, BLUEPRINT_OWNER_KINDS, listNodeCategories } from "../blueprint-cli/catalog";
export { printBlueprint, printBlueprints } from "../blueprint-cli/dsl/print";
export {
    applyBlueprintsToDocument,
    assetNameContextOf,
    projectVariablesOf,
    publishPageParams,
    publishSaveSchema,
    readableBlueprintDocument,
    uiDocumentTargetsOf,
    type ApplyResult as BlueprintApplyChanges,
    type ProjectVariables,
    type UiDocumentTargets,
} from "../blueprint-cli/model";
