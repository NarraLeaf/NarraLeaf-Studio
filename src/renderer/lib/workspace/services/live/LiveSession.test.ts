import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    assetGroupsSpec,
    assetSetsSpec,
    assetsMetadataSpec,
    audioTracksSpec,
    charactersSpec,
    dictionarySpec,
    localizationDocumentSpec,
    localizationKeysSpec,
    storyDocumentSpec,
    variableRegistrySpec,
    voiceDocumentSpec,
} from "@shared/documents/specs";
import type { StoryId, StoryNoteBlock, StorySceneId } from "@shared/types/story";
import type { LiveCastView } from "@shared/live/cast";
import { liveSessionWritablePaths } from "@shared/live/sharedDocuments";
import {
    characterClaimKey,
    localizationKeyClaimKey,
    storyRowClaimKey,
    assetClaimKey,
    translationClaimKey,
    variableClaimKey,
    type LiveCharacterOp,
    type LiveDerived,
    type LiveEffect,
    type LiveLocalizationKeyOp,
    type LiveLocalizationOp,
    type LiveAssetFolderOp,
    type LiveAssetOp,
    type LiveAudioTrackOp,
    type LiveVariableOp,
    type LiveVoiceOp,
} from "@shared/live/ops";
import type { CharacterGroup, StoredCharacter } from "@shared/types/character/model";
import type { LocalizationKeyDefinition, LocalizationUnit } from "@shared/types/localization";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import type { VoiceUnit } from "@shared/types/voice";
import type { TeamLiveEvent, TeamLiveSession } from "@shared/types/team";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import { DEFAULT_CLAIM_TIMEOUT_MS } from "@/lib/live";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import { HistoryService } from "../history/HistoryService";
import { storySceneHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import type { CharacterOpSink } from "../core/CharacterService";
import { StoryService } from "../story/StoryService";
import { LiveSession } from "./LiveSession";
import type { LiveRooms, LiveSessionDeps } from "./liveSessionPorts";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * A session against real story documents and a room made of function calls.
 *
 * Two windows, each with its own `StoryService`, and one bus between them: every message a window
 * says reaches every window in the room, its own included, which is what a Team room does and what
 * both halves of the pure layer expect. The bus copies each message on the way out, so nothing here
 * can pass because two windows happened to be holding the same object.
 *
 * Everything else - version control, the freeze, the undo stacks - is a port with a recorder behind
 * it, so the sequences these tests are about (checkpoint before open, freeze armed on entry and
 * lifted on every exit) are read off a list rather than inferred from a side effect.
 */

const PROJECT = "repo-1";
const PROJECT_PATH = "/projects/tale";
const REMOTE = "lore://server";

/* --------------------------------------------------------------------------- the room */

type Bus = {
    /** Everything any window put on the wire, in order, so traffic can be counted rather than guessed. */
    said: unknown[];
    say(sessionId: string, payload: unknown, from: string): void;
    listen(sessionId: string, handler: (payload: unknown, from: string) => void): () => void;
    watch(project: string, handler: (event: TeamLiveEvent) => void): () => void;
    announce(project: string, event: TeamLiveEvent): void;
    /** Deliver everything that has been said, and everything saying it causes. */
    flush(): void;
};

function createBus(): Bus {
    const rooms = new Map<string, Set<(payload: unknown, from: string) => void>>();
    const watchers = new Map<string, Set<(event: TeamLiveEvent) => void>>();
    /**
     * Nothing is delivered inside the call that said it.
     *
     * A room is a relay, so an intent is never answered on the sender's own stack - and a test that
     * let it be would be exercising a re-entrant editing gesture that cannot happen, while missing
     * the one property this whole design rests on: the document does not move when a gesture is
     * made, it moves when the effect answering it arrives.
     */
    const queue: (() => void)[] = [];
    const said: unknown[] = [];
    return {
        said,
        say(sessionId, payload, from) {
            said.push(payload);
            for (const handler of [...(rooms.get(sessionId) ?? [])]) {
                // A copy per listener: what travels is the payload of a `live.say`, and a window
                // never holds the object another window sent.
                const copy = structuredClone(payload);
                queue.push(() => handler(copy, from));
            }
        },
        flush() {
            let guard = 0;
            while (queue.length > 0 && (guard += 1) < 1000) {
                (queue.shift() as () => void)();
            }
        },
        listen(sessionId, handler) {
            const set = rooms.get(sessionId) ?? new Set();
            set.add(handler);
            rooms.set(sessionId, set);
            return () => set.delete(handler);
        },
        watch(project, handler) {
            const set = watchers.get(project) ?? new Set();
            set.add(handler);
            watchers.set(project, set);
            return () => set.delete(handler);
        },
        announce(project, event) {
            for (const handler of [...(watchers.get(project) ?? [])]) {
                handler(event);
            }
        },
    };
}

type World = {
    bus: Bus;
    rooms: Map<string, TeamLiveSession>;
};

function createRooms(world: World, self: string, calls: string[]): LiveRooms {
    return {
        list: async project => ({
            ok: true,
            value: [...world.rooms.values()].filter(room => room.project === project),
        }),
        open: async input => {
            calls.push(`open:${input.revision}`);
            const room: TeamLiveSession = {
                id: "room-1",
                project: input.project,
                revision: input.revision,
                // Carried exactly as the server carries it, because it is what a joiner follows.
                story: input.story,
                openedBy: self,
                openedByInstance: self,
                openedAt: 0,
                members: [{ instance: self, account: self, label: self, joinedAt: 0 }],
                ...(input.title === undefined ? {} : { title: input.title }),
            };
            world.rooms.set(room.id, room);
            return { ok: true, value: room };
        },
        join: async sessionId => {
            calls.push("join");
            const room = world.rooms.get(sessionId);
            if (!room) {
                return { ok: false, problem: { kind: "refused", code: "not-found", detail: "no such room" } };
            }
            const joined: TeamLiveSession = {
                ...room,
                members: [...room.members, { instance: self, account: self, label: self, joinedAt: 1 }],
            };
            world.rooms.set(room.id, joined);
            // The roster reaches the windows already in the room, which is what a server does and
            // what the host needs: a claim is recorded against the ACCOUNT behind an instance, and
            // the roster is the only thing that knows which account a window signed in as.
            world.bus.announce(PROJECT, { kind: "live-changed", session: joined });
            return { ok: true, value: joined };
        },
        leave: async sessionId => {
            calls.push("leave");
            const room = world.rooms.get(sessionId);
            if (room) {
                const remaining: TeamLiveSession = {
                    ...room,
                    members: room.members.filter(member => member.instance !== self),
                };
                world.rooms.set(sessionId, remaining);
                world.bus.announce(PROJECT, { kind: "live-changed", session: remaining });
            }
            return { ok: true, value: {} };
        },
        close: async sessionId => {
            calls.push("close");
            world.rooms.delete(sessionId);
            world.bus.announce(PROJECT, { kind: "live-closed", session: sessionId });
            return { ok: true, value: {} };
        },
        say: (sessionId, payload) => world.bus.say(sessionId, payload, self),
        listen: (sessionId, onMessage) => world.bus.listen(sessionId, onMessage),
        watch: (project, onEvent) => world.bus.watch(project, onEvent),
    };
}

/* ------------------------------------------------------------------ a story to edit */

function note(id: string, value: string = id): StoryNoteBlock {
    return {
        id,
        kind: "note",
        parentId: null,
        childrenIds: [],
        payload: { text: { textId: `text-${id}`, value, role: "note" } },
    };
}

/** A story service holding one story, three rows, exactly as another window's would. */
function createStoryService(): { service: StoryService; history: HistoryService } {
    const history = new HistoryService();
    const service = new StoryService();
    const files = new Map<string, string>();
    let nextId = 0;
    const uuid = () => `00000000-0000-4000-8000-${(++nextId).toString(16).padStart(12, "0")}`;
    const fs = {
        writeFileNoFollowOrCreate: vi.fn(async (path: string, data: string) => {
            files.set(path, data);
            return { ok: true as const, data: undefined };
        }),
        read: vi.fn(async (path: string) => {
            const data = files.get(path);
            return data === undefined
                ? { ok: false as const, error: { message: "missing", code: "ENOENT" } }
                : { ok: true as const, data };
        }),
        deleteFile: vi.fn(async () => ({ ok: true as const, data: undefined })),
        deleteDir: vi.fn(async () => ({ ok: true as const, data: undefined })),
        isFileExists: vi.fn(async (path: string) => ({ ok: true as const, data: files.has(path) })),
        isDirExists: vi.fn(async () => ({ ok: true as const, data: true })),
        createDir: vi.fn(async () => ({ ok: true as const, data: undefined })),
        mkdir: vi.fn(async () => ({ ok: true as const, data: undefined })),
    };
    const context = {
        project: {
            resolve: (...parts: (string | string[])[]) =>
                parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/").replace(/\/+/g, "/"),
        },
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.History: return history;
                    case Services.FileSystem: return fs;
                    case Services.Uuid: return { generate: uuid };
                    case Services.Assets: return { lockAsset: vi.fn(), unlockAsset: vi.fn() };
                    case Services.Project: return {};
                    default: throw new Error(`Unexpected service ${id}`);
                }
            },
        } as never,
    } as never;
    history.setContext(context);
    service.setContext(context);
    (service as never as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
    (service as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };
    return { service, history };
}

