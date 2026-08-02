import koffi from "koffi";
import { LORE_EVENT_PAYLOAD_OFFSET, LORE_EVENT_TAGS, LORE_METADATA_TAGS } from "./abi/definitions";
import type { LoreLibrary } from "./library";
import { decodeBytes, decodeCount, decodeHash, decodeOptionalHash, decodeString, type LoreHex } from "./values";

/**
 * Decoding Lore's event stream into plain JS values.
 *
 * Every verb reports through the same callback: a pointer to
 * `{ uint32_t tag; <payload>; }`, called once per event, with the payload valid
 * only for the duration of that call. The SDK models this with a lazy `.data`
 * getter and a `.clone()` you must remember to call - and forgetting produces
 * random memory rather than an error.
 *
 * Here decoding is eager and total: by the time a payload leaves
 * {@link decodeEvent} it is an ordinary object holding copied strings and Buffers,
 * with nothing borrowed left to outlive the callback. That is the whole reason this
 * layer exists, and it costs a few microseconds per event.
 *
 * Tags with no decoder are reported as `{ tag }` with no payload. Lore defines ~226
 * of them and Studio reacts to a few dozen; the rest are progress chatter.
 */

export const LoreTag = LORE_EVENT_TAGS;
export type LoreTagValue = (typeof LORE_EVENT_TAGS)[keyof typeof LORE_EVENT_TAGS];

export interface LoreErrorPayload { errorType: number; message: string }
export interface LoreCompletePayload { status: number; errorCode: number; message: string; trace: string[] }
export interface LorePathIgnorePayload { path: string }
export interface LoreFilterExcludePayload { reason: number; path: string }
export interface LoreRepositoryCreatePayload { repository: LoreHex; name: string; path: string }

export interface LoreStatusRevisionPayload {
    repository: LoreHex;
    branch: LoreHex;
    branchName: string;
    revision?: LoreHex;
    revisionNumber: number;
    revisionStaged?: LoreHex;
    revisionMerged?: LoreHex;
    revisionLocal?: LoreHex;
    revisionLocalNumber: number;
    revisionRemote?: LoreHex;
    revisionRemoteNumber: number;
    isLocalAhead: boolean;
    isRemoteAhead: boolean;
    remoteAvailable: boolean;
    remoteAuthorized: boolean;
    remoteBranchExist: boolean;
}

export interface LoreStatusFilePayload {
    path: string;
    size: number;
    action: number;
    type: number;
    staged: boolean;
    merged: boolean;
    conflict: boolean;
    conflictUnresolved: boolean;
    /**
     * The last three of Lore's eight conflict flags.
     *
     * Decoded because they were being thrown away, NOT because their meaning is
     * settled. Nothing has yet observed what Lore sets them to on a real conflict, so
     * no reading of them is written down here; `mergeSpike.integration.test.ts` (E1,
     * E6) prints all eight against a measured conflict, and whatever it shows is what
     * the resolve UI gets to rely on.
     */
    conflictAutomerged: boolean;
    conflictMine: boolean;
    conflictTheirs: boolean;
    dirty: boolean;
    fromPath: string;
}

export interface LoreStatusSummaryPayload { adds: number; deletes: number; modifies: number; moves: number; copies: number }

/** One repository config key, as `repository_config_get` answers it. */
export interface LoreConfigPayload { key: string; value: string }

/** Byte and file counters shared by clone's begin/progress/end events. */
export interface LoreCloneCountPayload {
    fileComplete: number;
    fileCount: number;
    bytesTransferred: number;
    bytesTotal: number;
    /** Until this is true, the totals are still growing and a percentage would go backwards. */
    discoveryComplete: boolean;
}

export interface LoreCloneBeginPayload { repository: LoreHex; branch: string; revision?: LoreHex; path: string }
export interface LoreCloneProgressPayload { count: LoreCloneCountPayload }
export interface LoreCloneEndPayload { branch: string; revision?: LoreHex; count: LoreCloneCountPayload }

/** Where a sync is going: the branch, and the two revisions it moves between. */
export interface LoreSyncTargetPayload {
    remote: string;
    branchName: string;
    sourceRevision?: LoreHex;
    sourceRevisionNumber: number;
    targetRevision?: LoreHex;
    targetRevisionNumber: number;
    isLatest: boolean;
    /** The target was found locally; nothing had to be fetched. */
    local: boolean;
}

export interface LoreSyncProgressPayload {
    fileUpdate: number;
    fileUpdateTotal: number;
    fileDelete: number;
    fileDeleteTotal: number;
    fileAutomerge: number;
    /** Non-zero means the working tree now holds unresolved conflicts. */
    fileConflict: number;
    bytesUpdate: number;
    bytesUpdateTotal: number;
    discoveryComplete: boolean;
}

export interface LoreSyncRevisionPayload {
    revision: LoreHex;
    revisionNumber: number;
    merge: boolean;
    conflict: boolean;
}

/**
 * What a push did, or found it did not have to do.
 *
 * `alreadyPushed` is a SUCCESS: the remote already holds this branch tip. Reading it
 * as a failure would make "push twice" look broken.
 */
