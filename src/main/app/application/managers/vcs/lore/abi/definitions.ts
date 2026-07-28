/**
 * The slice of the Lore C ABI that Studio binds.
 *
 * Pure data: no koffi import, no native library, nothing that can fail to load.
 * `register.ts` turns it into koffi types; `definitions.test.ts` checks every entry
 * against `upstream.json`, the snapshot extracted from the SDK's generated bindings
 * (which are themselves generated from `lore-capi/lore.h`).
 *
 * Why hand-written at all, when a generated binding exists: see docs/version-control.md.
 * The short version is that the generated runtime converts arguments through a lookup
 * table with a missing handler, and its failure mode is a silently zero-filled
 * identifier rather than an error. Here the struct field's declared type IS the
 * encoding rule - a `LoreString` takes a hex string, a `LoreHash` takes 32 bytes -
 * so there is nothing left to infer and nothing to guess wrong.
 *
 * Lore v0.8.5. Adding a verb means adding its args struct here, its event structs,
 * and a wrapper in `verbs.ts`. Nothing else.
 */

/**
 * A koffi type expression: a primitive, a registered type name, `T*`, or `T[n]`.
 *
 * Deliberately not a string union of the valid names. The real check is
 * `definitions.test.ts`, which compares every field against the extracted header
 * snapshot - a union here would only restate a subset of that check while making
 * the table unreadable, and it cannot catch the mistakes that matter (a field with
 * the right *shape* but the wrong type).
 */
export type LoreFieldType = string;

export type LoreStructDefinition = Readonly<Record<string, LoreFieldType>>;

/**
 * Aliases Lore's header declares for its enums and id types. Registering them keeps
 * struct definitions readable (`action: "LoreFileAction"`) and keeps this file
 * comparable to the header one-for-one.
 */
export const LORE_ALIASES = {
    lore_node_id_t: "uint32_t",
    LoreLogLevel: "uint32_t",
    LoreBranchLocation: "uint32_t",
    LoreFileAction: "uint32_t",
    LoreNodeType: "uint32_t",
    LoreErrorCode: "uint32_t",
    LoreMetadataType: "uint32_t",
    LoreKeyType: "uint32_t",
    LoreMetadataTag: "uint32_t",
    LoreEventTag: "uint32_t",
} as const satisfies Readonly<Record<string, string>>;

/**
 * Aliases whose target is a struct, so they must be registered after it. Split from
 * the primitive aliases above purely for registration order.
 */
export const LORE_STRUCT_ALIASES = {
    LoreBranchId: "LoreContext",
    LoreRepositoryId: "LorePartition",
} as const satisfies Readonly<Record<string, string>>;

/**
 * Every struct Studio binds, in dependency order - koffi resolves type names at
 * declaration time, so a struct must follow everything it mentions.
 *
 * Field types are transcribed from `upstream.json` verbatim. The one deliberate
 * divergence is documented in {@link ABI_DIVERGENCES}.
 */
