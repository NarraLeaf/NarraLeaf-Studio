/**
 * The names the story compiler gives the camera and the sounds a save can hold, and the one rule a
 * save loader needs to recognise them.
 *
 * Every element a save carries state for is named from what it is - its scene and the name the
 * author gave it, or its row - so that writing a line elsewhere cannot hand its name to something
 * else. The camera and the sounds were the last ones the engine still named by position in a walk of
 * the action tree (`e-<n>`, and `s-<n>` for a scene's music), and those numbers moved whenever the
 * story was entered somewhere else or a line was added ahead of them. See `legacyElementIds.ts` for
 * how a save written while they did is read.
 *
 * Kept apart from the compiler because the save loader reads them too, and has no reason to load
 * the compiler to do it.
 */

/** The story's one stage camera. A singleton, like the narrator (`nl:character:narrator`). */
export const STORY_CAMERA_ELEMENT_ID = "nl:camera";

/** The music a scene is configured to play, owned by the scene like its background and layers. */
export function sceneMusicElementId(sceneElementId: string): string {
    return `${sceneElementId}:music`;
}

/** The scene-scoped kinds a sound is named under: a `/bgm` row's track, and a `/sound` row's handle. */
export const SOUND_ELEMENT_KINDS = ["bgm", "sound"] as const;

/**
 * Whether an id names a sound the compiler built: a scene's own music, a `/bgm` row's track or a
 * `/sound` handle, in a scene of the document or in a row launch's opening scene.
 */
export function isSoundElementId(id: string): boolean {
    const parts = id.split(":");
    if (parts[0] !== "nl") {
        return false;
    }
    // nl:scene:<scene>:music, and nl:launch:<scene>:<row>:scene:music for a row launch's own scene.
    if (parts[parts.length - 1] === "music"
        && ((parts[1] === "scene" && parts.length === 4) || (parts[1] === "launch" && parts[4] === "scene"))) {
        return true;
    }
    if (parts[1] === "launch") {
        // nl:launch:<scene>:<row>:<kind>:<name>
        return (SOUND_ELEMENT_KINDS as readonly string[]).includes(parts[4]);
    }
    return (SOUND_ELEMENT_KINDS as readonly string[]).includes(parts[1]);
}