export interface LoreBranchPushPayload {
    remote: string;
    branchName: string;
    remoteRevision?: LoreHex;
    localRevision?: LoreHex;
    remoteHistory: number;
    localHistory: number;
    alreadyPushed: boolean;
}

/** The identity a token login established, as the remote reported it back. */
export interface LoreAuthIdentityPayload {
    authUrl: string;
    resource: string;
    userId: string;
    /** Epoch seconds; 0 when the remote did not say. */
    expires: number;
}
export interface LoreStageFilePayload { path: string; fromPath: string; action: number }
export interface LoreStageEndPayload { totalCount: number; fileAddCount: number; fileModifyCount: number; fileDeleteCount: number; fileMoveCount: number }

export interface LoreCommitRevisionPayload {
    repository: LoreHex;
    branch: LoreHex;
    revision: LoreHex;
    revisionNumber: number;
    parents: LoreHex[];
}

export interface LoreHistoryPayload { repository: LoreHex; branch: LoreHex }
export interface LoreHistoryEntryPayload { revision: LoreHex; revisionNumber: number; parents: LoreHex[] }
export interface LoreRevisionInfoPayload { repository: LoreHex; revision: LoreHex; revisionNumber: number; parents: LoreHex[] }
export interface LoreDiffFilePayload { path: string; action: number; oldIsFile: boolean; newIsFile: boolean }
export interface LoreRestoreRevisionPayload { revision: LoreHex; revisionNumber: number }
export interface LoreRestoreFilePayload { path: string; action: number; size: number; isFile: boolean; isDirectory: boolean }
export interface LoreStorageOpenedPayload { handleId: number }
export interface LoreStorageHeaderPayload { id: number; hash: LoreHex; context: LoreHex; sizeContent: number }
export interface LoreStorageDataPayload { id: number; offset: number; bytes: Buffer }
export interface LoreStorageItemCompletePayload { id: number; errorCode: number }
export interface LoreTreeLoadedPayload { handleId: number }
export interface LoreTreeResolvePayload { id: number; nodeId: number; repository: LoreHex; revision: LoreHex; errorCode: number }

export interface LoreTreeNodeInfoPayload {
    id: number;
    nodeId: number;
    name: string;
    parentId: number;
    kind: number;
    mode: number;
    size: number;
    /** Content address: the pair `storageGet` needs to fetch the bytes. */
    hash: LoreHex;
    context: LoreHex;
    errorCode: number;
}

/**
 * One directory entry, as `revisionTreeListChildren` reports it.
 *
 * The same JS shape as a node info, deliberately: the two C structs differ (a child
 * carries no repository/revision pair and no `fileId`) but everything a caller does
 * with either is name + kind + address, and one shape means a tree walk can hand its
 * entries to the same address reader.
 */
export type LoreTreeChildPayload = LoreTreeNodeInfoPayload;

export interface LoreTreeCloseCompletePayload { id: number; errorCode: number }

export interface LoreBranchEntryPayload {
    id: LoreHex;
    name: string;
    category: string;
    latest?: LoreHex;
    creator: string;
    created: number;
    isCurrent: boolean;
    archived: boolean;
    location: number;
}

export interface LoreBranchInfoPayload {
    id: LoreHex;
    name: string;
    category: string;
    latest?: LoreHex;
    latestRemote?: LoreHex;
    parent?: LoreHex;
    branchPoint?: LoreHex;
    creator: string;
    created: number;
    archived: boolean;
}

export interface LoreBranchCreatePayload { name: string; latest?: LoreHex; isCommit: boolean }
export interface LoreLogPayload { level: number; message: string; location: string }

// -- merge ------------------------------------------------------------------

/** Where a merge starts from: the branch being merged in, and its tip. */
export interface LoreMergeStartBeginPayload { branch: LoreHex; revision?: LoreHex; revisionNumber: number }

/**
 * How a merge ended, including whether anything is left for a human.
 *
 * `stats` is the same counter block a sync reports - `fileAutomerge` and `fileConflict`
 * are the two that say what the merge did on its own - which is the first hint that a
 * branch merge and a sync-induced merge may be the same machinery underneath. Whether
 * they really are is measured, not assumed: see E6 of `mergeSpike.integration.test.ts`.
 */
export interface LoreMergeStartEndPayload {
    stats: LoreSyncProgressPayload;
    signature?: LoreHex;
    hasConflicts: boolean;
}

/** One path the merge could not settle. Repository-relative, like every other output path. */
export interface LoreMergeConflictFilePayload { path: string }
export interface LoreMergeResolveFilePayload { path: string }
export interface LoreMergeResolveRevisionPayload { repository: LoreHex; revision?: LoreHex }

/**
 * The two revisions an abort restores to.
 *
 * Reported before the rollback, not after, so a caller that wants to know where it was
 * taken back to has this and nothing else.
 */
export interface LoreMergeAbortBeginPayload { stateStagedRevision?: LoreHex; stateCurrentRevision?: LoreHex }

/** The abort finished. Carries no data; decoded so its arrival is observable at all. */
export interface LoreMergeAbortEndPayload { unused: number }