function seed(service: StoryService): { storyId: StoryId; sceneId: StorySceneId } {
    const entry = service.createStory("Tale");
    const document = service.getStoryDocument(entry.id);
    const sceneId = document.chapters[0].sceneIds[0];
    for (const id of ["a", "b", "c"]) {
        service.insertBlock(entry.id, sceneId, note(id), { parentId: null });
    }
    return { storyId: entry.id, sceneId };
}

/**
 * The languages every window in these tests holds libraries for.
 *
 * One is enough to state the rule, and stating it needs one: a session carries the languages a
 * machine actually READ, so the freeze's writable set and the host's own table have to be built from
 * the same answer rather than from the project's configuration.
 */
const CARRIED_LOCALES = { translations: ["ja"], voice: ["ja"] } as const;
/** The asset shards every window in these tests holds. */
const CARRIED_ASSET_TYPES = ["image"];
/** The sections every window in these tests holds folders for. */
const CARRIED_ASSET_CATEGORIES = ["image"];

/** Both project-level registries, which every window in these tests could read. */
const CARRIED_REGISTRIES = { variables: true, localizationKeys: true };

/* -------------------------------------------------------------------------- a window */

type Window = {
    session: LiveSession;
    story: StoryService;
    history: HistoryService;
    storyId: StoryId;
    sceneId: StorySceneId;
    /** Everything this window asked of version control and of the room, in order. */
    calls: string[];
    version: {
        head: string;
        uncommitted: boolean;
        conflicts: string[];
        /** What a sync brings the tree to. */
        syncTo: string | null;
    };
    freeze: {
        reason: WorkspaceFreezeReason | null;
        armed: { session: string; writable: readonly string[] } | null;
    };
    forgotten: string[];
    instance: string | null;
    hasRepository: boolean;
    /** The cast this window holds, and where its edits go while a session is running. */
    cast: LiveCastView & { characters: Record<string, StoredCharacter>; order: string[]; groups: Record<string, CharacterGroup> };
    castSink: CharacterOpSink | null;
    /** The translation libraries this window holds, by language, and where its edits go. */
    translations: Record<string, Record<string, LocalizationUnit>>;
    translationSink: { handle(op: LiveLocalizationOp | LiveLocalizationKeyOp): boolean } | null;
    /** The named strings this window holds, and whether it holds the registry at all. */
    keys: Record<string, LocalizationKeyDefinition> | null;
    /** Whether this window holds a variable registry it could read. */
    variablesReadable: boolean;
    /** The variable registry entries this window holds, and where its edits go. */
    variables: Record<string, VariableRegistryEntry>;
    variableSink: { handle(op: LiveVariableOp): boolean } | null;
    /** The voice libraries this window holds, by language, and where its edits go. */
    takes: Record<string, Record<string, VoiceUnit>>;
    takeSink: { handle(op: LiveVoiceOp): boolean } | null;
    /** The asset metadata shards this window holds, by type, and where its record edits go. */
    assets: Record<string, Record<string, Record<string, unknown>>>;
    assetSink: { handle(op: LiveAssetOp | LiveAssetFolderOp): boolean } | null;
    /** The mixer this window holds, and where its edits go while a session is running. */
    tracks: ProjectAudioTrack[];
    trackSink: { handle(op: LiveAudioTrackOp): boolean } | null;
    /** This window's reading of the time, in milliseconds. Moved by hand. See {@link fireTimers}. */
    clock: number;
    /** Everything this window has asked to have run later, in the order it asked. */
    timers: { delayMs: number; run: () => void; cancelled: boolean }[];
};

/** The mixer applier a window uses when an effect arrives. As small as the service's own. */
function applyTrackOp(window: Window, op: LiveAudioTrackOp): void {
    switch (op.op) {
        case "create-audio-track": {
            const reparent = new Set(op.reparent ?? []);
            const rest = window.tracks
                .filter(track => track.id !== op.track.id)
                .map(track => (reparent.has(track.id) ? { ...track, parentId: op.track.id } : track));
            const index = op.beforeId === null ? -1 : rest.findIndex(track => track.id === op.beforeId);
            if (index < 0) {
                rest.push({ ...op.track });
            } else {
                rest.splice(index, 0, { ...op.track });
            }
            window.tracks = rest;
            return;
        }
        case "update-audio-track":
            window.tracks = window.tracks.map(track => (
                track.id === op.trackId ? { ...op.track, id: op.trackId } : track
            ));
            return;
        case "delete-audio-track": {
            const doomed = window.tracks.find(track => track.id === op.trackId);
            if (!doomed) {
                return;
            }
            window.tracks = window.tracks
                .filter(track => track.id !== op.trackId)
                .map(track => (track.parentId === op.trackId ? { ...track, parentId: doomed.parentId } : track));
            return;
        }
        case "move-audio-track": {
            const moving = window.tracks.find(track => track.id === op.trackId);
            if (!moving) {
                return;
            }
            const rest = window.tracks.filter(track => track.id !== op.trackId);
            const index = op.beforeId === null ? -1 : rest.findIndex(track => track.id === op.beforeId);
            if (index < 0) {
                rest.push(moving);
            } else {
                rest.splice(index, 0, moving);
            }
            window.tracks = rest;
            return;
        }
    }
}

/** The cast applier a window uses when an effect arrives. As small as the store's own. */
function applyCastOp(cast: Window["cast"], op: LiveCharacterOp): void {
    switch (op.op) {
        case "create-character":
            cast.characters[op.character.profile.id] = structuredClone(op.character);
            if (!cast.order.includes(op.character.profile.id)) {
                cast.order.push(op.character.profile.id);
            }
            return;
        case "update-character":
            cast.characters[op.characterId] = structuredClone(op.character);
            return;
        case "delete-character":
            delete cast.characters[op.characterId];
            cast.order = cast.order.filter(id => id !== op.characterId);
            return;
        case "set-character-group":
            cast.groups[op.groupId] = { ...op.group };
            for (const memberId of op.members ?? []) {
                const member = cast.characters[memberId];
                if (member) {
                    member.profile.groupId = op.groupId;
                }
            }
            return;
        case "delete-character-group":
            delete cast.groups[op.groupId];
            for (const member of Object.values<StoredCharacter>(cast.characters)) {
                if (member.profile.groupId === op.groupId) {
                    delete member.profile.groupId;
                }
            }
            return;
    }
}

/** The translation applier a window uses when an effect arrives. As small as the library's own. */
function applyTranslationOp(libraries: Window["translations"], op: LiveLocalizationOp): void {
    const units = libraries[op.locale];
    if (!units) {
        return;
    }
    const entries = op.op === "set-translation" ? [{ unitId: op.unitId, unit: op.unit }] : op.units;
    for (const entry of entries) {
        if (entry.unit === null) {
            delete units[entry.unitId];
        } else {
            units[entry.unitId] = { ...entry.unit };
        }
    }
}

/** The named-key applier a window uses when an effect arrives. As small as the registry's own. */
function applyKeyOp(keys: Window["keys"], op: LiveLocalizationKeyOp): void {
    if (!keys) {
        return;
    }
    if (op.op === "remove-key") {
        delete keys[op.name];
        return;
    }
    keys[op.name] = { ...op.definition };
}

/** The variable registry applier. One entry in, one entry out. */
function applyVariableOp(entries: Window["variables"], op: LiveVariableOp): void {
    if (op.op === "delete-variable") {
        delete entries[op.variableId];
        return;
    }
    const entry = op.op === "create-variable" ? op.entry : op.entry;
    entries[entry.id] = structuredClone(entry);
}

/** The voice applier, the translations' mirror. */
function applyTakeOp(libraries: Window["takes"], op: LiveVoiceOp): void {
    const units = libraries[op.locale];
    if (!units) {
        return;
    }
    const entries = op.op === "set-take" ? [{ unitId: op.unitId, unit: op.unit }] : op.units;
    for (const entry of entries) {
        if (entry.unit === null) {
            delete units[entry.unitId];
        } else {
            units[entry.unitId] = { ...entry.unit };
        }
    }
}

function applyAssetOp(shards: Window["assets"], op: LiveAssetOp | LiveAssetFolderOp): void {
    if (op.op === "set-asset-folder" || op.op === "delete-asset-folder" || op.op === "restore-asset-folder") {
        // The folder shard is not what this window models; the asset half is what these tests are
        // about, and a folder operation reaching here is one they simply do not exercise.
        return;
    }
    const records = shards[op.assetType];
    if (!records) {
        return;
    }
    if (op.op === "update-asset") {
        records[op.assetId] = { ...op.record } as Record<string, unknown>;
        return;
    }
    if (op.op !== "move-assets") {
        return;
    }
    for (const move of op.moves) {
        const record = records[move.assetId];
        if (!record) {
            continue;
        }
        if (move.groupId === null) {
            delete record.groupId;
        } else {
            record.groupId = move.groupId;
        }
    }
}

