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
    dirty: boolean;
    fromPath: string;
}

export interface LoreStatusSummaryPayload { adds: number; deletes: number; modifies: number; moves: number; copies: number }
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

/**
 * One metadata entry, as reported by the metadata read verbs.
 *
 * `text` is present only for a STRING value. Everything else is reported with its
 * `tag` and no value rather than coerced: the payload is a union, and reading a
 * NUMERIC's first eight bytes as a `LoreString` pointer would dereference the number.
 * Studio writes only strings, so a foreign tag means another client wrote the key.
 */
export interface LoreMetadataPayload { key: string; tag: number; text?: string }

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
     *  - Only a STRING is read. The other six tags are reported with no value, because
     *    a NUMERIC's eight bytes read as a `LoreString` would be dereferenced as a
     *    pointer, which is a crash rather than a wrong answer.
     *
     * The generated SDK arrives at the same offset the same way (`offsetof(data)` plus
     * `sizeof(uint32_t)`), which is the only machine-readable evidence for the padding.
     */
    const metadataValueOffset = LORE_EVENT_PAYLOAD_OFFSET
        + koffi.offsetof(type("LoreMetadataEventData"), "value")
        + koffi.offsetof(type("LoreMetadata"), "data")
        + koffi.sizeof("uint32_t");

    table.set(LoreTag.METADATA, (raw, pointer): LoreMetadataPayload => {
        const value = nested(raw, "value");
        const tag = decodeCount(value.tag);
        if (tag !== LORE_METADATA_TAGS.STRING) {
            return { key: decodeString(nested(raw, "key")), tag };
        }
        const text = koffi.decode(pointer, metadataValueOffset, type("LoreString")) as Record<string, unknown>;
        return {
            key: decodeString(nested(raw, "key")),
            tag,
            text: decodeString(text),
        };
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