export interface LoreMergeUnresolveFilePayload { path: string }

/**
 * One metadata entry, as reported by the metadata read verbs.
 *
 * `text` is present only for a STRING value, `numeric` only for a NUMERIC one. The other
 * five tags are reported with their `tag` and no value rather than coerced: the payload
 * is a union, and reading one member as another dereferences a number as a pointer.
 * Studio writes only strings; a revision's own `timestamp` is where NUMERIC comes from.
 */
export interface LoreMetadataPayload { key: string; tag: number; text?: string; numeric?: number }

/** A decoded event: the tag, plus a payload when Studio has a decoder for it. */
export interface LoreEvent<T = unknown> {
    tag: number;
    data?: T;
}

/**
 * A payload decoder.
 *
 * `pointer` is the raw event pointer, passed because one payload cannot be read from
 * the decoded struct alone: see the METADATA decoder, where the value is a union whose
 * real offset the struct declaration deliberately does not describe. Every other
 * decoder ignores it.
 */
type Decoder = (raw: Record<string, unknown>, pointer: unknown) => unknown;

/** Struct-typed fields decode to nested objects; this keeps the casts in one place. */
const nested = (raw: unknown, field: string): Record<string, unknown> =>
    ((raw as Record<string, unknown>)[field] ?? {}) as Record<string, unknown>;

const bool = (value: unknown): boolean => Number(value ?? 0) !== 0;

/**
 * `LoreHash[2]`, Lore's parent slots. The second is only set on a merge, and unset
 * slots are all-zero rather than absent - so a naive read reports every revision as
 * having two parents, one of which does not exist.
 */
function decodeParents(raw: unknown, field: string): LoreHex[] {
    const slots = ((raw as Record<string, unknown>)[field] ?? []) as Array<{ data: ArrayLike<number> }>;
    const parents: LoreHex[] = [];
    for (const slot of Array.from(slots)) {
        const hex = decodeOptionalHash(slot);
        if (hex) parents.push(hex);
    }
    return parents;
}

/**
 * Build the tag -> decoder table for a loaded library.
 *
 * Bound to a library instance because decoding needs its registered koffi types.
 * Cached per library; the table is pure and shared.
 */
const tables = new WeakMap<LoreLibrary, Map<number, Decoder>>();