function createWindow(world: World, instance: string): Window {
    const { service, history } = createStoryService();
    const ids = seed(service);
    const calls: string[] = [];
    const window: Window = {
        session: null as never,
        story: service,
        history,
        storyId: ids.storyId,
        sceneId: ids.sceneId,
        calls,
        version: { head: "rev-1", uncommitted: false, conflicts: [], syncTo: null },
        freeze: { reason: null, armed: null },
        forgotten: [],
        instance,
        hasRepository: true,
        cast: { characters: {}, order: [], groups: {} },
        castSink: null,
        translations: { ja: {} },
        translationSink: null,
        keys: {},
        variables: {},
        variablesReadable: true,
        variableSink: null,
        takes: { ja: {} },
        takeSink: null,
        assets: { image: {} },
        assetSink: null,
        tracks: [],
        trackSink: null,
        clock: 0,
        timers: [],
    };
    let checkpoints = 0;

    const deps: LiveSessionDeps = {
        instance: async () => window.instance,
        project: async () => (window.hasRepository
            ? { repositoryId: PROJECT, projectPath: PROJECT_PATH, remoteOrigin: REMOTE }
            : null),
        rooms: () => createRooms(world, instance, calls),
        story: {
            setSink: sink => service.setOperationSink(sink),
            listStories: () => service.listStories().map(entry => entry.id),
            loadAll: async () => {
                for (const entry of service.listStories()) {
                    await service.loadStory(entry.id);
                }
                return service.listStories().map(entry => entry.id);
            },
            rowsSpokenBy: () => [],
            document: storyId => {
                try {
                    return service.getStoryDocument(storyId);
                } catch {
                    return null;
                }
            },
            applyOp: (storyId, op) => service.applyLiveOp(storyId, op),
            adoptDerived: derived => {
                const locales = Object.keys(derived.translations ?? {});
                calls.push(`derived:${locales.join(",")}`);
                return locales.map(locale => ({ of: "translations" as const, locale }));
            },
        },
        cast: {
            setSink: sink => {
                window.castSink = sink;
            },
            view: () => window.cast,
            applyOp: op => {
                calls.push(`cast:${op.op}`);
                applyCastOp(window.cast, op);
                return [];
            },
        },
        localization: {
            setSink: sink => {
                window.translationSink = sink;
            },
            loadAll: async () => Object.keys(window.translations),
            units: locale => window.translations[locale] ?? null,
            loadKeys: async () => window.keys !== null,
            keys: () => window.keys,
            applyOp: op => {
                if (op.op === "set-key" || op.op === "remove-key") {
                    calls.push(`keys:${op.op}`);
                    applyKeyOp(window.keys, op);
                    return;
                }
                calls.push(`translations:${op.op}`);
                applyTranslationOp(window.translations, op);
            },
        },
        variables: {
            setSink: sink => {
                window.variableSink = sink;
            },
            readable: () => window.variablesReadable,
            entry: variableId => window.variables[variableId] ?? null,
            applyOp: op => {
                calls.push(`variables:${op.op}`);
                applyVariableOp(window.variables, op);
            },
        },
        voice: {
            setSink: sink => {
                window.takeSink = sink;
            },
            loadAll: async () => Object.keys(window.takes),
            units: locale => window.takes[locale] ?? null,
            applyOp: op => {
                calls.push(`takes:${op.op}`);
                applyTakeOp(window.takes, op);
            },
        },
        assets: {
            setSink: sink => {
                window.assetSink = sink;
            },
            shardTypes: () => Object.keys(window.assets),
            records: assetType => window.assets[assetType] ?? null,
            hasRecord: (assetType, assetId) => window.assets[assetType]?.[assetId] !== undefined,
            resumePayloads: () => undefined,
            folderCategories: () => ["image"],
            folders: () => ({}),
            applyOp: op => {
                calls.push(`assets:${op.op}`);
                applyAssetOp(window.assets, op);
                return [];
            },
        },
        // The three small project tables. The dictionary and the asset sets are wired to nothing:
        // no test drives them, and a port that answered with a document nobody wrote would be a
        // fixture pretending to be a service. The mixer is real enough to apply an operation,
        // because that is what the round trip below states.
        dictionary: {
            setSink: () => undefined,
            document: () => null,
            applyOp: () => undefined,
        },
        audioTracks: {
            setSink: sink => {
                window.trackSink = sink;
            },
            tracks: () => window.tracks,
            applyOp: op => {
                calls.push(`tracks:${op.op}`);
                applyTrackOp(window, op);
            },
        },
        assetSets: {
            setSink: () => undefined,
            sets: () => null,
            applyOp: () => undefined,
        },
        version: {
            checkpoint: async () => {
                calls.push("checkpoint");
                if (!window.version.uncommitted) {
                    // Nothing to record, which is the ordinary case and not a failure.
                    return null;
                }
                window.version.uncommitted = false;
                window.version.head = `rev-checkpoint-${++checkpoints}`;
                return window.version.head;
            },
            head: async () => window.version.head,
            hasUncommittedChanges: async () => window.version.uncommitted,
            push: async () => {
                calls.push("push");
            },
            sync: async () => {
                calls.push("sync");
                if (window.version.syncTo !== null) {
                    window.version.head = window.version.syncTo;
                }
                return { conflicts: window.version.conflicts };
            },
        },
        freeze: {
            reason: () => window.freeze.reason,
            arm: async input => {
                calls.push("freeze");
                window.freeze.armed = input;
                window.freeze.reason = {
                    kind: "live-session",
                    session: input.session,
                    writable: input.writable,
                };
            },
            lift: session => {
                if (window.freeze.reason?.kind === "live-session" && window.freeze.reason.session === session) {
                    calls.push("thaw");
                    window.freeze.armed = null;
                    window.freeze.reason = null;
                }
            },
        },
        history: {
            forgetStoryScenes: storyId => window.forgotten.push(storyId),
        },
        now: () => window.clock,
        // Recorded and never run of its own accord: a live timer here would only be a way for a
        // test to outlive itself. A test that is about one calls `fireTimers`.
        schedule: (delayMs, run) => {
            const timer = { delayMs, run, cancelled: false };
            window.timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        },
    };
    window.session = new LiveSession(deps);
    return window;
}

/**
 * Run whatever this window has waiting, once each.
 *
 * Snapshotted first, because a timer that re-schedules itself would otherwise be run again by the
 * same pass - which is a loop rather than a tick.
 */
function fireTimers(window: Window): void {
    const due = window.timers;
    window.timers = [];
    for (const timer of due) {
        if (!timer.cancelled) {
            timer.run();
        }
    }
}

/** Deliver what is in flight, and let the promises delivering it started settle. */
async function drain(bus: Bus): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) {
        bus.flush();
        await Promise.resolve();
    }
}

/** How many claim SETS have crossed the room, which is the traffic this feature costs it. */
function countClaimsMessages(world: World): number {
    return world.bus.said.filter(payload => (payload as { kind?: unknown }).kind === "claims").length;
}

function textOf(window: Window, blockId: string): string {
    const block = window.story.getStoryDocument(window.storyId).scenes[window.sceneId].blocks[blockId];
    return (block.payload as { text: { value: string } }).text.value;
}

