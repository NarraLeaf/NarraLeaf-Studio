/**
 * Reading a save written while the camera and the sounds still had positional names.
 *
 * Until the compiler named them (`stableElementIds.ts`), the engine numbered both by where a walk of
 * the action tree from the story's entry scene first met them: the camera and every sound a row
 * acts on took `e-<n>`, the index of the element in that walk, and a scene's music that nothing
 * else touched took `s-<n>`, its index among the scenes' music. A save holds the camera's pan, zoom
 * and darkness under that name, and a sound's level, its place in the track and the scene's pointer
 * to the music it was playing. Every save a game shipped before this change wrote them so.
 *
 * Read against today's names those saves found nothing, or - worse - found whatever element now
 * sits at that number, and the state went onto it. So a save is translated before anything looks
 * it up, by three rules, strongest first:
 *
 * 1. **The camera by what it holds.** It was the only element a save could carry under a positional
 *    name with a transform and no other state (`{transformState, loop}`): every image, text and layer
 *    has been named from the document for as long as saves have carried them, and a sound holds no
 *    transform. So a positional entry of that shape is the camera, whatever number it carries and
 *    whatever has changed since.
 * 2. **A scene's music by the scene that pointed at it.** A scene's state names the music it was
 *    playing. Where that scene can play only one track - its own configured music, or a single
 *    `/bgm` row - the pointer can mean nothing else.
 * 3. **The walk again, where the walk is the same.** The engine's numbering is a pure function of the
 *    compiled story and its entry scene, and naming an element does not move it in the walk - so the
 *    running story, walked the same way, gives back exactly the numbers the save was written under.
 *    Only when it is provably the same story: the save's record names the same document hash as this
 *    build (so no row, no scene's music, no character changed), and the engine's own hash of the
 *    story as entered matches (so it was entered at the same scene).
 *
 * Rule 3 is the one a shipped game lives on. A save from another version of the document is not
 * applied as written unless the author chose that ("force"): by default it starts the story again at
 * its line (see `saveCompatibility.ts`), which reads none of these names. So the saves that reach
 * this file as written are, by default, saves of this very document - the walk's case - and the
 * first two rules are what is left for an author who forces older ones through.
 *
 * What none of the three can place is refused rather than guessed. The exceptions are a clip in the
 * save's audio record, which the engine itself drops when the story no longer has it, and a backlog
 * line's restore point, which is let go of so that stepping back to that line declines instead of
 * restoring a stage it cannot name.
 */

import { Scene, type SavedGame } from "narraleaf-react";
import { isSoundElementId, STORY_CAMERA_ELEMENT_ID } from "@/lib/ui-editor/runtime/game/stableElementIds";

/** The engine's positional names: `e-<n>` for elements, `s-<n>` for scene music nothing acted on. */
const POSITIONAL_ID = /^[es]-\d+$/;

export function isPositionalElementId(id: unknown): id is string {
    return typeof id === "string" && POSITIONAL_ID.test(id);
}

/** What the running story says about names a save may hold from before they were stable. */
export type LegacyElementIdTable = {
    /**
     * The engine's own numbering of the running story, as a build that did not name these elements
     * would have assigned it: old positional id to today's id. Only the camera and the sounds are in
     * it - nothing else a save can hold was ever positional.
     */
    numbering: ReadonlyMap<string, string>;
    /** Every track each scene can play, keyed by the scene's element id (`nl:scene:<id>`). */
    sceneMusic: ReadonlyMap<string, readonly string[]>;
};

/** The parts of an engine story the walk reads. Structural, so a compiled story stands in for one. */
export type LegacyWalkStory = {
    entryScene: {
        getSceneRoot(): unknown;
        getAllChildrenElements(story: unknown, action: unknown): { getId(): string }[];
        getAllChildren(story: unknown, action: unknown): unknown[];
    } | null;
};