function decoderTable(library: LoreLibrary): Map<number, Decoder> {
    const cached = tables.get(library);
    if (cached) return cached;

    const type = (name: string) => library.type(name);
    const table = new Map<number, Decoder>();

    table.set(LoreTag.ERROR, (raw): LoreErrorPayload => ({
        errorType: decodeCount(raw.errorType),
        message: decodeString(nested(raw, "errorInner")),
    }));

    table.set(LoreTag.COMPLETE, (raw): LoreCompletePayload => {
        const error = nested(raw, "error");
        const locations = nested(error, "traceLocations");
        const count = Number(locations?.count ?? 0);
        const trace: string[] = [];
        if (locations?.ptr && count > 0) {
            // Rust file:line trace locations. Surfacing them is the difference between
            // "invalid arguments" and a place to look.
            const entries = koffi.decode(locations.ptr, type("LoreTraceLocation"), count) as Array<Record<string, unknown>>;
            for (const entry of entries) {
                const file = decodeString(nested(entry, "file"));
                const line = decodeCount(entry.line);
                if (file) trace.push(`${file}:${line}`);
            }
        }
        return {
            status: decodeCount(raw.status),
            errorCode: decodeCount(error.errorCode),
            message: decodeString(nested(error, "message")),
            trace,
        };
    });

    table.set(LoreTag.LOG, (raw): LoreLogPayload => ({
        level: decodeCount(raw.level),
        message: decodeString(nested(raw, "message")),
        location: decodeString(nested(raw, "location")),
    }));

    /**
     * A metadata entry, whose value is a tagged union.
     *
     * The union is read off the event pointer rather than out of the decoded struct,
     * and the offset is computed rather than assumed:
     *
     *  - `LoreMetadata` is declared here as `{ uint32_t tag; uint8_t data[48]; }`, which
     *    koffi lays out with `data` at offset 4. The real union is 8-aligned - it has
     *    pointer members - so it actually begins at offset 8. Decoding through `data`
     *    would read four bytes of padding as the front of the value.
     *  - Only STRING and NUMERIC are read, each as its own union member. The other five
     *    tags are reported with no value, because a value read as the wrong member is a
     *    crash rather than a wrong answer - a NUMERIC's eight bytes decoded as a
     *    `LoreString` would be dereferenced as a pointer.
     *
     * The generated SDK arrives at the same offset the same way (`offsetof(data)` plus
     * `sizeof(uint32_t)`), which is the only machine-readable evidence for the padding.
     *
     * NUMERIC is read because a revision's `timestamp` is one - measured, it is the only
     * non-STRING key on an ordinary revision - and it is what the history UI dates a
     * commit by. Without it, the value silently arrives as absent.
     */
    const metadataValueOffset = LORE_EVENT_PAYLOAD_OFFSET
        + koffi.offsetof(type("LoreMetadataEventData"), "value")
        + koffi.offsetof(type("LoreMetadata"), "data")
        + koffi.sizeof("uint32_t");

    table.set(LoreTag.METADATA, (raw, pointer): LoreMetadataPayload => {
        const value = nested(raw, "value");
        const tag = decodeCount(value.tag);
        const key = decodeString(nested(raw, "key"));
        if (tag === LORE_METADATA_TAGS.STRING) {
            const text = koffi.decode(pointer, metadataValueOffset, type("LoreString")) as Record<string, unknown>;
            return { key, tag, text: decodeString(text) };
        }
        if (tag === LORE_METADATA_TAGS.NUMERIC) {
            return { key, tag, numeric: decodeCount(koffi.decode(pointer, metadataValueOffset, "uint64_t")) };
        }
        return { key, tag };
    });

    table.set(LoreTag.PATH_IGNORE, (raw): LorePathIgnorePayload => ({
        path: decodeString(nested(raw, "path")),
    }));

    table.set(LoreTag.FILTER_EXCLUDE, (raw): LoreFilterExcludePayload => ({
        reason: decodeCount(raw.reason),
        path: decodeString(nested(raw, "path")),
    }));

    table.set(LoreTag.REPOSITORY_CREATE, (raw): LoreRepositoryCreatePayload => ({
        repository: decodeHash(nested(raw, "id")),
        name: decodeString(nested(raw, "name")),
        path: decodeString(nested(raw, "path")),
    }));

    table.set(LoreTag.REPOSITORY_STATUS_REVISION, (raw): LoreStatusRevisionPayload => ({
        repository: decodeHash(nested(raw, "repository")),
        branch: decodeHash(nested(raw, "branch")),
        branchName: decodeString(nested(raw, "branchName")),
        revision: decodeOptionalHash(nested(raw, "revision")),
        revisionNumber: decodeCount(raw.revisionNumber),
        revisionStaged: decodeOptionalHash(nested(raw, "revisionStaged")),
        revisionMerged: decodeOptionalHash(nested(raw, "revisionMerged")),
        revisionLocal: decodeOptionalHash(nested(raw, "revisionLocal")),
        revisionLocalNumber: decodeCount(raw.revisionLocalNumber),
        revisionRemote: decodeOptionalHash(nested(raw, "revisionRemote")),
        revisionRemoteNumber: decodeCount(raw.revisionRemoteNumber),
        isLocalAhead: bool(raw.isLocalAhead),
        isRemoteAhead: bool(raw.isRemoteAhead),
        remoteAvailable: bool(raw.remoteAvailable),
        remoteAuthorized: bool(raw.remoteAuthorized),
        remoteBranchExist: bool(raw.remoteBranchExist),
    }));

    table.set(LoreTag.REPOSITORY_STATUS_FILE, (raw): LoreStatusFilePayload => ({
        path: decodeString(nested(raw, "path")),
        size: decodeCount(raw.size),
        action: decodeCount(raw.action),
        type: decodeCount(raw.type),
        staged: bool(raw.flagStaged),
        merged: bool(raw.flagMerged),
        conflict: bool(raw.flagConflict),
        conflictUnresolved: bool(raw.flagConflictUnresolved),
        conflictAutomerged: bool(raw.flagConflictAutomerged),
        conflictMine: bool(raw.flagConflictMine),
        conflictTheirs: bool(raw.flagConflictTheirs),
        dirty: bool(raw.flagDirty),
        fromPath: decodeString(nested(raw, "fromPath")),
    }));

    table.set(LoreTag.REPOSITORY_STATUS_SUMMARY, (raw): LoreStatusSummaryPayload => ({
        adds: decodeCount(raw.adds),
        deletes: decodeCount(raw.deletes),
        modifies: decodeCount(raw.modifies),
        moves: decodeCount(raw.moves),
        copies: decodeCount(raw.copies),
    }));

    table.set(LoreTag.FILE_STAGE_FILE, (raw): LoreStageFilePayload => ({
        path: decodeString(nested(raw, "path")),
        fromPath: decodeString(nested(raw, "fromPath")),
        action: decodeCount(raw.action),
    }));

    table.set(LoreTag.FILE_STAGE_END, (raw): LoreStageEndPayload => {
        const count = nested(raw, "count");
        return {
            totalCount: decodeCount(count.totalCount),
            fileAddCount: decodeCount(count.fileAddCount),
            fileModifyCount: decodeCount(count.fileModifyCount),
            fileDeleteCount: decodeCount(count.fileDeleteCount),
            fileMoveCount: decodeCount(count.fileMoveCount),
        };
    });

    table.set(LoreTag.REVISION_COMMIT_REVISION, (raw): LoreCommitRevisionPayload => {
        const parents: LoreHex[] = [];
        const first = decodeOptionalHash(nested(raw, "parent"));
        const second = decodeOptionalHash(nested(raw, "parentOther"));
        if (first) parents.push(first);
        if (second) parents.push(second);
        return {
            repository: decodeHash(nested(raw, "repository")),
            branch: decodeHash(nested(raw, "branch")),
            revision: decodeHash(nested(raw, "revision")),
            revisionNumber: decodeCount(raw.revisionNumber),
            parents,
        };
    });

    table.set(LoreTag.REVISION_HISTORY, (raw): LoreHistoryPayload => ({
        repository: decodeHash(nested(raw, "repository")),
        branch: decodeHash(nested(raw, "branch")),
    }));

    table.set(LoreTag.REVISION_HISTORY_ENTRY, (raw): LoreHistoryEntryPayload => ({
        revision: decodeHash(nested(raw, "revision")),
        revisionNumber: decodeCount(raw.revisionNumber),
        parents: decodeParents(raw, "parent"),
    }));

    table.set(LoreTag.REVISION_INFO, (raw): LoreRevisionInfoPayload => ({
        repository: decodeHash(nested(raw, "repository")),
        revision: decodeHash(nested(raw, "revision")),
        revisionNumber: decodeCount(raw.revisionNumber),
        parents: decodeParents(raw, "parent"),
    }));

    table.set(LoreTag.REVISION_DIFF_FILE, (raw): LoreDiffFilePayload => ({
        path: decodeString(nested(raw, "path")),
        action: decodeCount(raw.action),
        oldIsFile: bool(raw.oldIsFile),
        newIsFile: bool(raw.newIsFile),
    }));

    table.set(LoreTag.REVISION_RESTORE_REVISION, (raw): LoreRestoreRevisionPayload => ({
        revision: decodeHash(nested(raw, "revision")),
        revisionNumber: decodeCount(raw.revisionNumber),
    }));

    table.set(LoreTag.REVISION_RESTORE_FILE, (raw): LoreRestoreFilePayload => ({
        path: decodeString(nested(raw, "path")),
        action: decodeCount(raw.action),
        size: decodeCount(raw.size),
        isFile: bool(raw.isFile),
        isDirectory: bool(raw.isDirectory),
    }));

    table.set(LoreTag.STORAGE_OPENED, (raw): LoreStorageOpenedPayload => ({
        handleId: decodeCount(raw.handleId),
    }));

    table.set(LoreTag.STORAGE_GET_HEADER, (raw): LoreStorageHeaderPayload => {
        const address = nested(raw, "address");
        return {
            id: decodeCount(raw.id),
            hash: decodeHash(nested(address, "hash")),
            context: decodeHash(nested(address, "context")),
            sizeContent: decodeCount(raw.sizeContent),
        };
    });

    // The payload field is `bytes`, not `data`. Getting this wrong reads an empty
    // blob and reports success.
    table.set(LoreTag.STORAGE_GET_DATA, (raw): LoreStorageDataPayload => ({
        id: decodeCount(raw.id),
        offset: decodeCount(raw.offset),
        bytes: decodeBytes(nested(raw, "bytes")),
    }));

    table.set(LoreTag.STORAGE_GET_ITEM_COMPLETE, (raw): LoreStorageItemCompletePayload => ({
        id: decodeCount(raw.id),
        errorCode: decodeCount(raw.errorCode),
    }));

    table.set(LoreTag.REVISION_TREE_LOADED, (raw): LoreTreeLoadedPayload => ({
        handleId: decodeCount(raw.handleId),
    }));

    table.set(LoreTag.REVISION_TREE_RESOLVE_PATH_COMPLETE, (raw): LoreTreeResolvePayload => ({
        id: decodeCount(raw.id),
        nodeId: decodeCount(raw.nodeId),
        repository: decodeHash(nested(raw, "repository")),
        revision: decodeHash(nested(raw, "revision")),
        errorCode: decodeCount(raw.errorCode),
    }));

    table.set(LoreTag.REVISION_TREE_CHILD, (raw): LoreTreeChildPayload => {
        const address = nested(raw, "address");
        return {
            id: decodeCount(raw.id),
            nodeId: decodeCount(raw.nodeId),
            name: decodeString(nested(raw, "name")),
            parentId: decodeCount(raw.parentId),
            kind: decodeCount(raw.kind),
            mode: decodeCount(raw.mode),
            size: decodeCount(raw.size),
            hash: decodeHash(nested(address, "hash")),
            context: decodeHash(nested(address, "context")),
            errorCode: decodeCount(raw.errorCode),
        };
    });

    table.set(LoreTag.REVISION_TREE_NODE_INFO, (raw): LoreTreeNodeInfoPayload => {
        const address = nested(raw, "address");
        return {
            id: decodeCount(raw.id),
            nodeId: decodeCount(raw.nodeId),
            name: decodeString(nested(raw, "name")),
            parentId: decodeCount(raw.parentId),
            kind: decodeCount(raw.kind),
            mode: decodeCount(raw.mode),
            size: decodeCount(raw.size),
            hash: decodeHash(nested(address, "hash")),
            context: decodeHash(nested(address, "context")),
            errorCode: decodeCount(raw.errorCode),
        };
    });

    table.set(LoreTag.REVISION_TREE_CLOSE_COMPLETE, (raw): LoreTreeCloseCompletePayload => ({
        id: decodeCount(raw.id),
        errorCode: decodeCount(raw.errorCode),
    }));

    table.set(LoreTag.BRANCH_LIST_ENTRY, (raw): LoreBranchEntryPayload => ({
        id: decodeHash(nested(raw, "id")),
        name: decodeString(nested(raw, "name")),
        category: decodeString(nested(raw, "category")),
        latest: decodeOptionalHash(nested(raw, "latest")),
        creator: decodeString(nested(raw, "creator")),
        created: decodeCount(raw.created),
        isCurrent: bool(raw.isCurrent),
        archived: bool(raw.archived),
        location: decodeCount(raw.location),
    }));

    table.set(LoreTag.BRANCH_INFO, (raw): LoreBranchInfoPayload => ({
        id: decodeHash(nested(raw, "id")),
        name: decodeString(nested(raw, "name")),
        category: decodeString(nested(raw, "category")),
        latest: decodeOptionalHash(nested(raw, "latest")),
        latestRemote: decodeOptionalHash(nested(raw, "latestRemote")),
        parent: decodeOptionalHash(nested(raw, "parent")),
        branchPoint: decodeOptionalHash(nested(raw, "branchPoint")),
        creator: decodeString(nested(raw, "creator")),
        created: decodeCount(raw.created),
        archived: bool(raw.archived),
    }));

    table.set(LoreTag.BRANCH_CREATE, (raw): LoreBranchCreatePayload => ({
        name: decodeString(nested(raw, "name")),
        latest: decodeOptionalHash(nested(raw, "latest")),
        isCommit: bool(raw.isCommit),
    }));

    // -- remote ---------------------------------------------------------------

    table.set(LoreTag.REPOSITORY_CONFIG_GET, (raw): LoreConfigPayload => ({
        key: decodeString(nested(raw, "key")),
        value: decodeString(nested(raw, "value")),
    }));

    const cloneCount = (raw: Record<string, unknown>): LoreCloneCountPayload => ({
        fileComplete: decodeCount(raw.fileComplete),
        fileCount: decodeCount(raw.fileCount),
        bytesTransferred: decodeCount(raw.bytesTransferred),
        bytesTotal: decodeCount(raw.bytesTotal),
        discoveryComplete: bool(raw.discoveryComplete),
    });

    table.set(LoreTag.REPOSITORY_CLONE_BEGIN, (raw): LoreCloneBeginPayload => ({
        repository: decodeHash(nested(raw, "repository")),
        branch: decodeString(nested(raw, "branch")),
        revision: decodeOptionalHash(nested(raw, "revision")),
        path: decodeString(nested(raw, "path")),
    }));

    table.set(LoreTag.REPOSITORY_CLONE_PROGRESS, (raw): LoreCloneProgressPayload => ({
        count: cloneCount(nested(raw, "count")),
    }));

    table.set(LoreTag.REPOSITORY_CLONE_END, (raw): LoreCloneEndPayload => ({
        branch: decodeString(nested(raw, "branch")),
        revision: decodeOptionalHash(nested(raw, "revision")),
        count: cloneCount(nested(raw, "count")),
    }));

    table.set(LoreTag.REVISION_SYNC_TARGET, (raw): LoreSyncTargetPayload => ({
        remote: decodeString(nested(raw, "remote")),
        branchName: decodeString(nested(raw, "branchName")),
        sourceRevision: decodeOptionalHash(nested(raw, "sourceRevision")),
        sourceRevisionNumber: decodeCount(raw.sourceRevisionNumber),
        targetRevision: decodeOptionalHash(nested(raw, "targetRevision")),
        targetRevisionNumber: decodeCount(raw.targetRevisionNumber),
        isLatest: bool(raw.isLatest),
        local: bool(raw.local),
    }));

    // Shared with the merge-start end event, which embeds this struct by value rather
    // than reporting its own counters.
    const syncProgress = (raw: Record<string, unknown>): LoreSyncProgressPayload => ({
        fileUpdate: decodeCount(raw.fileUpdate),
        fileUpdateTotal: decodeCount(raw.fileUpdateTotal),
        fileDelete: decodeCount(raw.fileDelete),
        fileDeleteTotal: decodeCount(raw.fileDeleteTotal),
        fileAutomerge: decodeCount(raw.fileAutomerge),
        fileConflict: decodeCount(raw.fileConflict),
        bytesUpdate: decodeCount(raw.bytesUpdate),
        bytesUpdateTotal: decodeCount(raw.bytesUpdateTotal),
        discoveryComplete: bool(raw.discoveryComplete),
    });

    table.set(LoreTag.REVISION_SYNC_PROGRESS, (raw): LoreSyncProgressPayload => syncProgress(raw));

    table.set(LoreTag.REVISION_SYNC_FILE, (raw): LoreStatusFilePayload => ({
        path: decodeString(nested(raw, "path")),
        size: decodeCount(raw.size),
        action: decodeCount(raw.action),
        // The sync event has no node-type field, only a "this is a file" flag, so the
        // type is reconstructed rather than read: DIRECTORY is 0 and FILE is 1.
        type: bool(raw.flagFile) ? 1 : 0,
        staged: false,
        merged: false,
        conflict: false,
        conflictUnresolved: false,
        conflictAutomerged: false,
        conflictMine: false,
        conflictTheirs: false,
        dirty: false,
        fromPath: "",
    }));

    table.set(LoreTag.REVISION_SYNC_REVISION, (raw): LoreSyncRevisionPayload => ({
        revision: decodeHash(nested(raw, "revision")),
        revisionNumber: decodeCount(raw.revisionNumber),
        merge: bool(raw.flagMerge),
        conflict: bool(raw.flagConflict),
    }));

    table.set(LoreTag.BRANCH_PUSH, (raw): LoreBranchPushPayload => ({
        remote: decodeString(nested(raw, "remote")),
        branchName: decodeString(nested(raw, "branchName")),
        remoteRevision: decodeOptionalHash(nested(raw, "remoteRevision")),
        localRevision: decodeOptionalHash(nested(raw, "localRevision")),
        remoteHistory: decodeCount(raw.remoteHistory),
        localHistory: decodeCount(raw.localHistory),
        alreadyPushed: bool(raw.flagAlreadyPushed),
    }));

    // -- merge ----------------------------------------------------------------

    table.set(LoreTag.BRANCH_MERGE_START_BEGIN, (raw): LoreMergeStartBeginPayload => ({
        branch: decodeHash(nested(raw, "branch")),
        revision: decodeOptionalHash(nested(raw, "revision")),
        revisionNumber: decodeCount(raw.revisionNumber),
    }));

    table.set(LoreTag.BRANCH_MERGE_START_END, (raw): LoreMergeStartEndPayload => ({
        stats: syncProgress(nested(raw, "stats")),
        signature: decodeOptionalHash(nested(raw, "signature")),
        hasConflicts: bool(raw.hasConflicts),
    }));

    table.set(LoreTag.BRANCH_MERGE_CONFLICT_FILE, (raw): LoreMergeConflictFilePayload => ({
        path: decodeString(nested(raw, "path")),
    }));

    table.set(LoreTag.BRANCH_MERGE_RESOLVE_FILE, (raw): LoreMergeResolveFilePayload => ({
        path: decodeString(nested(raw, "path")),
    }));

    table.set(LoreTag.BRANCH_MERGE_RESOLVE_REVISION, (raw): LoreMergeResolveRevisionPayload => ({
        repository: decodeHash(nested(raw, "repository")),
        revision: decodeOptionalHash(nested(raw, "revision")),
    }));

    table.set(LoreTag.BRANCH_MERGE_ABORT_BEGIN, (raw): LoreMergeAbortBeginPayload => ({
        stateStagedRevision: decodeOptionalHash(nested(raw, "stateStagedRevision")),
        stateCurrentRevision: decodeOptionalHash(nested(raw, "stateCurrentRevision")),
    }));

    table.set(LoreTag.BRANCH_MERGE_ABORT_END, (raw): LoreMergeAbortEndPayload => ({
        unused: decodeCount(raw.unused),
    }));

    table.set(LoreTag.BRANCH_MERGE_UNRESOLVE_FILE, (raw): LoreMergeUnresolveFilePayload => ({
        path: decodeString(nested(raw, "path")),
    }));

    table.set(LoreTag.AUTH_IDENTITY, (raw): LoreAuthIdentityPayload => ({
        authUrl: decodeString(nested(raw, "authUrl")),
        resource: decodeString(nested(raw, "resource")),
        userId: decodeString(nested(raw, "userId")),
        expires: decodeCount(raw.expires),
        // The token itself is deliberately NOT decoded. It is a credential, it is
        // already in the caller's hand (it is what was just sent), and everything this
        // binding decodes ends up in logs and IPC payloads sooner or later.
    }));

    tables.set(library, table);
    return table;
}

