import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import {
    AUDIO_TRACK_ID_MUSIC,
    AUDIO_TRACK_ID_SFX,
    AUDIO_TRACK_ID_VOICE,
} from "@shared/types/audioTrack";
import { Services, type WorkspaceContext } from "../services";
import { AudioTrackService } from "./AudioTrackService";

/**
 * The service end of the track document: reads through `loadDocument`, writes through
 * `saveDocument`, seeded from absence rather than migrated, and the same "refuse to write over a
 * file we could not read" latch every adopted document service carries.
 */

const ROOT = join("D:/projects", "my-game");
const DOCUMENT = join(ROOT, "editor", "audio-tracks.json");

type Harness = {
    service: AudioTrackService;
    files: Map<string, string>;
    unreadable: ReturnType<typeof vi.fn>;
};

async function createHarness(seed?: string, reuse?: AudioTrackService): Promise<Harness> {
    const files = new Map<string, string>();
    if (seed !== undefined) {
        files.set(DOCUMENT, seed);
    }
    const unreadable = vi.fn();
    let nextId = 0;

    const ok = <T,>(data: T): FsRequestResult<T> => ({ ok: true, data });
    const stubs: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => {
                const value = files.get(path);
                return value === undefined
                    ? { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }
                    : ok(value);
            },
            write: async (path: string, data: string) => {
                files.set(path, data);
                return ok(undefined);
            },
            createDir: async () => ok(undefined),
            copyFile: async (src: string, dest: string) => {
                files.set(dest, files.get(src) ?? "");
                return ok(undefined);
            },
        },
        [Services.Project]: {},
        [Services.Uuid]: { generate: () => `track-${++nextId}` },
        [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: unreadable },
    };

    const ctx = {
        project: { getConfig: () => ({ projectPath: ROOT }) },
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (!stub) {
                    throw new Error(`Service ${id} not found`);
                }
                return stub;
            },
        },
    } as unknown as WorkspaceContext;

    const service = reuse ?? new AudioTrackService();
    await service.initialize(ctx, async () => undefined);

    return { service, files, unreadable };
}

describe("AudioTrackService document adoption", () => {
    it("seeds the three built-ins on a project that has never had one", async () => {
        const { service, files } = await createHarness();

        expect(service.listTracks().map(track => track.id))
            .toEqual([AUDIO_TRACK_ID_MUSIC, AUDIO_TRACK_ID_SFX, AUDIO_TRACK_ID_VOICE]);
        // Written on first open, not on first edit: version control has to see the document from the
        // moment the project is opened.
        expect(files.get(DOCUMENT)).toContain("\"tracks\"");
        expect(files.get(DOCUMENT)?.endsWith("\n")).toBe(true);
    });

    it("seeds an empty track list rather than leaving the project with no fallbacks", async () => {
        const { service } = await createHarness("{\n  \"schemaVersion\": 1,\n  \"tracks\": []\n}\n");

        expect(service.listTracks()).toHaveLength(3);
    });

    it("reads a stored custom track back after the built-ins", async () => {
        const stored = JSON.stringify({
            schemaVersion: 1,
            tracks: [{ id: "ambience", name: "Ambience", channel: "bgm", gain: 0.5, fadeInMs: 1500, fadeOutMs: 1500, loop: true }],
        });
        const { service } = await createHarness(stored);

        expect(service.listTracks().map(track => track.id)).toEqual([
            AUDIO_TRACK_ID_MUSIC, AUDIO_TRACK_ID_SFX, AUDIO_TRACK_ID_VOICE, "ambience",
        ]);
        expect(service.getTrack("ambience")).toMatchObject({ channel: "bgm", gain: 0.5, loop: true });
    });

    it("writes canonical bytes", async () => {
        const { service, files } = await createHarness();

        service.createTrack({ name: "Ambience", channel: "bgm" });
        await service.flushPendingChanges();

        const text = files.get(DOCUMENT) ?? "";
        expect(text).toContain("\"name\": \"Ambience\"");
        // Key order is the encoder's, not the literal's: `channel` before `fadeInMs` before `gain`.
        const track = text.slice(text.indexOf("\"Ambience\"") - 200);
        expect(track.indexOf("\"channel\"")).toBeLessThan(track.indexOf("\"fadeInMs\""));
    });

    /** The canonical encoder refuses an explicit `undefined` by name. A custom track has no `builtin`. */
    it("saves a custom track without an undefined builtin flag", async () => {
        const { service, files } = await createHarness();

        const track = service.createTrack({ name: "Ambience" });
        await service.flushPendingChanges();

        expect("builtin" in track).toBe(false);
        expect(files.get(DOCUMENT)).toContain("\"builtin\": true");
        expect((files.get(DOCUMENT)?.match(/"builtin"/g) ?? [])).toHaveLength(3);
    });
});

