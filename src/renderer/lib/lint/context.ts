import type { ProjectAppTag } from "@shared/types/appTag";
import type { StoryDocument } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { LocalizationDocument } from "@shared/types/localization";
import type { VoiceDocument } from "@shared/types/voice";
import type { GameBuildPlatform } from "@shared/types/gameBuild";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import type { MergedPersistentNameCollision } from "@shared/variables/mergedPersistentView";
import type { AssetSet } from "@shared/types/assetSet";
import type { AssetType } from "../workspace/services/assets/assetTypes";
import type { AssetReference, ReferenceIndexResult } from "../workspace/services/references/referenceModel";
import type { LintingConfiguration, NetworkConfiguration } from "../workspace/project/configuration";
import type { NetworkPluginAllowlistEntry } from "@shared/types/networkAllowlist";

/**
 * The snapshot every lint rule reads.
 *
 * Assembled once per sweep by `LintService.buildContext()` and then frozen in practice: a rule is a
 * pure function of this value. That is the whole reason every rule is testable without a running
 * app - `createTestLintContext()` (see `testContext.ts`) hands a rule test an empty-but-valid one.
 *
 * Two shapes deserve a note:
 *
 *  - **`localization` / `voice` are `null` when the project never configured them**, not empty.
 *    Per ruling R5 the affected rules return `[]` in that state rather than being switched off, so
 *    an author who configures the feature later gets the checks without visiting a settings panel
 *    they never knew existed. `null` is what tells a rule "silent", `{documents: empty}` would mean
 *    "configured and nothing translated", which is a finding.
 *  - **`io` is the only impurity.** Reading asset bytes and decoding an image cannot be a pure
 *    function, so they are a narrow facade rather than a service handle. A rule that wants anything
 *    else off a service is a rule whose data belongs on this context.
 */

export type LintStoryEntry = { id: string; name: string; document: StoryDocument };

export type LintAssetEntry = {
    id: string;
    type: AssetType;
    name: string;
    ext?: string;
    hash?: string;
    meta: unknown;
    /**
     * The author's tags, verbatim.
     *
     * Here because an asset set names its members by tag rather than by id, so "does this set
     * resolve" is a question about this field and nothing else. Every other rule reads the
     * library for what a file *is*; this is the one place it is read for what a file *means*.
     */
    tags: readonly string[];
};

export type LintCharacterEntry = { id: string; name: string; assetIds: readonly string[] };

/** A display name declared in both the project registry and a story declaration row. */
export type PersistentNameCollision = MergedPersistentNameCollision;

export type LintImageProbe =
    | { ok: true; width: number; height: number }
    | { ok: false; reason: string };

export type LintIo = {
    /**
     * Whether the asset's content shard is there at all.
     *
     * Separate from {@link readBytes} because presence and contents are different questions with
     * wildly different prices, and `assets/unreadable` only ever needed the first one - of *every*
     * asset in the library, on *every* build (it is an error-severity rule and the build gate runs
     * it). Answering it with a byte read pulled the whole library across IPC - gigabytes of audio
     * and video on a real VN - and then dropped every buffer on the floor.
     */
    exists(assetId: string): Promise<boolean>;
    /** null when the content file cannot be read at all. */
    readBytes(assetId: string): Promise<Uint8Array | null>;
    probeImage(assetId: string): Promise<LintImageProbe>;
};

export type LintLocalizationContext = {
    sourceLocale: string;
    targetLocales: readonly string[];
    documents: ReadonlyMap<string, LocalizationDocument>;
};

export type LintVoiceContext = {
    voicedLocales: readonly string[];
    documents: ReadonlyMap<string, VoiceDocument>;
};

export type LintContext = {
    config: LintingConfiguration;
    /**
     * The project's network policy.
     *
     * Here rather than read off a service, for the reason stated above: a rule is a pure function of
     * this value. `network/fetch-disallowed` is the whole reason it exists - whether a blueprint's
     * network nodes are a problem is not a property of the blueprint, it is a property of the
     * blueprint *and* the setting that decides whether the shipped game may reach the network.
     */
    network: NetworkConfiguration;
    /**
     * What each installed plugin declared in `contributes.network`, attributed.
     *
     * Here for the reason {@link network} is: whether an address is a problem depends on the
     * project's list *and* on what the author already approved at install, and a rule that
     * read only the first would report a request that works.
     */
    pluginNetworkDeclarations: readonly NetworkPluginAllowlistEntry[];
    stories: readonly LintStoryEntry[];
    /**
     * Whether {@link stories} is the whole library.
     *
     * `false` when the index could not be read at all, or when a story in it failed to load - that
     * story is simply absent from the list above, and a rule that asks "does this scene id still
     * exist" would answer no for every scene in it. The same distinction `assetIndex.complete`
     * draws, for the same reason: a rule must be able to tell an empty project from an unread one.
     * A story that failed to load already reports itself; nothing else should pile on.
     */
    storiesComplete: boolean;
    blueprintDocument: BlueprintDocument | null;
    uiDocument: UIDocument | null;
    assets: readonly LintAssetEntry[];
    /**
     * The sets the project declares.
     *
     * Empty in a project that has declared none, which is an ordinary state and not an unread
     * one - unlike {@link assetIndex}, nothing here can partially fail: the document either
     * loaded or the service is holding an empty list and has already reported why.
     */
    assetSets: readonly AssetSet[];
    referencedAssetIds: ReadonlySet<string>;
    assetReferences: ReadonlyMap<string, readonly AssetReference[]>;
    /**
     * Whether the two sets above describe the whole project.
     *
     * Carried rather than inferred, because the two ways of inferring it are both wrong: an empty
     * key set is what a genuinely tidy project looks like, and a full one says nothing about the
     * document the index could not read. `assets/unused` is the rule that cannot survive either
     * mistake - every asset in the project is "unused" to an index that never ran.
     */
    assetIndex: ReferenceIndexResult;
    characters: readonly LintCharacterEntry[];
    /**
     * Every build variant the project has, release included - the list `AppTag == "Demo"` is checked
     * against.
     *
     * Names as stored. Every surface shows a variant under the name stored here, the release one
     * included - it is called "main" in every language - so what a rule checks and what the build
     * folds against are the same string.
     */
    appTags: readonly ProjectAppTag[];
    /**
     * The project variable registry, BOTH scopes, exactly as the service holds it.
     *
     * One list rather than two because an entry carries its own `scope`, and a rule that needs one
     * scope must say so at the point it reads (`entry.scope === "persistent"`). Splitting it here
     * would only move the same decision somewhere a rule author never looks - and the display-name
     * index genuinely wants every entry regardless of scope.
     */
    variableRegistry: readonly VariableRegistryEntry[];
    persistentNameCollisions: readonly PersistentNameCollision[];
    /** The same cross-surface ambiguity for the `saved` scope, which is now project-level too. */
    savedNameCollisions: readonly PersistentNameCollision[];
    localization: LintLocalizationContext | null;
    /**
     * Named localization keys, by name - the registry `Get Text` picks from.
     *
     * Separate from {@link localization}, which is about translations of the script: a project can
     * declare named keys with no target locale configured at all. `null` means the key document had
     * not finished loading when the sweep started, which is not the same as a project with no keys
     * and must not be read as one.
     */
    localizationKeyNames: ReadonlySet<string> | null;
    voice: LintVoiceContext | null;
    buildPlatforms: readonly GameBuildPlatform[];
    io: LintIo;
};