/** Which struct decodes which tag. Kept next to the table it feeds. */
const PAYLOAD_STRUCTS: Readonly<Record<number, string>> = {
    [LoreTag.METADATA]: "LoreMetadataEventData",
    [LoreTag.ERROR]: "LoreErrorEventData",
    [LoreTag.COMPLETE]: "LoreCompleteEventData",
    [LoreTag.LOG]: "LoreLogEventData",
    [LoreTag.PATH_IGNORE]: "LorePathIgnoreEventData",
    [LoreTag.FILTER_EXCLUDE]: "LoreFilterExcludeEventData",
    [LoreTag.REPOSITORY_CREATE]: "LoreRepositoryCreateEventData",
    [LoreTag.REPOSITORY_STATUS_REVISION]: "LoreRepositoryStatusRevisionEventData",
    [LoreTag.REPOSITORY_STATUS_FILE]: "LoreRepositoryStatusFileEventData",
    [LoreTag.REPOSITORY_STATUS_SUMMARY]: "LoreRepositoryStatusSummaryEventData",
    [LoreTag.REPOSITORY_STATUS_COUNT]: "LoreRepositoryStatusCountEventData",
    [LoreTag.FILE_STAGE_FILE]: "LoreFileStageFileEventData",
    [LoreTag.FILE_STAGE_END]: "LoreFileStageEndEventData",
    [LoreTag.FILE_STAGE_REVISION]: "LoreFileStageRevisionEventData",
    [LoreTag.REVISION_COMMIT_REVISION]: "LoreRevisionCommitRevisionEventData",
    [LoreTag.REVISION_HISTORY]: "LoreRevisionHistoryEventData",
    [LoreTag.REVISION_HISTORY_ENTRY]: "LoreRevisionHistoryEntryEventData",
    [LoreTag.REVISION_INFO]: "LoreRevisionInfoEventData",
    [LoreTag.REVISION_DIFF_FILE]: "LoreRevisionDiffFileEventData",
    [LoreTag.REVISION_RESTORE_REVISION]: "LoreRevisionRestoreRevisionEventData",
    [LoreTag.REVISION_RESTORE_FILE]: "LoreRevisionRestoreFileEventData",
    [LoreTag.STORAGE_OPENED]: "LoreStorageOpenedEventData",
    [LoreTag.STORAGE_GET_HEADER]: "LoreStorageGetHeaderEventData",
    [LoreTag.STORAGE_GET_DATA]: "LoreStorageGetDataEventData",
    [LoreTag.STORAGE_GET_ITEM_COMPLETE]: "LoreStorageGetItemCompleteEventData",
    [LoreTag.REVISION_TREE_LOADED]: "LoreRevisionTreeLoadedEventData",
    [LoreTag.REVISION_TREE_RESOLVE_PATH_COMPLETE]: "LoreRevisionTreeResolvePathCompleteEventData",
    [LoreTag.REVISION_TREE_CHILD]: "LoreRevisionTreeChildEventData",
    [LoreTag.REVISION_TREE_NODE_INFO]: "LoreRevisionTreeNodeInfoEventData",
    [LoreTag.REVISION_TREE_CLOSE_COMPLETE]: "LoreRevisionTreeCloseCompleteEventData",
    [LoreTag.BRANCH_LIST_ENTRY]: "LoreBranchListEntryEventData",
    [LoreTag.BRANCH_INFO]: "LoreBranchInfoEventData",
    [LoreTag.BRANCH_CREATE]: "LoreBranchCreateEventData",
    [LoreTag.REPOSITORY_CLONE_BEGIN]: "LoreRepositoryCloneBeginEventData",
    [LoreTag.REPOSITORY_CLONE_PROGRESS]: "LoreRepositoryCloneProgressEventData",
    [LoreTag.REPOSITORY_CLONE_END]: "LoreRepositoryCloneEndEventData",
    [LoreTag.REPOSITORY_CONFIG_GET]: "LoreRepositoryConfigGetEventData",
    [LoreTag.REVISION_SYNC_TARGET]: "LoreRevisionSyncTargetEventData",
    [LoreTag.REVISION_SYNC_FILE]: "LoreRevisionSyncFileEventData",
    [LoreTag.REVISION_SYNC_PROGRESS]: "LoreRevisionSyncProgressEventData",
    [LoreTag.REVISION_SYNC_REVISION]: "LoreRevisionSyncRevisionEventData",
    [LoreTag.BRANCH_PUSH]: "LoreBranchPushEventData",
    [LoreTag.AUTH_IDENTITY]: "LoreAuthIdentityEventData",
    [LoreTag.BRANCH_MERGE_START_BEGIN]: "LoreBranchMergeStartBeginEventData",
    [LoreTag.BRANCH_MERGE_START_END]: "LoreBranchMergeStartEndEventData",
    [LoreTag.BRANCH_MERGE_CONFLICT_FILE]: "LoreBranchMergeConflictFileEventData",
    [LoreTag.BRANCH_MERGE_RESOLVE_FILE]: "LoreBranchMergeResolveFileEventData",
    [LoreTag.BRANCH_MERGE_RESOLVE_REVISION]: "LoreBranchMergeResolveRevisionEventData",
    [LoreTag.BRANCH_MERGE_ABORT_BEGIN]: "LoreBranchMergeAbortBeginEventData",
    [LoreTag.BRANCH_MERGE_ABORT_END]: "LoreBranchMergeAbortEndEventData",
    [LoreTag.BRANCH_MERGE_UNRESOLVE_FILE]: "LoreBranchMergeUnresolveFileEventData",
};

/**
 * Read one event off the FFI pointer, copying everything it needs.
 *
 * MUST be called inside the native callback: after it returns, the pointer is
 * dangling. Everything this produces is already copied, so the result is safe to
 * keep, queue, and inspect later - which is exactly what {@link invoke} does,
 * because re-entering Lore from inside a callback is forbidden process-wide.
 */
export function decodeEvent(library: LoreLibrary, pointer: unknown): LoreEvent {
    const tag = Number(koffi.decode(pointer, 0, "uint32_t"));
    const structName = PAYLOAD_STRUCTS[tag];
    const decoder = decoderTable(library).get(tag);
    // Both or neither: a struct with no decoder would be decoded and discarded, and
    // a decoder with no struct has nothing to read.
    if (!structName || !decoder) return { tag };

    const raw = koffi.decode(pointer, LORE_EVENT_PAYLOAD_OFFSET, library.type(structName)) as Record<string, unknown>;
    return { tag, data: decoder(raw, pointer) };
}