export const LORE_STRUCTS = {
    // -- primitives -------------------------------------------------------------
    LoreString: { string: "uint8_t*", length: "uintptr_t" },
    LoreHash: { data: "uint8_t[32]" },
    LoreContext: { data: "uint8_t[16]" },
    LorePartition: { data: "uint8_t[16]" },
    LoreAddress: { hash: "LoreHash", context: "LoreContext" },
    LoreBytes: { ptr: "uint8_t*", len: "uintptr_t" },
    LoreBinary: { payload: "uint8_t*", length: "uintptr_t" },
    LoreStringArray: { ptr: "LoreString*", count: "uintptr_t" },
    LoreTraceLocation: { file: "LoreString", line: "uint32_t", column: "uint32_t", context: "LoreString" },
    LoreTraceLocationArray: { ptr: "LoreTraceLocation*", count: "uintptr_t" },
    LoreErrorDetail: { errorCode: "int32_t", message: "LoreString", traceLocations: "LoreTraceLocationArray" },

    // -- handles ----------------------------------------------------------------
    LoreStore: { handleId: "uint64_t" },
    LoreRevisionTree: { handleId: "uint64_t" },

    // -- shared aggregates ------------------------------------------------------
    LoreBranchPoint: { branch: "LoreBranchId", revision: "LoreHash" },
    LoreBranchPointArray: { ptr: "LoreBranchPoint*", count: "uintptr_t" },
    LoreStorageRemoteConfig: { remoteUrl: "LoreString" },
    LoreStorageGetItem: {
        id: "uint64_t",
        partition: "LorePartition",
        address: "LoreAddress",
        streaming: "uint8_t",
        localCache: "uint8_t",
    },
    LoreStorageGetItemArray: { ptr: "LoreStorageGetItem*", count: "uintptr_t" },
    LoreMetadataTypeArray: { ptr: "LoreMetadataType*", count: "uintptr_t" },
    LoreFileStageCountData: {
        directoryModifyCount: "uint64_t",
        directoryAddCount: "uint64_t",
        directoryDeleteCount: "uint64_t",
        directoryMoveCount: "uint64_t",
        fileModifyCount: "uint64_t",
        fileAddCount: "uint64_t",
        fileDeleteCount: "uint64_t",
        fileMoveCount: "uint64_t",
        totalCount: "uint64_t",
    },
    LoreBranchSwitchData: {
        id: "LoreBranchId",
        name: "LoreString",
        latestLocal: "LoreHash",
        latestRemote: "LoreHash",
        revision: "LoreHash",
        location: "LoreBranchLocation",
    },

    // -- globals ----------------------------------------------------------------
    LoreGlobalArgs: {
        repositoryPath: "LoreString",
        correlationId: "LoreString",
        identity: "LoreString",
        force: "uint8_t",
        offline: "uint8_t",
        local: "uint8_t",
        remote: "uint8_t",
        dryRun: "uint8_t",
        noAtime: "uint8_t",
        maxConnections: "uint32_t",
        searchLimit: "uint32_t",
        searchNearest: "uint8_t",
        noGc: "uint8_t",
        inMemory: "uint8_t",
        fileCountLimit: "uint64_t",
        fileSizeLimit: "uint64_t",
        compressTaskLimit: "uint64_t",
        storeKeepAlive: "uint8_t",
        storeKeepAliveSeconds: "uint64_t",
        syncData: "uint8_t",
        cache: "uint8_t",
    },

    // -- args -------------------------------------------------------------------
    LoreRepositoryCreateArgs: {
        repositoryUrl: "LoreString",
        description: "LoreString",
        id: "LoreString",
        useSharedStore: "uint8_t",
        sharedStorePath: "LoreString",
    },
    LoreRepositoryFlushArgs: { unused: "int" },
    LoreRepositoryReleaseArgs: { unused: "int" },
    LoreRepositoryStatusArgs: {
        staged: "uint8_t",
        scan: "uint8_t",
        checkDirty: "uint8_t",
        reset: "uint8_t",
        syncPoint: "uint8_t",
        revisionOnly: "uint8_t",
        count: "uint8_t",
        paths: "LoreStringArray",
    },
    LoreFileStageArgs: { paths: "LoreStringArray", caseChange: "uint32_t", scan: "uint8_t" },
    LoreFileUnstageArgs: { paths: "LoreStringArray" },
    LoreRevisionCommitArgs: {
        message: "LoreString",
        link: "LoreString",
        linkPaths: "LoreStringArray",
        linkMessages: "LoreStringArray",
        layer: "LoreString",
        layerPaths: "LoreStringArray",
        layerMessages: "LoreStringArray",
        stats: "uint8_t",
    },
    LoreRevisionHistoryArgs: {
        revision: "LoreString",
        branch: "LoreString",
        date: "uint64_t",
        length: "uint32_t",
        onlyBranch: "uint8_t",
    },
    LoreRevisionInfoArgs: { revision: "LoreString", delta: "uint8_t", metadata: "uint8_t" },
    LoreRevisionDiffArgs: { revisionSource: "LoreString", revisionTarget: "LoreString", paths: "LoreStringArray" },
    LoreRevisionRestoreArgs: { message: "LoreString" },
    LoreStorageOpenArgs: {
        repositoryPath: "LoreString",
        inMemory: "uint8_t",
        remoteConfig: "LoreStorageRemoteConfig",
        hasRemoteConfig: "uint8_t",
        cacheTargetBytes: "uint64_t",
        cacheTargetFragments: "uint64_t",
    },
    LoreStorageCloseArgs: { handle: "LoreStore" },
    LoreStorageGetArgs: { handle: "LoreStore", items: "LoreStorageGetItemArray" },
    LoreRevisionTreeLoadArgs: { store: "LoreStore", repository: "LorePartition", revisionHash: "LoreHash" },
    LoreRevisionTreeCloseArgs: { id: "uint64_t", handle: "LoreRevisionTree" },
    LoreRevisionTreeResolvePathArgs: { id: "uint64_t", handle: "LoreRevisionTree", path: "LoreString" },
    LoreRevisionTreeNodeInfoArgs: { id: "uint64_t", handle: "LoreRevisionTree", nodeId: "lore_node_id_t" },
    LoreBranchListArgs: { archived: "uint8_t" },
    LoreBranchCreateArgs: { branch: "LoreString", category: "LoreString", id: "LoreString" },
    LoreBranchSwitchArgs: { branch: "LoreString", revision: "LoreString", reset: "uint8_t", bare: "uint8_t" },
    LoreBranchInfoArgs: { branch: "LoreString" },

    // -- events -----------------------------------------------------------------
    LoreErrorEventData: { errorType: "uint32_t", errorInner: "LoreString" },
    LoreCompleteEventData: { status: "int32_t", error: "LoreErrorDetail" },
    LoreEndEventData: { unused: "uint32_t" },
    LoreLogEventData: {
        level: "LoreLogLevel",
        category: "uint32_t",
        timestamp: "uint64_t",
        location: "LoreString",
        message: "LoreString",
    },
    LorePathIgnoreEventData: { path: "LoreString" },
    LoreFilterExcludeEventData: { reason: "uint8_t", path: "LoreString" },
    LoreRepositoryCreateEventData: { id: "LoreRepositoryId", name: "LoreString", path: "LoreString" },
    LoreRepositoryStatusRevisionEventData: {
        repository: "LoreRepositoryId",
        branch: "LoreBranchId",
        branchName: "LoreString",
        revision: "LoreHash",
        revisionNumber: "uint64_t",
        revisionStaged: "LoreHash",
        revisionMerged: "LoreHash",
        revisionMergedParentBranch: "LoreHash",
        revisionLocal: "LoreHash",
        revisionLocalNumber: "uint64_t",
        revisionRemote: "LoreHash",
        revisionRemoteNumber: "uint64_t",
        isLocalAhead: "uint8_t",
        isRemoteAhead: "uint8_t",
        remoteAvailable: "uint8_t",
        remoteAuthorized: "uint8_t",
        remoteBranchExist: "uint8_t",
    },
    LoreRepositoryStatusFileEventData: {
        path: "LoreString",
        size: "uint64_t",
        action: "LoreFileAction",
        type: "LoreNodeType",
        flagStaged: "uint8_t",
        flagMerged: "uint8_t",
        flagConflict: "uint8_t",
        flagConflictUnresolved: "uint8_t",
        flagConflictAutomerged: "uint8_t",
        flagConflictMine: "uint8_t",
        flagConflictTheirs: "uint8_t",
        flagDirty: "uint8_t",
        fromPath: "LoreString",
    },
    LoreRepositoryStatusSummaryEventData: {
        adds: "uint64_t",
        deletes: "uint64_t",
        modifies: "uint64_t",
        moves: "uint64_t",
        copies: "uint64_t",
    },
    LoreRepositoryStatusCountEventData: { directories: "uint64_t", files: "uint64_t" },
    LoreFileStageFileEventData: { fromPath: "LoreString", path: "LoreString", action: "LoreFileAction" },
    LoreFileStageEndEventData: { count: "LoreFileStageCountData" },
    LoreFileStageRevisionEventData: { repository: "LoreRepositoryId", revision: "LoreHash" },
    LoreRevisionCommitRevisionEventData: {
        repository: "LoreRepositoryId",
        branch: "LoreBranchId",
        revision: "LoreHash",
        revisionNumber: "uint64_t",
        parent: "LoreHash",
        parentOther: "LoreHash",
    },
    LoreRevisionHistoryEventData: { repository: "LoreRepositoryId", branch: "LoreBranchId" },
    LoreRevisionHistoryEntryEventData: { revision: "LoreHash", revisionNumber: "uint64_t", parent: "LoreHash[2]" },
    LoreRevisionInfoEventData: {
        repository: "LoreRepositoryId",
        revision: "LoreHash",
        revisionNumber: "uint64_t",
        parent: "LoreHash[2]",
    },
    LoreRevisionDiffFileEventData: {
        path: "LoreString",
        action: "LoreFileAction",
        oldIsFile: "uint8_t",
        newIsFile: "uint8_t",
        oldAddress: "LoreAddress",
        newAddress: "LoreAddress",
    },
    LoreRevisionRestoreRevisionEventData: { revision: "LoreHash", revisionNumber: "uint64_t" },
    LoreRevisionRestoreFileEventData: {
        path: "LoreString",
        action: "LoreFileAction",
        size: "uint64_t",
        isFile: "uint8_t",
        isDirectory: "uint8_t",
        isModule: "uint8_t",
    },
    LoreStorageOpenedEventData: { handleId: "uint64_t" },
    LoreStorageGetHeaderEventData: { id: "uint64_t", address: "LoreAddress", sizeContent: "uint64_t" },
    LoreStorageGetDataEventData: { id: "uint64_t", address: "LoreAddress", offset: "uint64_t", bytes: "LoreBytes" },
    LoreStorageGetItemCompleteEventData: { id: "uint64_t", address: "LoreAddress", errorCode: "LoreErrorCode" },
    LoreRevisionTreeLoadedEventData: { handleId: "uint64_t" },
    LoreRevisionTreeResolvePathCompleteEventData: {
        id: "uint64_t",
        nodeId: "lore_node_id_t",
        repository: "LoreRepositoryId",
        revision: "LoreHash",
        errorCode: "LoreErrorCode",
    },
    LoreRevisionTreeNodeInfoEventData: {
        id: "uint64_t",
        nodeId: "lore_node_id_t",
        repository: "LoreRepositoryId",
        revision: "LoreHash",
        name: "LoreString",
        parentId: "lore_node_id_t",
        kind: "uint32_t",
        mode: "uint16_t",
        size: "uint64_t",
        address: "LoreAddress",
        fileId: "LoreContext",
        errorCode: "LoreErrorCode",
    },
    LoreRevisionTreeCloseCompleteEventData: { id: "uint64_t", errorCode: "LoreErrorCode" },
    LoreBranchListEntryEventData: {
        location: "LoreBranchLocation",
        id: "LoreBranchId",
        name: "LoreString",
        category: "LoreString",
        latest: "LoreHash",
        stack: "LoreBranchPointArray",
        creator: "LoreString",
        created: "uint64_t",
        isCurrent: "uint8_t",
        archived: "uint8_t",
    },
    LoreBranchInfoEventData: {
        id: "LoreBranchId",
        name: "LoreString",
        category: "LoreString",
        latest: "LoreHash",
        latestRemote: "LoreHash",
        parent: "LoreBranchId",
        branchPoint: "LoreHash",
        creator: "LoreString",
        created: "uint64_t",
        stack: "LoreBranchPointArray",
        archived: "uint8_t",
    },
    LoreBranchCreateEventData: { name: "LoreString", latest: "LoreHash", isCommit: "uint8_t" },
    LoreBranchSwitchEndEventData: { branch: "LoreBranchSwitchData" },
} as const satisfies Readonly<Record<string, LoreStructDefinition>>;