describe("a live session", () => {
    let world: World;
    let host: Window;
    let guest: Window;

    beforeEach(() => {
        world = { bus: createBus(), rooms: new Map() };
        host = createWindow(world, "instance-host");
        guest = createWindow(world, "instance-guest");
    });

    /** Open a room from the host window, and follow the ordinary sequence. */
    async function openRoom(): Promise<void> {
        host.version.uncommitted = true;
        const failure = await host.session.open({ storyId: host.storyId });
        expect(failure).toBeNull();
    }

    /** Join it from the guest window, on the revision the room opened on. */
    async function joinRoom(): Promise<void> {
        guest.version.syncTo = host.version.head;
        // What syncing to that revision leaves behind: the host's bytes, the scene's own metadata
        // included. The digest that guards against the two copies drifting covers the whole scene,
        // so a guest that started from a differently stamped copy would report a divergence on the
        // first effect and be right to.
        guest.story.replaceScene(
            guest.storyId,
            guest.sceneId,
            structuredClone(host.story.getStoryDocument(host.storyId).scenes[host.sceneId]),
        );
        const failure = await guest.session.join({ session: "room-1" });
        expect(failure).toBeNull();
        await drain(world.bus);
    }

    describe("which half of it a window is", () => {
        it("is the host in the window that opened the room", async () => {
            await openRoom();
            expect(host.session.getView().role).toBe("host");
            expect(host.session.getView().phase).toBe("active");
        });

        it("is a guest in every other window, and catches up before it follows", async () => {
            await openRoom();
            guest.version.syncTo = host.version.head;
            await guest.session.join({ session: "room-1" });
            const view = guest.session.getView();
            expect(view.role).toBe("guest");
            // Asked the host for everything since the room opened; not following until it answers.
            expect(view.phase).toBe("catching-up");
            await drain(world.bus);
            expect(guest.session.getView().phase).toBe("active");
        });
    });

    describe("opening", () => {
        it("records a checkpoint first and opens the room on that revision", async () => {
            await openRoom();
            // The checkpoint is what makes the revision real: a room opened on a revision the
            // author's tree has moved past is a room whose members do not share a starting point.
            expect(host.calls).toEqual(["checkpoint", "push", "open:rev-checkpoint-1", "freeze"]);
            expect(host.session.getView().revision).toBe("rev-checkpoint-1");
            expect(host.session.getView().checkpoint).toBe("rev-checkpoint-1");
        });

        it("opens on the head when the tree had nothing to record", async () => {
            host.version.uncommitted = false;
            await host.session.open({ storyId: host.storyId });
            expect(host.calls).toContain("open:rev-1");
            expect(host.session.getView().checkpoint).toBeNull();
        });

        it("is refused while the workspace is frozen for something else", async () => {
            host.freeze.reason = { kind: "merge" };
            const failure = await host.session.open({ storyId: host.storyId });
            expect(failure).toEqual({
                kind: "frozen",
                refusal: { frozenBy: "merge", message: "workspace.shell.team.liveBlockedMerge" },
            });
            // Nothing was recorded and no room was opened: re-freezing with a session's reason
            // would have replaced the merge freeze rather than adding to it.
            expect(host.calls).toEqual([]);
            expect(world.rooms.size).toBe(0);
        });
    });

    describe("joining", () => {
        it("records a checkpoint for uncommitted work, then syncs to the room's revision", async () => {
            await openRoom();
            guest.version.uncommitted = true;
            guest.version.syncTo = host.version.head;
            const failure = await guest.session.join({ session: "room-1" });
            expect(failure).toBeNull();
            expect(guest.calls).toEqual(["checkpoint", "sync", "join", "freeze"]);
            // Named so the author can be told where their own work went before the session's state
            // landed on top of it.
            expect(guest.session.getView().checkpoint).toBe("rev-checkpoint-1");
        });

        it("syncs without a checkpoint when there was nothing to record", async () => {
            await openRoom();
            guest.version.syncTo = host.version.head;
            await guest.session.join({ session: "room-1" });
            expect(guest.calls).toEqual(["sync", "join", "freeze"]);
        });

        it("asks for a clone when the room is about a project this machine does not have", async () => {
            await openRoom();
            const room = world.rooms.get("room-1") as TeamLiveSession;
            const failure = await guest.session.join({
                session: { ...room, project: "some-other-repository" },
            });
            expect(failure).toEqual({
                kind: "clone-required",
                project: "some-other-repository",
                revision: host.version.head,
            });
            // Nothing here is at stake, so nothing is checkpointed - and nothing is frozen either.
            expect(guest.calls).toEqual([]);
            expect(guest.freeze.armed).toBeNull();
        });

        it("follows the document the room names rather than one of its own", async () => {
            // ⚠ The whole point of the room carrying it. This guest holds a second story and
            // prefers it - which is what a machine that came by the project some other way looks
            // like - and joining must still bind the one the host opened on.
            await openRoom();
            guest.version.syncTo = host.version.head;
            // A second story, and the room is about that one. Nothing this window could have
            // worked out for itself would land here: it is not the story the two copies share and
            // it is not the one this window opened with.
            const other = guest.story.createStory("Something else");
            const room = world.rooms.get("room-1") as TeamLiveSession;
            expect(other.id).not.toBe(host.storyId);
            world.rooms.set("room-1", { ...room, story: other.id });

            expect(await guest.session.join({ session: "room-1" })).toBeNull();

            expect(guest.session.getView().storyId).toBe(other.id);
            // And the freeze leaves the room's document writable, not the one this window shares.
            expect(guest.freeze.armed?.writable).toEqual(
                liveSessionWritablePaths(
                    guest.story.listStories().map(e => e.id),
                    CARRIED_LOCALES,
                    CARRIED_ASSET_TYPES,
                    CARRIED_ASSET_CATEGORIES,
                    CARRIED_REGISTRIES,
                ),
            );
            expect(guest.freeze.armed?.writable).toContain(storyDocumentSpec.pathFor({ storyId: other.id }));
        });

        it("refuses a room that does not say which document it is about", async () => {
            // Only a room opened by a Studio older than the field, against a server older than the
            // requirement. Falling back to a guess here is the failure this whole change removes,
            // so the fallback must not quietly come back.
            await openRoom();
            const room = world.rooms.get("room-1") as TeamLiveSession;
            const { story: _story, ...older } = room;
            world.rooms.set("room-1", older as TeamLiveSession);
            guest.version.syncTo = host.version.head;

            expect(await guest.session.join({ session: "room-1" })).toEqual({ kind: "room-story-unknown" });
            // Nothing was touched on the way to finding out: no checkpoint, no sync, no freeze.
            expect(guest.calls).toEqual([]);
            expect(guest.freeze.armed).toBeNull();
        });

        it("refuses when the room's document is not in this copy after syncing", async () => {
            await openRoom();
            const room = world.rooms.get("room-1") as TeamLiveSession;
            world.rooms.set("room-1", { ...room, story: "story-nobody-here-has" });
            guest.version.syncTo = host.version.head;

            expect(await guest.session.join({ session: "room-1" }))
                .toEqual({ kind: "story-not-here", storyId: "story-nobody-here-has" });
            // The sync ran - this is only knowable afterwards - but the room was never joined and
            // nothing froze behind a session that could not have worked.
            expect(guest.calls).toEqual(["sync"]);
            expect(guest.freeze.armed).toBeNull();
        });

        it("refuses when the tree cannot be brought to the revision the room opened on", async () => {
            await openRoom();
            guest.version.syncTo = "rev-somebody-pushed-past-it";
            const failure = await guest.session.join({ session: "room-1" });
            expect(failure).toEqual({
                kind: "revision-mismatch",
                expected: host.version.head,
                actual: "rev-somebody-pushed-past-it",
            });
            expect(guest.freeze.armed).toBeNull();
        });

        it("refuses when the sync left files a human has to settle", async () => {
            await openRoom();
            guest.version.conflicts = ["editor/story/stories/x/storydoc.json"];
            const failure = await guest.session.join({ session: "room-1" });
            expect(failure).toMatchObject({ kind: "merge-conflicts" });
            expect(guest.freeze.armed).toBeNull();
        });
    });

    describe("the freeze around it", () => {
        it("is armed on entry with the session and every document it carries, and nothing else", async () => {
            await openRoom();
            // Straight from the table the host also decides "is this document mine to change" from.
            // A path the boundary allows that the vocabulary cannot carry is an edit that lands here
            // and nowhere else, with no digest over it and nothing reporting a problem.
            expect(host.freeze.armed).toEqual({
                session: "room-1",
                writable: liveSessionWritablePaths(
                    host.story.listStories().map(e => e.id),
                    CARRIED_LOCALES,
                    CARRIED_ASSET_TYPES,
                    CARRIED_ASSET_CATEGORIES,
                    CARRIED_REGISTRIES,
                ),
            });
            expect(host.freeze.armed?.writable).toEqual([
                storyDocumentSpec.pathFor({ storyId: host.storyId }),
                charactersSpec.pathFor(),
                localizationDocumentSpec.pathFor({ locale: "ja" }),
                voiceDocumentSpec.pathFor({ locale: "ja" }),
                assetsMetadataSpec.pathFor({ type: "image" }),
                assetGroupsSpec.pathFor({ category: "image" }),
                // The three project tables, which take no parameter: one of each per project, so a
                // session carries them whatever else it was opened on.
                dictionarySpec.pathFor(),
                audioTracksSpec.pathFor(),
                assetSetsSpec.pathFor(),
                // The two project-level registries, which are one per project and carried because
                // this window could read them.
                variableRegistrySpec.pathFor(),
                localizationKeysSpec.pathFor(),
                // ⚠ And the two the vocabulary is never about: a file's bytes, which an applier puts
                // down rather than anybody addressing, and the row order, which every machine
                // recomputes from what it has just applied.
                "assets/content",
                "assets/assets.order.image.json",
            ]);
            // And the scene stacks are dropped, because every snapshot in them is a statement about
            // a document only this author ever had.
            expect(host.forgotten).toEqual([host.storyId]);
        });

        it("lifts when the author leaves", async () => {
            await openRoom();
            await host.session.leave();
            expect(host.freeze.armed).toBeNull();
            expect(host.session.getView()).toMatchObject({
                phase: "idle",
                ended: { cause: "left", sessionId: "room-1" },
            });
        });

        it("lifts under a guest when the host's window ends the room", async () => {
            await openRoom();
            await joinRoom();
            await host.session.leave();
            await drain(world.bus);
            expect(guest.freeze.armed).toBeNull();
            expect(guest.session.getView()).toMatchObject({
                phase: "idle",
                ended: { cause: "host-left", sessionId: "room-1" },
            });
        });

        it("lifts when the copies stop agreeing, and the reason is there to be stated", async () => {
            await openRoom();
            await joinRoom();
            // An effect the host never sent, carrying a fingerprint of a scene nobody holds. Two
            // documents that differ is the most expensive way this design can fail, so the answer
            // is to leave loudly rather than to re-read quietly.
            world.bus.say("room-1", {
                kind: "effect",
                by: "instance-host",
                seq: 1,
                document: { doc: "story", storyId: guest.storyId },
                op: { op: "rename-scene", sceneId: guest.sceneId, name: "Elsewhere" },
                digests: [{
                    scope: { of: "scene", storyId: guest.storyId, sceneId: guest.sceneId },
                    hash: "a-digest-nobody-computed",
                }],
            }, "instance-host");
            await drain(world.bus);
            expect(guest.freeze.armed).toBeNull();
            const ended = guest.session.getView().ended;
            expect(ended?.cause).toBe("diverged");
            expect(ended?.divergence).toMatchObject({ seq: 1, expected: "a-digest-nobody-computed" });
        });

        it("refuses a second session while one is running", async () => {
            await openRoom();
            expect(await host.session.open({ storyId: host.storyId })).toEqual({ kind: "busy" });
        });
    });

    describe("what an editing gesture does", () => {
        it("becomes an intent and leaves a guest's document exactly as it was", async () => {
            await openRoom();
            await joinRoom();
            guest.story.updateBlock(guest.storyId, guest.sceneId, "a", note("a", "typed by the guest").payload);
            // Nothing is applied optimistically, so nothing ever has to be taken back.
            expect(textOf(guest, "a")).toBe("a");
            expect(guest.session.getView().pendingIntents).toBe(1);
        });

        it("reaches every document in the room once the host has applied it", async () => {
            await openRoom();
            await joinRoom();
            guest.story.updateBlock(guest.storyId, guest.sceneId, "a", note("a", "typed by the guest").payload);
            await drain(world.bus);
            expect(textOf(host, "a")).toBe("typed by the guest");
            expect(textOf(guest, "a")).toBe("typed by the guest");
            expect(guest.session.getView().pendingIntents).toBe(0);
        });

        it("is applied and broadcast at once when the host is the one editing", async () => {
            await openRoom();
            await joinRoom();
            host.story.updateBlock(host.storyId, host.sceneId, "b", note("b", "typed by the host").payload);
            await drain(world.bus);
            expect(textOf(host, "b")).toBe("typed by the host");
            expect(textOf(guest, "b")).toBe("typed by the host");
        });

        it("is left alone when it is about another story", async () => {
            await openRoom();
            const other = host.story.createStory("Another");
            const document = host.story.getStoryDocument(other.id);
            host.story.renameScene(other.id, document.chapters[0].sceneIds[0], "Renamed on its own");
            expect(host.story.getStoryDocument(other.id).scenes[document.chapters[0].sceneIds[0]].name)
                .toBe("Renamed on its own");
        });
    });

    describe("the cast, the second document in the room", () => {
        /** A record as small as one of these tests needs it. */
        function record(id: string, name = id): StoredCharacter {
            return {
                profile: {
                    id,
                    name,
                    description: "",
                    tags: [],
                    attributes: {},
                    thumbnail: null,
                    nicknames: [],
                    appearance: { kind: "preset", poses: [], defaultPoseId: null },
                },
            };
        }

        /** What a panel does: hand the sink an operation and let the room decide. */
        function edit(window: Window, op: LiveCharacterOp): void {
            window.castSink?.handle(op);
        }

        it("carries a creation from one window to the other", async () => {
            await openRoom();
            await joinRoom();

            edit(guest, { op: "create-character", character: record("c1", "Ada") });
            // Nothing is applied optimistically here either: the record appears when the effect
            // answering the intent arrives, and not when the gesture was made.
            expect(guest.cast.characters.c1).toBeUndefined();

            await drain(world.bus);
            expect(host.cast.characters.c1?.profile.name).toBe("Ada");
            expect(guest.cast.characters.c1?.profile.name).toBe("Ada");
        });

        it("applies and broadcasts at once when the host is the one editing", async () => {
            await openRoom();
            await joinRoom();

            edit(host, { op: "create-character", character: record("c1", "Ada") });
            expect(host.cast.characters.c1?.profile.name).toBe("Ada");

            await drain(world.bus);
            expect(guest.cast.characters.c1?.profile.name).toBe("Ada");
        });

        it("holds a record for its editor and refuses everybody else's write to it", async () => {
            await openRoom();
            await joinRoom();
            edit(host, { op: "create-character", character: record("c1", "Ada") });
            await drain(world.bus);

            guest.session.claimCharacter("c1", true);
            await drain(world.bus);
            expect(host.session.getView().claims).toEqual({ [characterClaimKey("c1")]: "instance-guest" });

            edit(host, { op: "update-character", characterId: "c1", character: record("c1", "Taken") });
            await drain(world.bus);

            // The refusal names a person, and the record the guest is inside is untouched.
            expect(host.cast.characters.c1?.profile.name).toBe("Ada");
            expect(host.session.getView().lastRefusal?.reason).toBe("row-claimed");
        });

        it("keeps the story's claims and the cast's apart, though both are uuids", async () => {
            await openRoom();
            await joinRoom();

            guest.session.claimRow(guest.storyId, "a", true);
            guest.session.claimCharacter("a", true);
            await drain(world.bus);

            // An unprefixed set would have let one document's claim answer for the other's, and
            // nothing would have compared the two to notice.
            expect(host.session.getView().claims).toEqual({
                [storyRowClaimKey("a")]: "instance-guest",
                [characterClaimKey("a")]: "instance-guest",
            });
        });

        it("takes a cast edit back by sending its inverse, like any other operation", async () => {
            await openRoom();
            await joinRoom();
            edit(host, { op: "create-character", character: record("c1", "Ada") });
            await drain(world.bus);
            edit(guest, { op: "update-character", characterId: "c1", character: record("c1", "Ada Lovelace") });
            await drain(world.bus);
            expect(host.cast.characters.c1?.profile.name).toBe("Ada Lovelace");

            expect(guest.session.undo()).toBe(true);
            await drain(world.bus);

            // The inverse carries the whole previous record, so both copies are back where they were.
            expect(host.cast.characters.c1?.profile.name).toBe("Ada");
            expect(guest.cast.characters.c1?.profile.name).toBe("Ada");
        });

        it("takes a creation back by deleting the record it made", async () => {
            await openRoom();
            await joinRoom();
            edit(host, { op: "create-character", character: record("c1", "Ada") });
            await drain(world.bus);
            expect(guest.cast.characters.c1?.profile.name).toBe("Ada");

            expect(host.session.undo()).toBe(true);
            await drain(world.bus);

            // A deletion is a shared operation like any other, so the record goes everywhere it went.
            expect(host.cast.characters.c1).toBeUndefined();
            expect(guest.cast.characters.c1).toBeUndefined();
        });

        it("carries a deletion to the other machine", async () => {
            await openRoom();
            await joinRoom();
            edit(host, { op: "create-character", character: record("c1", "Ada") });
            await drain(world.bus);

            edit(guest, { op: "delete-character", characterId: "c1" });
            // Nothing is applied optimistically: the record is still there until the effect arrives.
            expect(guest.cast.characters.c1?.profile.name).toBe("Ada");

            await drain(world.bus);
            expect(host.cast.characters.c1).toBeUndefined();
            expect(guest.cast.characters.c1).toBeUndefined();
        });

        it("refuses a record too large to travel, rather than sending half of it", async () => {
            await openRoom();
            const enormous = record("c1", "Ada");
            // Bigger than one `live.say` on its own. Refused by name and said out loud: half a
            // record is a record nobody wrote, and a change that appears to have been made and
            // reached nobody is worse than one that was refused.
            enormous.profile.description = "x".repeat(20_000);

            edit(host, { op: "create-character", character: enormous });
            await drain(world.bus);

            expect(host.cast.characters.c1).toBeUndefined();
            expect(host.session.getView().lastRefusal?.reason).toBe("too-large");
        });
    });

    describe("the scene's own undo stack", () => {
        /**
         * The wiring the story editor has, in the one line that matters: the scope refuses to
         * describe a scene a session owns, and `HistoryService` records nothing for a scope whose
         * state cannot be read. Every checkpoint against this scene therefore stops recording at
         * once - the eleven the editor takes in front of its mutators, and the ones taken outside
         * it - without any of those call sites knowing a session exists.
         */
        function registerScope(window: Window): string {
            const scopeId = storySceneHistoryScope(window.storyId, window.sceneId);
            window.history.registerScope<{ scene: string }>({
                id: scopeId,
                label: { key: "workspace.history.scope.storyScene" },
                capture: () => (window.session.ownsStory(window.storyId) ? null : { scene: "snapshot" }),
                apply: () => undefined,
            });
            return scopeId;
        }

        it("takes no scene snapshot while a session runs, and takes one again after it ends", async () => {
            const scopeId = registerScope(host);
            const record = (): boolean =>
                host.history.checkpoint(scopeId, { label: { key: "workspace.history.entry.storyEdit" } });

            expect(record()).toBe(true);

            await openRoom();
            // One Ctrl+Z over a snapshot taken here would restore a whole scene over a shared
            // document, deleting everything the others wrote since, silently. That is the exact
            // failure this design exists to prevent.
            expect(record()).toBe(false);

            await host.session.leave();
            expect(record()).toBe(true);
        });
    });

    describe("one gesture, one operation", () => {
        it("sends a whole paste as one effect and takes it back in one press", async () => {
            // ⚠ What the batch verbs are for. Sent row by row, a paste of three lines is three
            // effects - three arrivals on every other screen - and three presses of Ctrl+Z to undo
            // something the author did once. Outside a session the same paste is one step.
            await openRoom();
            await joinRoom();
            const said = world.bus.said.length;

            guest.story.insertBlocks(guest.storyId, guest.sceneId, [
                { block: note("p1"), target: { parentId: null } },
                { block: note("p2"), target: { parentId: null } },
                { block: note("p3"), target: { parentId: null } },
            ]);
            await drain(world.bus);

            expect(textOf(host, "p3")).toBe("p3");
            expect(textOf(guest, "p3")).toBe("p3");
            // One intent out and one effect back, whatever the row count.
            const intents = world.bus.said.slice(said)
                .filter(payload => (payload as { kind?: unknown }).kind === "intent");
            const effects = world.bus.said.slice(said)
                .filter(payload => (payload as { kind?: unknown }).kind === "effect");
            expect(intents).toHaveLength(1);
            expect(effects).toHaveLength(1);

            expect(guest.session.undo()).toBe(true);
            await drain(world.bus);

            for (const id of ["p1", "p2", "p3"]) {
                expect(host.story.getStoryDocument(host.storyId).scenes[host.sceneId].blocks[id]).toBeUndefined();
                expect(guest.story.getStoryDocument(guest.storyId).scenes[guest.sceneId].blocks[id]).toBeUndefined();
            }
        });

        it("deletes a selection as one operation and puts it back as one", async () => {
            await openRoom();
            await joinRoom();

            guest.story.deleteBlocks(guest.storyId, guest.sceneId, ["a", "c"]);
            await drain(world.bus);
            expect(host.story.getStoryDocument(host.storyId).scenes[host.sceneId].blocks["a"]).toBeUndefined();
            expect(textOf(host, "b")).toBe("b");

            expect(guest.session.undo()).toBe(true);
            await drain(world.bus);

            // Back where they sat, on both machines, rather than appended to the end.
            const scene = host.story.getStoryDocument(host.storyId).scenes[host.sceneId];
            expect(scene.rootBlockIds).toEqual(["a", "b", "c"]);
            expect(guest.story.getStoryDocument(guest.storyId).scenes[guest.sceneId].rootBlockIds)
                .toEqual(["a", "b", "c"]);
        });
    });

    describe("what a paste derives", () => {
        /** One line's translation, as a paste re-keys it onto the id it has just minted. */
        const JA: LiveDerived = {
            translations: {
                ja: { "text-p": { target: "こんにちは", sourceHash: "h1", status: "translated" } },
            },
        };

        it("travels on the operation that carries the rows, to everybody including the paster", async () => {
            // ⚠ The regression. The entries have to travel WITH the rows: the machine that
            // pasted read them out of its own memory at the moment of copying, so an effect saying
            // "look this text id up in your own library" would derive nothing anywhere else - and
            // the room's libraries would part company silently, one paste at a time.
            await openRoom();
            await joinRoom();
            host.calls.length = 0;
            guest.calls.length = 0;

            guest.story.insertBlocks(guest.storyId, guest.sceneId, [{ block: note("p"), target: { parentId: null } }], JA);
            await drain(world.bus);

            expect(textOf(host, "p")).toBe("p");
            expect(textOf(guest, "p")).toBe("p");
            // Both windows write them, through the one applier that applies an effect. The paster is
            // not exempt: a paster that wrote from its own memory would be a second implementation.
            expect(host.calls).toContain("derived:ja");
            expect(guest.calls).toContain("derived:ja");
        });

        it("comes back with the row when a delete of it is taken back", async () => {
            // What putting the entries on the row buys. The row was pasted with its translation; a
            // delete takes both away; the undo has to bring both back, and the only place the
            // entries still exist by then is the effect that carried them.
            await openRoom();
            await joinRoom();
            guest.story.insertBlocks(guest.storyId, guest.sceneId, [{ block: note("p"), target: { parentId: null } }], JA);
            await drain(world.bus);
            guest.story.deleteBlock(guest.storyId, guest.sceneId, "p");
            await drain(world.bus);
            expect(host.story.getStoryDocument(host.storyId).scenes[host.sceneId].blocks["p"])
                .toBeUndefined();
            host.calls.length = 0;
            guest.calls.length = 0;

            expect(guest.session.undo()).toBe(true);
            await drain(world.bus);

            expect(textOf(host, "p")).toBe("p");
            expect(host.calls).toContain("derived:ja");
            expect(guest.calls).toContain("derived:ja");
        });
    });


    describe("the asset library", () => {
        function record(id: string, name = `${id}.png`, groupId?: string): Record<string, unknown> {
            return { id, type: "image", name, hash: `hash-${id}`, tags: [], description: "", ...(groupId ? { groupId } : {}) };
        }

        function seedAssets(): void {
            for (const window of [host, guest]) {
                window.assets.image = { a1: record("a1", "room.png"), a2: record("a2") };
            }
        }

        it("carries a record edit from one window to the other, and applies nothing optimistically", async () => {
            await openRoom();
            await joinRoom();
            seedAssets();

            guest.assetSink?.handle({
                op: "update-asset", assetType: "image", assetId: "a1", record: record("a1", "hall.jpg"),
            });
            // The row moves when the effect answering the intent arrives, not when the inspector's
            // field was blurred - the same bargain every gesture on this seam makes.
            expect(guest.assets.image.a1.name).toBe("room.png");

            await drain(world.bus);
            expect(host.assets.image.a1.name).toBe("hall.jpg");
            expect(guest.assets.image.a1.name).toBe("hall.jpg");
        });

        it("carries a whole drag as one operation, with no claim anywhere in it", async () => {
            await openRoom();
            await joinRoom();
            seedAssets();

            guest.assetSink?.handle({
                op: "move-assets",
                assetType: "image",
                moves: [{ assetId: "a1", groupId: "chapter-2" }, { assetId: "a2", groupId: "chapter-2" }],
            });
            await drain(world.bus);

            expect(host.assets.image.a1.groupId).toBe("chapter-2");
            expect(host.assets.image.a2.groupId).toBe("chapter-2");
            expect(host.session.getView().claims).toEqual({});
            expect(host.calls.filter(call => call === "assets:move-assets")).toHaveLength(1);
        });

        it("refuses a record the other window is inside, and says who has it", async () => {
            await openRoom();
            await joinRoom();
            seedAssets();
            guest.session.claimAsset("a1", true);
            await drain(world.bus);
            expect(host.session.getView().claims).toEqual({ [assetClaimKey("a1")]: "instance-guest" });

            host.assetSink?.handle({
                op: "update-asset", assetType: "image", assetId: "a1", record: record("a1", "over the top.png"),
            });
            await drain(world.bus);

            expect(host.assets.image.a1.name).toBe("room.png");
            expect(host.session.getView().lastRefusal)
                .toMatchObject({ reason: "row-claimed", op: "update-asset", heldBy: "instance-guest" });
        });

        it("takes a drag back in one press, each row to the folder it came from", async () => {
            await openRoom();
            await joinRoom();
            seedAssets();
            host.assets.image.a1 = record("a1", "room.png", "chapter-1");
            guest.assets.image.a1 = record("a1", "room.png", "chapter-1");

            guest.assetSink?.handle({
                op: "move-assets",
                assetType: "image",
                moves: [{ assetId: "a1", groupId: "chapter-2" }, { assetId: "a2", groupId: "chapter-2" }],
            });
            await drain(world.bus);
            expect(host.assets.image.a1.groupId).toBe("chapter-2");

            expect(guest.session.undo()).toBe(true);
            await drain(world.bus);

            // ⚠ Each row back where IT was, not where they all went.
            expect(host.assets.image.a1.groupId).toBe("chapter-1");
            expect(host.assets.image.a2.groupId).toBeUndefined();
            expect(guest.assets.image.a1.groupId).toBe("chapter-1");
        });

        it("fingerprints the shard it changed, so a machine that applied it differently is caught", async () => {
            await openRoom();
            await joinRoom();
            seedAssets();

            world.bus.said.length = 0;
            guest.assetSink?.handle({
                op: "update-asset", assetType: "image", assetId: "a1", record: record("a1", "hall.jpg"),
            });
            await drain(world.bus);

            const effect = world.bus.said
                .filter((payload): payload is LiveEffect => (payload as LiveEffect).kind === "effect")
                .find(one => one.op.op === "update-asset");
            expect(effect?.digests).toEqual([
                { scope: { of: "assets", assetType: "image" }, hash: expect.any(String) },
            ]);
        });
    });

    describe("the two project registries", () => {
        function variable(id: string, name = id): VariableRegistryEntry {
            return { id, name, scope: "saved", valueType: "boolean", storageKey: id };
        }

        function seedVariables(): void {
            for (const window of [host, guest]) {
                window.variables = { v1: variable("v1", "Gold") };
            }
        }

        it("leaves both registries writable, which is what says the session carries them", async () => {
            await openRoom();

            const writable = host.freeze.armed?.writable ?? [];
            expect(writable).toContain("editor/variables.json");
            expect(writable).toContain("editor/localization/keys.json");
        });

        it("carries a rename from one window to the other, and applies nothing optimistically", async () => {
            await openRoom();
            await joinRoom();
            seedVariables();

            guest.variableSink?.handle({ op: "update-variable", variableId: "v1", entry: variable("v1", "Coins") });
            // The row moves when the effect answering the intent arrives, not when the box was
            // typed into - the same bargain every gesture on this seam makes.
            expect(guest.variables.v1.name).toBe("Gold");

            await drain(world.bus);
            expect(host.variables.v1.name).toBe("Coins");
            expect(guest.variables.v1.name).toBe("Coins");
        });

        it("carries a declared string, and its removal, to the other window", async () => {
            await openRoom();
            await joinRoom();

            guest.translationSink?.handle({ op: "set-key", name: "menu.start", definition: { sourceText: "Start" } });
            await drain(world.bus);
            expect(host.keys?.["menu.start"]).toEqual({ sourceText: "Start" });
            expect(guest.keys?.["menu.start"]).toEqual({ sourceText: "Start" });

            guest.translationSink?.handle({ op: "remove-key", name: "menu.start" });
            await drain(world.bus);
            expect(host.keys?.["menu.start"]).toBeUndefined();
            expect(guest.keys?.["menu.start"]).toBeUndefined();
        });

        it("refuses a write to an entry somebody else has open, and names them", async () => {
            await openRoom();
            await joinRoom();
            seedVariables();

            guest.session.claimVariable("v1", true);
            await drain(world.bus);
            expect(host.session.getView().claims).toEqual({ [variableClaimKey("v1")]: "instance-guest" });

            host.variableSink?.handle({ op: "update-variable", variableId: "v1", entry: variable("v1", "Taken") });
            await drain(world.bus);

            expect(host.variables.v1.name).toBe("Gold");
            expect(host.session.getView().lastRefusal)
                .toMatchObject({ reason: "row-claimed", op: "update-variable", heldBy: "instance-guest" });
        });

        it("refuses a write to a named string somebody else has open", async () => {
            await openRoom();
            await joinRoom();
            for (const window of [host, guest]) {
                window.keys = { "menu.start": { sourceText: "Start" } };
            }

            guest.session.claimLocalizationKey("menu.start", true);
            await drain(world.bus);
            expect(host.session.getView().claims)
                .toEqual({ [localizationKeyClaimKey("menu.start")]: "instance-guest" });

            host.translationSink?.handle({ op: "set-key", name: "menu.start", definition: { sourceText: "Taken" } });
            await drain(world.bus);

            expect(host.keys?.["menu.start"]).toEqual({ sourceText: "Start" });
            expect(host.session.getView().lastRefusal)
                .toMatchObject({ reason: "row-claimed", op: "set-key", heldBy: "instance-guest" });
        });

        it("takes a declaration back with a removal, which is the only way that verb is reached", async () => {
            // An author's own deletion is refused for the length of a session - it also empties the
            // blueprint nodes that named the variable, and a session does not carry that document.
            await openRoom();
            await joinRoom();

            guest.variableSink?.handle({ op: "create-variable", entry: variable("v9", "Route") });
            await drain(world.bus);
            expect(host.variables.v9?.name).toBe("Route");

            expect(guest.session.undo()).toBe(true);
            await drain(world.bus);
            expect(host.variables.v9).toBeUndefined();
            expect(guest.variables.v9).toBeUndefined();
        });

        it("takes back the first declaration of a named string by removing it", async () => {
            await openRoom();
            await joinRoom();

            guest.translationSink?.handle({ op: "set-key", name: "menu.start", definition: { sourceText: "Start" } });
            await drain(world.bus);
            expect(host.keys?.["menu.start"]).toBeDefined();

            expect(guest.session.undo()).toBe(true);
            await drain(world.bus);
            expect(host.keys?.["menu.start"]).toBeUndefined();
            expect(guest.keys?.["menu.start"]).toBeUndefined();
        });

        it("carries neither registry when this machine could not read them", async () => {
            // ⚠ The invariant, from the other side: a document is writable during a session exactly
            // when the session can carry its changes. A registry nothing parsed carries nothing - so
            // it must stay frozen, and an operation about it must be refused rather than applied into
            // a stand-in that has nothing to do with the file on disk.
            host.keys = null;
            host.variablesReadable = false;

            await openRoom();

            const writable = host.freeze.armed?.writable ?? [];
            expect(writable).not.toContain("editor/variables.json");
            expect(writable).not.toContain("editor/localization/keys.json");

            host.variableSink?.handle({ op: "update-variable", variableId: "v1", entry: variable("v1", "Coins") });
            await drain(world.bus);
            expect(host.session.getView().lastRefusal)
                .toMatchObject({ reason: "document-not-shared", op: "update-variable" });
        });

        it("fingerprints the entry it changed, so a machine that applied it differently is caught", async () => {
            await openRoom();
            await joinRoom();
            seedVariables();

            world.bus.said.length = 0;
            guest.variableSink?.handle({ op: "update-variable", variableId: "v1", entry: variable("v1", "Coins") });
            guest.translationSink?.handle({ op: "set-key", name: "menu.start", definition: { sourceText: "Start" } });
            await drain(world.bus);

            const effects = world.bus.said
                .filter((payload): payload is LiveEffect => (payload as LiveEffect).kind === "effect");
            expect(effects.find(one => one.op.op === "update-variable")?.digests)
                .toEqual([{ scope: { of: "variable", variableId: "v1" }, hash: expect.any(String) }]);
            expect(effects.find(one => one.op.op === "set-key")?.digests)
                .toEqual([{ scope: { of: "localization-key", name: "menu.start" }, hash: expect.any(String) }]);
        });
    });

    describe("the translation and voice libraries", () => {
        function translation(target: string): LocalizationUnit {
            return { target, sourceHash: "h", status: "translated" };
        }

        it("carries a translation from one window to the other, and applies nothing optimistically", async () => {
            await openRoom();
            await joinRoom();

            guest.translationSink?.handle({
                op: "set-translation", locale: "ja", unitId: "text-a", unit: translation("遅いよ。"),
            });
            // The table moves when the effect answering the intent arrives, not when the translator
            // left the field - the same bargain every gesture on this seam makes.
            expect(guest.translations.ja["text-a"]).toBeUndefined();

            await drain(world.bus);
            expect(host.translations.ja["text-a"]?.target).toBe("遅いよ。");
            expect(guest.translations.ja["text-a"]?.target).toBe("遅いよ。");
        });

        it("carries a take the same way, with no claim anywhere in it", async () => {
            await openRoom();
            await joinRoom();

            guest.takeSink?.handle({
                op: "set-take", locale: "ja", unitId: "text-a", unit: { assetId: "clip-1", sourceHash: "h", status: "linked" },
            });
            await drain(world.bus);

            expect(host.takes.ja["text-a"]?.assetId).toBe("clip-1");
            expect(guest.takes.ja["text-a"]?.assetId).toBe("clip-1");
            expect(host.session.getView().claims).toEqual({});
        });

        it("refuses an entry the other window is inside, and says who has it", async () => {
            await openRoom();
            await joinRoom();
            guest.session.claimTranslation("ja", "text-a", true);
            await drain(world.bus);
            expect(host.session.getView().claims).toEqual({ [translationClaimKey("ja", "text-a")]: "instance-guest" });

            host.translationSink?.handle({
                op: "set-translation", locale: "ja", unitId: "text-a", unit: translation("over the top"),
            });
            await drain(world.bus);

            expect(host.translations.ja["text-a"]).toBeUndefined();
            expect(host.session.getView().lastRefusal)
                .toMatchObject({ reason: "row-claimed", op: "set-translation", heldBy: "instance-guest" });
        });

        it("takes one back with the inverse, and nothing else with it", async () => {
            await openRoom();
            await joinRoom();
            guest.translationSink?.handle({
                op: "set-translation", locale: "ja", unitId: "text-a", unit: translation("first"),
            });
            await drain(world.bus);
            guest.translationSink?.handle({
                op: "set-translation", locale: "ja", unitId: "text-a", unit: translation("second"),
            });
            await drain(world.bus);
            expect(host.translations.ja["text-a"]?.target).toBe("second");

            expect(guest.session.undo()).toBe(true);
            await drain(world.bus);
            expect(host.translations.ja["text-a"]?.target).toBe("first");
            expect(guest.translations.ja["text-a"]?.target).toBe("first");

            // And once more, back to the line having no translation at all.
            expect(guest.session.undo()).toBe(true);
            await drain(world.bus);
            expect(host.translations.ja["text-a"]).toBeUndefined();
        });

        it("fingerprints the libraries a paste derives entries into", async () => {
            // ⚠ Derived work is exactly the work that has to be checked rather than assumed: every
            // machine writes these entries for itself, and one that wrote half of them has to be
            // caught by this effect rather than by nothing.
            await openRoom();
            await joinRoom();
            const derived: LiveDerived = {
                translations: { ja: { "text-p": { target: "こんにちは", sourceHash: "h1", status: "translated" } } },
            };

            world.bus.said.length = 0;
            guest.story.insertBlocks(guest.storyId, guest.sceneId, [{ block: note("p"), target: { parentId: null } }], derived);
            await drain(world.bus);

            const effect = world.bus.said
                .filter((payload): payload is LiveEffect => (payload as LiveEffect).kind === "effect")
                .find(one => one.op.op === "insert-blocks");
            expect(effect?.digests?.some(digest => digest.scope.of === "translations" && digest.scope.locale === "ja"))
                .toBe(true);
            // And the scene the rows landed in is still fingerprinted: a derivation is reported
            // alongside what the operation named, never instead of it.
            expect(effect?.digests?.some(digest => digest.scope.of === "scene")).toBe(true);
        });
    });

    describe("who is writing which row", () => {
        it("carries a guest's claim to the host and comes back as the whole set", async () => {
            await openRoom();
            await joinRoom();

            guest.session.claimRow(guest.storyId, "b", true);
            // Nothing is held on the strength of having asked: the host is the only place a claim
            // exists, and the row is somebody's when the set says so.
            expect(guest.session.getView().claims).toEqual({});
            await drain(world.bus);

            expect(host.session.getView().claims).toEqual({ [storyRowClaimKey("b")]: "instance-guest" });
            expect(guest.session.getView().claims).toEqual({ [storyRowClaimKey("b")]: "instance-guest" });
        });

        it("puts the host's own row in the set, through the same door as a guest's", async () => {
            // A host that claimed locally would hold rows nobody else can see held: no mark on any
            // other screen, and nothing refusing a guest writing over its paragraph.
            await openRoom();
            await joinRoom();

            host.session.claimRow(host.storyId, "a", true);
            await drain(world.bus);

            expect(host.session.getView().claims).toEqual({ [storyRowClaimKey("a")]: "instance-host" });
            expect(guest.session.getView().claims).toEqual({ [storyRowClaimKey("a")]: "instance-host" });
        });

        it("takes the row out of the set when it is given back", async () => {
            await openRoom();
            await joinRoom();
            guest.session.claimRow(guest.storyId, "b", true);
            await drain(world.bus);

            guest.session.claimRow(guest.storyId, "b", false);
            await drain(world.bus);

            expect(host.session.getView().claims).toEqual({});
            expect(guest.session.getView().claims).toEqual({});
        });

        it("says nothing when the set has not moved, however often it is asserted", async () => {
            // This travels to every machine in the room, and a box asserts its claim again as its
            // author types. A set per assertion would be a message per author per few seconds
            // carrying news nobody has not already heard.
            await openRoom();
            await joinRoom();
            guest.session.claimRow(guest.storyId, "b", true);
            await drain(world.bus);

            const said = countClaimsMessages(world);
            for (let assertion = 0; assertion < 20; assertion += 1) {
                guest.session.claimRow(guest.storyId, "b", true);
                await drain(world.bus);
            }
            expect(countClaimsMessages(world) - said).toBe(0);
        });

        it("says a claim has lapsed on its own tick, rather than on the next thing that happens", async () => {
            // ⚠ The regression this pins. Every other movement of the set happens while the host
            // is answering something, so the new set travels with the answer; a lapse is the one
            // change nobody asked for, and without a tick the name stayed on screen until somebody
            // did something else in the room - which can be minutes.
            //
            // That was once written off as harmless, on the grounds that the host expires a claim
            // while answering the operation that asks about it, so the row really is free the
            // moment anybody tries. The row being free is exactly the problem: a name over a row is
            // what stops the person reading it from touching it, so a name that outlives its claim
            // invites the edit the claim existed to refuse.
            await openRoom();
            await joinRoom();
            guest.session.claimRow(guest.storyId, "b", true);
            await drain(world.bus);
            expect(guest.session.getView().claims).toEqual({ [storyRowClaimKey("b")]: "instance-guest" });

            // Nobody says anything and nobody asks for anything; the deadline simply passes.
            host.clock += DEFAULT_CLAIM_TIMEOUT_MS + 1;
            fireTimers(host);
            await drain(world.bus);

            expect(host.session.getView().claims).toEqual({});
            expect(guest.session.getView().claims).toEqual({});
        });

        it("keeps sweeping, so a second lapse is announced like the first", async () => {
            // The sweep re-schedules itself rather than repeating, and a session whose tick stopped
            // after one round would be one that told the truth once.
            await openRoom();
            await joinRoom();
            guest.session.claimRow(guest.storyId, "b", true);
            await drain(world.bus);
            host.clock += DEFAULT_CLAIM_TIMEOUT_MS + 1;
            fireTimers(host);
            await drain(world.bus);

            guest.session.claimRow(guest.storyId, "c", true);
            await drain(world.bus);
            expect(guest.session.getView().claims).toEqual({ [storyRowClaimKey("c")]: "instance-guest" });

            host.clock += DEFAULT_CLAIM_TIMEOUT_MS + 1;
            fireTimers(host);
            await drain(world.bus);
            expect(guest.session.getView().claims).toEqual({});
        });

        it("says nothing on a tick where nothing has lapsed", async () => {
            // The tick is a look, not an announcement. A set per tick would be a message every ten
            // seconds to every machine in the room for the whole life of a session in which
            // nobody is writing anything.
            await openRoom();
            await joinRoom();
            guest.session.claimRow(guest.storyId, "b", true);
            await drain(world.bus);

            const said = countClaimsMessages(world);
            for (let tick = 0; tick < 5; tick += 1) {
                fireTimers(host);
                await drain(world.bus);
            }
            expect(countClaimsMessages(world) - said).toBe(0);
            expect(guest.session.getView().claims).toEqual({ [storyRowClaimKey("b")]: "instance-guest" });
        });

        it("stops sweeping once the session is over", async () => {
            await openRoom();
            await joinRoom();
            expect(host.timers.some(timer => !timer.cancelled)).toBe(true);

            await host.session.leave();
            await drain(world.bus);

            // Cancelled outright rather than left to notice on its next run that there is nothing
            // to sweep: a window with no session must have nothing waiting to happen in it.
            expect(host.timers.every(timer => timer.cancelled)).toBe(true);
            fireTimers(host);
            expect(host.timers).toEqual([]);
        });

        it("refuses everybody else's edit to a claimed row, naming the holder", async () => {
            await openRoom();
            await joinRoom();
            guest.session.claimRow(guest.storyId, "b", true);
            await drain(world.bus);

            // The host is not exempt from the rule it enforces: the row is the guest's.
            host.story.updateBlock(host.storyId, host.sceneId, "b", note("b", "the host's own").payload);
            await drain(world.bus);

            expect(textOf(host, "b")).toBe("b");
            expect(host.session.getView().lastRefusal).toEqual({
                reason: "row-claimed",
                op: "update-block",
                heldBy: "instance-guest",
            });
            // And the holder still writes its own line, which is the whole point of holding it.
            guest.story.updateBlock(guest.storyId, guest.sceneId, "b", note("b", "hers").payload);
            await drain(world.bus);
            expect(textOf(host, "b")).toBe("hers");
        });

        it("drops what a window that has left the room was writing", async () => {
            await openRoom();
            await joinRoom();
            guest.session.claimRow(guest.storyId, "b", true);
            await drain(world.bus);

            await guest.session.leave();
            await drain(world.bus);

            // The one ending a give-back cannot cover: the machine that would have sent one is
            // gone, and the row would otherwise be held until it lapsed on the clock.
            expect(host.session.getView().claims).toEqual({});
        });

        it("holds nothing once this window's own session is over", async () => {
            await openRoom();
            await joinRoom();
            guest.session.claimRow(guest.storyId, "b", true);
            await drain(world.bus);
            expect(guest.session.getView().claims).toEqual({ [storyRowClaimKey("b")]: "instance-guest" });

            await guest.session.leave();
            expect(guest.session.getView().claims).toEqual({});
            // And a claim asked for outside a session reaches nobody at all.
            guest.session.claimRow(guest.storyId, "b", true);
            await drain(world.bus);
            expect(guest.session.getView().claims).toEqual({});
        });

        it("tells a window that joins mid-paragraph what is already being written", async () => {
            // The catch-up carries what the host DID. A claim is not an effect, so without this a
            // machine arriving in the middle of somebody's paragraph would see an unmarked scene
            // and learn the truth by being refused.
            await openRoom();
            host.session.claimRow(host.storyId, "a", true);
            await joinRoom();

            expect(guest.session.getView().claims).toEqual({ [storyRowClaimKey("a")]: "instance-host" });
        });

        it("says nothing about a scene of any other story", async () => {
            await openRoom();
            await joinRoom();
            guest.session.claimRow("story-elsewhere" as StoryId, "b", true);
            await drain(world.bus);

            expect(host.session.getView().claims).toEqual({});
        });
    });

    describe("undo", () => {
        it("sends the inverse of this window's own last operation", async () => {
            await openRoom();
            await joinRoom();
            host.story.updateBlock(host.storyId, host.sceneId, "b", note("b", "second thoughts").payload);
            await drain(world.bus);
            expect(host.session.getView().canUndo).toBe(true);

            expect(host.session.undo()).toBe(true);
            await drain(world.bus);
            // Not a snapshot: an operation, applied by everybody in the room in the host's order.
            expect(textOf(host, "b")).toBe("b");
            expect(textOf(guest, "b")).toBe("b");
            expect(host.session.getView().canRedo).toBe(true);

            expect(host.session.redo()).toBe(true);
            await drain(world.bus);
            expect(textOf(host, "b")).toBe("second thoughts");
            expect(textOf(guest, "b")).toBe("second thoughts");
        });

        it("works the same way from a guest, over the round trip", async () => {
            await openRoom();
            await joinRoom();
            guest.story.updateBlock(guest.storyId, guest.sceneId, "c", note("c", "guest words").payload);
            await drain(world.bus);
            expect(guest.session.undo()).toBe(true);
            await drain(world.bus);
            expect(textOf(guest, "c")).toBe("c");
            expect(textOf(host, "c")).toBe("c");
        });

        it("refuses when this window has done nothing, and says so", async () => {
            await openRoom();
            await joinRoom();
            // Somebody else's rows are not this window's to take back, whatever else has happened
            // in the room.
            host.story.updateBlock(host.storyId, host.sceneId, "a", note("a", "the host's own").payload);
            await drain(world.bus);
            expect(guest.session.undo()).toBe(false);
            expect(guest.session.getView().undoRefusal).toBe("nothing-to-undo");
        });

        it("refuses when the inverse no longer applies, and never falls back to a snapshot", async () => {
            await openRoom();
            await joinRoom();
            guest.story.updateBlock(guest.storyId, guest.sceneId, "c", note("c", "guest words").payload);
            await drain(world.bus);
            // The host deletes the row the guest's last operation was about.
            host.story.deleteBlock(host.storyId, host.sceneId, "c");
            await drain(world.bus);

            expect(guest.session.undo()).toBe(false);
            expect(guest.session.getView().undoRefusal).toBe("row-gone");
            // The row stays gone: nothing here restores a scene, which is what would have brought
            // it back along with everything else the room has done since.
            expect(guest.story.getStoryDocument(guest.storyId).scenes[guest.sceneId].blocks["c"]).toBeUndefined();
        });
    });
});
