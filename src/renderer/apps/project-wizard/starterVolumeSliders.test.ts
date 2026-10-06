/**
 * The Config page's BGM, Sound effects and Voice rows are three placements of one Volume slider
 * component, and each names the track it sets in the component's track parameter.
 *
 * That parameter is an audio track, so a placement picks its track from the project's tracks by
 * name instead of typing a track's id. What has to hold for the rows to keep working is that every
 * placement still names a track the project has - the three factory tracks, one row each - in the
 * English template and in the two generated from it.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getUIComponentLink, isUIComponentAudioTrackParam, type UIDocument } from "@shared/types/ui-editor/document";

const VOLUME_SLIDER = "79c6ced1-12f6-44c7-be92-4f127dbd00d5";
/** The row each placement sits in, by element id, and the factory track it sets. */
const ROWS: Record<string, string> = {
    "config-bgm-volume": "bgm",
    "config-sfx-volume": "sound",
    "config-voice-volume": "voice",
};

const ROOT = path.join(process.cwd(), "resources/templates/skeleton");
const factoryTrackIds = (
    JSON.parse(fs.readFileSync(path.join(ROOT, "content/editor/audio-tracks.json"), "utf-8")) as {
        tracks: { id: string; builtin?: boolean }[];
    }
).tracks.filter(track => track.builtin).map(track => track.id);

describe.each(["content", "content.zh", "content.ja"])("the Volume slider in %s", tree => {
    const document = JSON.parse(fs.readFileSync(path.join(ROOT, tree, "editor/ui/uidoc.json"), "utf-8")) as UIDocument;
    const component = (document.components ?? []).find(candidate => candidate.id === VOLUME_SLIDER);

    it("takes its track as an audio track, falling back to the music track", () => {
        const track = component?.params?.find(param => param.id === "track");
        expect(track && isUIComponentAudioTrackParam(track)).toBe(true);
        expect(track?.defaultValue).toBe("bgm");
    });

    it("is placed once per factory track, each row naming its own", () => {
        const placements = Object.values(document.elements)
            .filter(element => getUIComponentLink(element)?.componentId === VOLUME_SLIDER)
            .map(element => [element.id, getUIComponentLink(element)?.params?.track]);

        expect(Object.fromEntries(placements)).toEqual(ROWS);
        expect([...Object.values(ROWS)].sort()).toEqual([...factoryTrackIds].sort());
    });
});