export type LoreStructName = keyof typeof LORE_STRUCTS;

/**
 * Event tags Studio reacts to, with their wire values.
 *
 * Enum values are ABI: a renumbered tag routes an event to the wrong decoder, which
 * reads a struct at the wrong layout. `definitions.test.ts` checks each of these
 * against the extracted `LoreEventTag` enum, so a renumbering upstream fails the
 * build instead of producing garbage.
 *
 * Lore emits ~226 tags; these are the ones with a decoder. Everything else is
 * observed as a bare tag and ignored.
 */
export const LORE_EVENT_TAGS = {
    PROGRESS: 0,
    ERROR: 1,
    COMPLETE: 2,
    METADATA: 3,
    LOG: 4,
    END: 5,
    BRANCH_CREATE: 11,
    BRANCH_LIST_ENTRY: 15,
    BRANCH_INFO: 19,
    BRANCH_SWITCH_BEGIN: 77,
    BRANCH_SWITCH_END: 78,
    FILTER_EXCLUDE: 102,
    FILE_STAGE_BEGIN: 103,
    FILE_STAGE_END: 105,
    FILE_STAGE_REVISION: 106,
    FILE_STAGE_FILE: 107,
    PATH_IGNORE: 130,
    REPOSITORY_CREATE: 131,
    REPOSITORY_STATUS_REVISION: 151,
    REPOSITORY_STATUS_FILE: 152,
    REPOSITORY_STATUS_COUNT: 153,
    REPOSITORY_STATUS_SUMMARY: 154,
    REVISION_COMMIT_REVISION: 159,
    REVISION_INFO: 160,
    REVISION_DIFF_FILE: 162,
    REVISION_HISTORY: 164,
    REVISION_HISTORY_ENTRY: 165,
    REVISION_RESTORE_FILE: 167,
    REVISION_RESTORE_REVISION: 172,
    STORAGE_OPENED: 191,
    STORAGE_GET_HEADER: 193,
    STORAGE_GET_DATA: 194,
    STORAGE_GET_ITEM_COMPLETE: 195,
    REVISION_TREE_LOADED: 200,
    REVISION_TREE_RESOLVE_PATH_COMPLETE: 201,
    REVISION_TREE_NODE_INFO: 203,
    REVISION_TREE_CLOSE_COMPLETE: 212,
} as const;