/**
 * The numbering the engine gives a constructed story, recomputed.
 *
 * Mirrors `Scene.assignElementId`, which runs on the entry scene: `e-<i>` by index in
 * `getAllChildrenElements` from the scene root, then `s-<j>` by index among the music the actions
 * own, counting a track that already had an `e-` name as well. Names given by the host do not
 * change either walk, so a story that names its camera and sounds walks exactly as one that did not.
 *
 * `ownedSounds` is the engine's `Scene.getOwnedSounds`, passed in so this file does not reach into
 * the engine for a static.
 */
export function buildLegacyElementIdTable(
    story: LegacyWalkStory,
    ownedSounds: (action: unknown) => readonly { getId(): string }[],
): LegacyElementIdTable {
    const numbering = new Map<string, string>();
    const sceneMusic = new Map<string, string[]>();
    const scene = story.entryScene;
    if (!scene) {
        return { numbering, sceneMusic };
    }
    const root = scene.getSceneRoot();
    const elements = scene.getAllChildrenElements(story, root);
    const elementIndex = new Map<unknown, number>();
    elements.forEach((element, index) => {
        elementIndex.set(element, index);
        const id = element.getId();
        if (id === STORY_CAMERA_ELEMENT_ID || isSoundElementId(id)) {
            numbering.set(`e-${index}`, id);
        }
    });
    const owned = new Set<{ getId(): string }>();
    for (const action of scene.getAllChildren(story, root)) {
        for (const sound of ownedSounds(action)) {
            owned.add(sound);
        }
    }
    let index = 0;
    for (const sound of owned) {
        const id = sound.getId();
        // A track some row also acts on was an element of the walk, and kept the `e-` name it got
        // there; the `s-` count still moved past it.
        if (!elementIndex.has(sound) && isSoundElementId(id)) {
            numbering.set(`s-${index}`, id);
        }
        const sceneId = owningSceneElementId(id);
        if (sceneId) {
            const tracks = sceneMusic.get(sceneId) ?? [];
            if (!tracks.includes(id)) {
                tracks.push(id);
            }
            sceneMusic.set(sceneId, tracks);
        }
        index++;
    }
    return { numbering, sceneMusic };
}

/** One table per constructed story: the walk is the same every time it is asked. */
const tablesByStory = new WeakMap<object, LegacyElementIdTable>();

/**
 * The table for a story the engine has constructed - the live game's, which is the one a save is
 * about to be applied to. Null for anything that is not one.
 */
export function legacyElementIdTableFor(story: unknown): LegacyElementIdTable | null {
    if (!story || typeof story !== "object" || !("entryScene" in story)) {
        return null;
    }
    const cached = tablesByStory.get(story);
    if (cached) {
        return cached;
    }
    const table = buildLegacyElementIdTable(
        story as LegacyWalkStory,
        action => (Scene as unknown as { getOwnedSounds(action: unknown): { getId(): string }[] }).getOwnedSounds(action),
    );
    tablesByStory.set(story, table);
    return table;
}

/**
 * The scene a music track belongs to, as the scene's own element id: `nl:scene:<id>:music` and
 * `nl:bgm:<id>:<row>` to `nl:scene:<id>`, and the same for a row launch's opening scene.
 */
