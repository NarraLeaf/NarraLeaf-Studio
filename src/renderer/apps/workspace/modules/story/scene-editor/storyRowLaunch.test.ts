import { describe, expect, it, vi } from "vitest";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { DECLARED_DEFAULTS_ENTRY } from "../../story-snapshots/storySnapshotSelection";
import type { StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";
import { launchStoryRowInDevMode, resolveLaunchSnapshotId } from "./storyRowLaunch";

/**
 * What a story row's play control sends to Dev Mode.
 *
 * Two things are being held down here. The first is that a scene with no Scene Snapshot launches at
 * all: the original version refused, opening the snapshot panel and raising a warning instead, so
 * the control did nothing on the first press and the author had to author a snapshot before it would
 * play. The second is that a scene WITH snapshots launches under the one the panel shows selected
 * and under no other - a list that quietly selected the first would put a stale set of values behind
 * the control with nothing on screen having said so.
 *
 * The assertions are two-sided on purpose: the request that goes out, and the two things that must
 * not happen (no panel revealed, nothing written to the story document).
 */

const STORY_ID = "chapter-one" as StoryId;
const SCENE_ID = "rooftop" as StorySceneId;
const BLOCK_ID = "row-42" as StoryBlockId;

function buildContext(snapshots: { id: string; name: string }[], selected?: string) {
    const panelState: Record<string, Record<string, string>> = {};
    if (selected) {
        panelState["story:snapshot:selected"] = { [`${STORY_ID}::${SCENE_ID}`]: selected };
    }
    const launch = vi.fn(async () => "running");
    const show = vi.fn();
    const warning = vi.fn();
    const createSceneSnapshot = vi.fn(() => "made-one");
    const services = {
        [Services.Story]: {
            listSceneSnapshots: () => snapshots,
            createSceneSnapshot,
        },
        [Services.PanelState]: {
            getPanelState: (key: string) => panelState[key],
            setPanelState: (key: string, partial: Record<string, string>) => {
                panelState[key] = { ...(panelState[key] ?? {}), ...partial };
            },
        },
        [Services.DevMode]: { launch },
        [Services.UI]: { panels: { show }, notifications: { warning } },
    } as Record<string, unknown>;
    const context = {
        services: { get: (key: string) => services[key] },
    } as unknown as WorkspaceContext;
    return { context, launch, show, warning, createSceneSnapshot };
}

describe("resolveLaunchSnapshotId", () => {
    it("has no answer for a scene that holds no snapshots", () => {
        expect(resolveLaunchSnapshotId([], DECLARED_DEFAULTS_ENTRY)).toBeUndefined();
    });

    it("uses the author's selection", () => {
        expect(resolveLaunchSnapshotId([{ id: "a" }, { id: "b" }], "b")).toBe("b");
    });

    it("applies none for the declared-defaults entry, whatever the scene holds", () => {
        expect(resolveLaunchSnapshotId([{ id: "a" }, { id: "b" }], DECLARED_DEFAULTS_ENTRY)).toBeUndefined();
    });

    it("applies none when the selection names a snapshot that is gone", () => {
        // Not the first snapshot: the deleted one's replacement is the entry the panel now shows.
        expect(resolveLaunchSnapshotId([{ id: "a" }, { id: "b" }], "removed")).toBeUndefined();
    });
});

describe("launchStoryRowInDevMode", () => {
    it("launches a scene with no snapshots, and neither reveals the panel nor writes one", () => {
        const { context, launch, show, warning, createSceneSnapshot } = buildContext([]);

        launchStoryRowInDevMode({ context, storyId: STORY_ID, sceneId: SCENE_ID, blockId: BLOCK_ID });

        expect(launch).toHaveBeenCalledTimes(1);
        expect(launch).toHaveBeenCalledWith({
            kind: "story",
            storyId: STORY_ID,
            sceneId: SCENE_ID,
            blockId: BLOCK_ID,
            snapshotId: undefined,
        });
        expect(show).not.toHaveBeenCalled();
        expect(warning).not.toHaveBeenCalled();
        expect(createSceneSnapshot).not.toHaveBeenCalled();
    });

    it("carries the selected snapshot when the author has picked one", () => {
        const { context, launch } = buildContext(
            [{ id: "morning", name: "Morning" }, { id: "night", name: "Night" }],
            "night",
        );

        launchStoryRowInDevMode({ context, storyId: STORY_ID, sceneId: SCENE_ID, blockId: BLOCK_ID });

        expect(launch).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: "night" }));
    });

    it("carries no snapshot when the author has picked none, even though the scene holds some", () => {
        const { context, launch } = buildContext([{ id: "morning", name: "Morning" }]);

        launchStoryRowInDevMode({ context, storyId: STORY_ID, sceneId: SCENE_ID, blockId: BLOCK_ID });

        expect(launch).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: undefined }));
    });

    it("carries no snapshot once the author selects the declared-defaults entry back", () => {
        const { context, launch } = buildContext(
            [{ id: "morning", name: "Morning" }],
            DECLARED_DEFAULTS_ENTRY,
        );

        launchStoryRowInDevMode({ context, storyId: STORY_ID, sceneId: SCENE_ID, blockId: BLOCK_ID });

        expect(launch).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: undefined }));
    });
});