export type LoreEventTagName = keyof typeof LORE_EVENT_TAGS;

/**
 * Payload offset inside an event blob.
 *
 * The blob is `{ uint32_t tag; <payload>; }` with the payload aligned to 8, so the
 * tag reads at 0 and every payload struct decodes at 8.
 */
export const LORE_EVENT_PAYLOAD_OFFSET = 8;

/**
 * The callback every verb takes: `void (*)(const uint8_t *event, uint64_t userContext)`.
 * Registered as a koffi prototype so a JS function can be handed to native code.
 */
export const LORE_CALLBACK_PROTOTYPE = {
    name: "LoreEventCallbackFunction",
    returns: "void",
    args: ["uint8_t*", "uint64_t"],
} as const;

/** `struct LoreEventCallbackConfig` - passed BY VALUE as the third argument. */
export const LORE_CALLBACK_CONFIG = {
    userContext: "uint64_t",
    callback: "LoreEventCallbackFunction*",
} as const;

/**
 * The verbs Studio binds, mapped to their args struct.
 *
 * Every Lore verb has the same shape - `int32_t f(const LoreGlobalArgs*, const
 * LoreXArgs*, LoreEventCallbackConfig)` - so the args struct is the only thing that
 * varies and the only thing worth tabulating. Symbols absent from the loaded
 * library are reported per-verb rather than at load (see `library.ts`): v0.8.5
 * exports 263 symbols but ships TypeScript types for functions it does not have.
 */