function owningSceneElementId(soundId: string): string | null {
    const parts = soundId.split(":");
    if (parts[0] !== "nl") {
        return null;
    }
    if (parts[1] === "scene" && parts[3] === "music" && parts.length === 4) {
        return `nl:scene:${parts[2]}`;
    }
    if (parts[1] === "bgm" && parts.length >= 4) {
        return `nl:scene:${parts[2]}`;
    }
    if (parts[1] === "launch" && parts.length >= 6) {
        const prefix = parts.slice(0, 4).join(":");
        if (parts[4] === "scene" && parts[5] === "music") {
            return `${prefix}:scene`;
        }
        if (parts[4] === "bgm") {
            return `${prefix}:scene`;
        }
    }
    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The camera's state and nothing else: a transform, perhaps a loop, and none of an image's own state. */
function isCameraData(data: unknown): boolean {
    return isRecord(data)
        && isRecord(data.transformState)
        && Object.keys(data).every(key => key === "transformState" || key === "loop");
}

/** A sound's own state: its level, rate and whether it is paused or muted. */
function isSoundData(data: unknown): boolean {
    return isRecord(data) && isRecord(data.state) && Object.keys(data).every(key => key === "state");
}

/** A scene's element id, the kind whose state can point at music. */
function isSceneElementId(id: string): boolean {
    const parts = id.split(":");
    return (parts[0] === "nl" && parts[1] === "scene" && parts.length === 3)
        || (parts[0] === "nl" && parts[1] === "launch" && parts.length === 5 && parts[4] === "scene");
}

type StateLike = {
    elementStates?: unknown;
    stage?: unknown;
};

/**
 * Today's names for one serialized game state - the save's own, or a backlog line's restore point.
 * Returns the ids it could not place; the state is rewritten only when that list is empty.
 */
function translateState(
    state: StateLike,
    table: LegacyElementIdTable,
    numberingApplies: boolean,
): { state: StateLike; unmappable: string[] } {
    const unmappable = new Set<string>();
    const renames = new Map<string, string>();
    const rename = (from: string, to: string): void => {
        const earlier = renames.get(from);
        if (earlier !== undefined && earlier !== to) {
            unmappable.add(from);
            return;
        }
        renames.set(from, to);
    };
    const byNumbering = (id: string): string | undefined => (numberingApplies ? table.numbering.get(id) : undefined);

    const elementStates = Array.isArray(state.elementStates) ? state.elementStates : [];
    const entries = elementStates.filter(isRecord);

    // 1. The camera, by what it holds.
    const cameras = entries.filter(entry => isPositionalElementId(entry.id) && isCameraData(entry.data));
    if (cameras.length === 1) {
        rename(cameras[0].id as string, STORY_CAMERA_ELEMENT_ID);
    } else {
        cameras.forEach(entry => unmappable.add(entry.id as string));
    }

    // 2. A scene's music, by the scene that pointed at it - or by the walk, when the walk agrees.
    for (const entry of entries) {
        if (typeof entry.id !== "string" || !isSceneElementId(entry.id)) {
            continue;
        }
        const music = isRecord(entry.data) && isRecord(entry.data.state) ? entry.data.state.backgroundMusic : undefined;
        const pointer = isRecord(music) ? music.id : undefined;
        if (!isPositionalElementId(pointer)) {
            continue;
        }
        const tracks = table.sceneMusic.get(entry.id) ?? [];
        const walked = byNumbering(pointer);
        const target = walked && tracks.includes(walked) ? walked : tracks.length === 1 ? tracks[0] : undefined;
        if (target) {
            rename(pointer, target);
        } else {
            unmappable.add(pointer);
        }
    }

    // 3. Every other sound the save holds state for, by the walk.
    for (const entry of entries) {
        const id = entry.id;
        if (!isPositionalElementId(id) || renames.has(id) || unmappable.has(id)) {
            continue;
        }
        const target = renames.get(id) ?? byNumbering(id);
        if (target && isSoundElementId(target) && isSoundData(entry.data)) {
            rename(id, target);
        } else {
            unmappable.add(id);
        }
    }

    const stage = isRecord(state.stage) ? state.stage : undefined;
    // Nothing else on the stage was ever named by position; one that is cannot be placed.
    for (const scene of Array.isArray(stage?.scenes) ? stage.scenes : []) {
        if (!isRecord(scene)) {
            continue;
        }
        if (isPositionalElementId(scene.sceneId)) {
            unmappable.add(scene.sceneId);
        }
        const layers = isRecord(scene.elements) ? scene.elements.layers : undefined;
        if (isRecord(layers)) {
            for (const [layerId, displayables] of Object.entries(layers)) {
                if (isPositionalElementId(layerId)) {
                    unmappable.add(layerId);
                }
                if (Array.isArray(displayables)) {
                    displayables.filter(isPositionalElementId).forEach(id => unmappable.add(id));
                }
            }
        }
    }
    for (const key of ["videos", "vfx"] as const) {
        const list = stage?.[key];
        if (Array.isArray(list)) {
            for (const item of list) {
                if (Array.isArray(item) && isPositionalElementId(item[0])) {
                    unmappable.add(item[0]);
                }
            }
        }
    }

    if (unmappable.size > 0) {
        return { state, unmappable: [...unmappable].sort() };
    }
    if (renames.size === 0 && !hasPositionalAudio(stage)) {
        return { state, unmappable: [] };
    }

    const renamed = (id: unknown): unknown => (typeof id === "string" ? renames.get(id) ?? id : id);
    const nextStates = elementStates.map(entry => {
        if (!isRecord(entry)) {
            return entry;
        }
        const next: Record<string, unknown> = { ...entry, id: renamed(entry.id) };
        if (typeof entry.id === "string" && isSceneElementId(entry.id) && isRecord(entry.data) && isRecord(entry.data.state)
            && isRecord(entry.data.state.backgroundMusic)) {
            next.data = {
                ...entry.data,
                state: {
                    ...entry.data.state,
                    backgroundMusic: { ...entry.data.state.backgroundMusic, id: renamed(entry.data.state.backgroundMusic.id) },
                },
            };
        }
        return next;
    });
    let nextStage = stage;
    const audio = isRecord(stage?.audio) ? stage.audio : undefined;
    if (stage && audio && Array.isArray(audio.sounds)) {
        nextStage = {
            ...stage,
            audio: {
                ...audio,
                // A clip the walk cannot name is left out, as the engine leaves out one the story no
                // longer has: the clip does not come back, and nothing else plays in its place.
                sounds: audio.sounds.flatMap(item => {
                    if (!Array.isArray(item) || !isPositionalElementId(item[0])) {
                        return [item];
                    }
                    const target = renames.get(item[0]) ?? byNumbering(item[0]);
                    return target && isSoundElementId(target) ? [[target, ...item.slice(1)]] : [];
                }),
            },
        };
    }
    return { state: { ...state, elementStates: nextStates, stage: nextStage }, unmappable: [] };
}

function hasPositionalAudio(stage: Record<string, unknown> | undefined): boolean {
    const audio = isRecord(stage?.audio) ? stage.audio : undefined;
    return Array.isArray(audio?.sounds) && audio.sounds.some(item => Array.isArray(item) && isPositionalElementId(item[0]));
}

export type LegacyTranslation = {
    savedGame: SavedGame;
    /** Positional ids the save holds state under that none of the rules could place. Empty when it loads. */
    unmappable: string[];
};

/**
 * The save with every positional name it holds replaced by today's, or the names that could not be.
 *
 * `numberingApplies` is the caller's finding that the running story is the one the save was written
 * against (see rule 3 above). The save is returned untouched when it holds nothing positional, which
 * is every save written since the names became stable.
 */
export function translateLegacyElementIds(
    savedGame: SavedGame,
    table: LegacyElementIdTable,
    numberingApplies: boolean,
): LegacyTranslation {
    const game = savedGame.game as unknown as Record<string, unknown>;
    const main = translateState(game as StateLike, table, numberingApplies);
    if (main.unmappable.length > 0) {
        return { savedGame, unmappable: main.unmappable };
    }
    let history = game.history;
    if (Array.isArray(history)) {
        history = history.map(entry => {
            if (!isRecord(entry) || !isRecord(entry.snapshot)) {
                return entry;
            }
            const translated = translateState(entry.snapshot as StateLike, table, numberingApplies);
            // A restore point that cannot be named is dropped: stepping back to that line then
            // declines, which the engine already does for a line that never had one.
            return translated.unmappable.length > 0
                ? { ...entry, snapshot: null }
                : (translated.state === entry.snapshot ? entry : { ...entry, snapshot: translated.state });
        });
    }
    if (main.state === game && history === game.history) {
        return { savedGame, unmappable: [] };
    }
    return {
        savedGame: { ...savedGame, game: { ...(main.state as object), history } } as unknown as SavedGame,
        unmappable: [],
    };
}
