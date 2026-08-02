import type { StoryDocument } from "@shared/types/story";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { LocalizationDocument } from "@shared/types/localization";
import type { VoiceDocument } from "@shared/types/voice";
import type { GameBuildPlatform } from "@shared/types/gameBuild";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import type { MergedPersistentNameCollision } from "@shared/variables/mergedPersistentView";
import type { AssetType } from "../workspace/services/assets/assetTypes";
import type { AssetReference } from "../workspace/services/references/referenceModel";
import type { LintingConfiguration } from "../workspace/project/configuration";

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
};

export type LintCharacterEntry = { id: string; name: string; assetIds: readonly string[] };

/** A display name declared in both the project registry and a story `/persis` row. */
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
    stories: readonly LintStoryEntry[];
    blueprintDocument: BlueprintDocument | null;
    uiDocument: UIDocument | null;
    assets: readonly LintAssetEntry[];
    referencedAssetIds: ReadonlySet<string>;
    assetReferences: ReadonlyMap<string, readonly AssetReference[]>;
    characters: readonly LintCharacterEntry[];
    variableRegistry: readonly VariableRegistryEntry[];
    persistentNameCollisions: readonly PersistentNameCollision[];
    localization: LintLocalizationContext | null;
    voice: LintVoiceContext | null;
    buildPlatforms: readonly GameBuildPlatform[];
    io: LintIo;
};