export const LORE_VERBS = {
    repositoryCreate: { symbol: "lore_repository_create", args: "LoreRepositoryCreateArgs" },
    repositoryFlush: { symbol: "lore_repository_flush", args: "LoreRepositoryFlushArgs" },
    repositoryRelease: { symbol: "lore_repository_release", args: "LoreRepositoryReleaseArgs" },
    repositoryStatus: { symbol: "lore_repository_status", args: "LoreRepositoryStatusArgs" },
    fileStage: { symbol: "lore_file_stage", args: "LoreFileStageArgs" },
    fileUnstage: { symbol: "lore_file_unstage", args: "LoreFileUnstageArgs" },
    revisionCommit: { symbol: "lore_revision_commit", args: "LoreRevisionCommitArgs" },
    revisionHistory: { symbol: "lore_revision_history", args: "LoreRevisionHistoryArgs" },
    revisionInfo: { symbol: "lore_revision_info", args: "LoreRevisionInfoArgs" },
    revisionDiff: { symbol: "lore_revision_diff", args: "LoreRevisionDiffArgs" },
    revisionRestore: { symbol: "lore_revision_restore", args: "LoreRevisionRestoreArgs" },
    storageOpen: { symbol: "lore_storage_open", args: "LoreStorageOpenArgs" },
    storageClose: { symbol: "lore_storage_close", args: "LoreStorageCloseArgs" },
    storageGet: { symbol: "lore_storage_get", args: "LoreStorageGetArgs" },
    revisionTreeLoad: { symbol: "lore_revision_tree_load", args: "LoreRevisionTreeLoadArgs" },
    revisionTreeClose: { symbol: "lore_revision_tree_close", args: "LoreRevisionTreeCloseArgs" },
    revisionTreeResolvePath: { symbol: "lore_revision_tree_resolve_path", args: "LoreRevisionTreeResolvePathArgs" },
    revisionTreeNodeInfo: { symbol: "lore_revision_tree_node_info", args: "LoreRevisionTreeNodeInfoArgs" },
    branchList: { symbol: "lore_branch_list", args: "LoreBranchListArgs" },
    branchCreate: { symbol: "lore_branch_create", args: "LoreBranchCreateArgs" },
    branchSwitch: { symbol: "lore_branch_switch", args: "LoreBranchSwitchArgs" },
    branchInfo: { symbol: "lore_branch_info", args: "LoreBranchInfoArgs" },
} as const satisfies Readonly<Record<string, { symbol: string; args: LoreStructName }>>;

export type LoreVerbName = keyof typeof LORE_VERBS;

/**
 * Where this file intentionally differs from `upstream.json`, and why.
 * `definitions.test.ts` reads this list; anything not in it must match exactly.
 */
export const ABI_DIVERGENCES: Readonly<Record<string, string>> = {};