describe("AudioTrackService mutations", () => {
    it("clamps whatever a caller asks for, so the invariants hold between saves too", async () => {
        const { service } = await createHarness();

        const track = service.createTrack({ name: "Loud", gain: 99, fadeInMs: -10 });

        expect(service.getTrack(track.id)).toMatchObject({ gain: 2, fadeInMs: 0 });
    });

    it("renames and re-tunes a built-in but holds it to its own bus", async () => {
        const { service } = await createHarness();

        service.updateTrack(AUDIO_TRACK_ID_MUSIC, { name: "Score", gain: 0.4, channel: "voice" });

        expect(service.getTrack(AUDIO_TRACK_ID_MUSIC)).toMatchObject({
            name: "Score", gain: 0.4, channel: "bgm", builtin: true,
        });
    });

    it("refuses to delete a built-in and deletes a custom track", async () => {
        const { service } = await createHarness();
        const track = service.createTrack({ name: "Ambience" });

        expect(service.deleteTrack(AUDIO_TRACK_ID_MUSIC)).toBe(false);
        expect(service.getTrack(AUDIO_TRACK_ID_MUSIC)).toBeDefined();
        expect(service.deleteTrack(track.id)).toBe(true);
        expect(service.getTrack(track.id)).toBeUndefined();
        expect(service.deleteTrack(track.id)).toBe(false);
    });

    it("places a duplicate directly after its source", async () => {
        const { service } = await createHarness();
        const first = service.createTrack({ name: "Ambience", gain: 0.5, loop: true });
        service.createTrack({ name: "UI" });

        const copy = service.duplicateTrack(first.id)!;

        expect(service.listTracks().map(track => track.name).slice(3)).toEqual(["Ambience", "Ambience 2", "UI"]);
        expect(copy).toMatchObject({ gain: 0.5, loop: true });
        expect(copy.id).not.toBe(first.id);
    });

    it("resolves a live id, and falls a dangling one back onto the built-in for its channel", async () => {
        const { service } = await createHarness();
        const track = service.createTrack({ name: "Ambience", channel: "bgm" });

        expect(service.resolveTrack(track.id).id).toBe(track.id);
        service.deleteTrack(track.id);
        expect(service.resolveTrack(track.id, "bgm").id).toBe(AUDIO_TRACK_ID_MUSIC);
        expect(service.resolveTrack(undefined, "voice").id).toBe(AUDIO_TRACK_ID_VOICE);
    });

    it("reports dirty and clean around a flush, and bumps the revision per mutation", async () => {
        const { service } = await createHarness();
        const dirtyStates: boolean[] = [];
        service.onDirtyChanged(value => dirtyStates.push(value));

        const before = service.getRevision();
        service.createTrack({ name: "Ambience" });
        expect(service.isDirty()).toBe(true);
        expect(service.getRevision()).toBe(before + 1);

        await service.flushPendingChanges();
        expect(service.isDirty()).toBe(false);
        expect(dirtyStates).toEqual([true, false]);
    });

    it("tells its subscribers on every mutation", async () => {
        const { service } = await createHarness();
        const seen: number[] = [];
        const unsubscribe = service.onTracksChanged(tracks => seen.push(tracks.length));

        const track = service.createTrack({ name: "Ambience" });
        service.updateTrack(track.id, { gain: 0.5 });
        service.deleteTrack(track.id);
        unsubscribe();
        service.createTrack({ name: "UI" });

        expect(seen).toEqual([4, 4, 3]);
    });

    it("never lets a custom track be dragged in front of a built-in", async () => {
        const { service } = await createHarness();
        const ambience = service.createTrack({ name: "Ambience" });
        const ui = service.createTrack({ name: "UI" });

        service.moveTrack(ui.id, ambience.id);
        expect(service.listTracks().map(track => track.name).slice(3)).toEqual(["UI", "Ambience"]);

        service.moveTrack(ui.id, AUDIO_TRACK_ID_MUSIC);
        expect(service.listTracks().map(track => track.id).slice(0, 3))
            .toEqual([AUDIO_TRACK_ID_MUSIC, AUDIO_TRACK_ID_SFX, AUDIO_TRACK_ID_VOICE]);
    });
});

describe("AudioTrackService when the file on disk cannot be read", () => {
    const BROKEN = "{\"tracks\": [{\"id\": \"ambience\"";

    it("opens the project anyway, and reports the failure where the author can see it", async () => {
        const { service, unreadable } = await createHarness(BROKEN);

        expect(unreadable).toHaveBeenCalledTimes(1);
        expect(unreadable.mock.calls[0][0].path).toBe("editor/audio-tracks.json");
        expect(service.listTracks()).toHaveLength(3);
    });

    /** Writing the bare seed over it would turn "unreadable" into "the author's tracks are gone". */
    it("refuses to write, rather than replacing it with the defaults", async () => {
        const { service, files } = await createHarness(BROKEN);

        await expect(service.save(service.getDocument())).rejects.toThrow(/could not be read/);
        await expect(service.flushPendingChanges()).resolves.toBeUndefined();
        expect(files.get(DOCUMENT)).toBe(BROKEN);
    });

    it("leaves the original bytes in place and keeps a copy", async () => {
        const { files } = await createHarness(BROKEN);

        expect(files.get(DOCUMENT)).toBe(BROKEN);
        const quarantined = [...files.keys()].filter(path => path.includes("quarantine"));
        expect(quarantined).toHaveLength(1);
        expect(files.get(quarantined[0])).toBe(BROKEN);
    });

    /** These services are singletons, so the refusal has to be per-project, not per-process. */
    it("does not follow the author into the next project they open", async () => {
        const broken = await createHarness(BROKEN);

        const healthy = await createHarness(undefined, broken.service);

        expect(healthy.files.get(DOCUMENT)).toContain("\"tracks\"");
        healthy.service.createTrack({ name: "Ambience" });
        await expect(healthy.service.flushPendingChanges()).resolves.toBeUndefined();
    });
});
