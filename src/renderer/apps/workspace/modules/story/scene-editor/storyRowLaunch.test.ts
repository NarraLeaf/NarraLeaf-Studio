import { describe, expect, it, vi } from "vitest";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";
import { launchStoryRowInDevMode, resolveLaunchSnapshotId } from "./storyRowLaunch";

/**
 * What a story row's play control sends to Dev Mode.
 *
 * The case worth a test is the scene that has no Scene Snapshot, because the first version of this
 * refused to launch there: it opened the snapshot panel and raised a warning instead, so the control
 * did nothing on the first press and the author had to author a snapshot before it would play. A
 * launch with no snapshot is now an ordinary launch, and `snapshotId` is simply absent from it.
 *
 * The assertions are therefore two-sided on purpose - the request that goes out AND the two things
 * that must not happen (no panel revealed, nothing written to the story document).
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
        expect(resolveLaunchSnapshotId([], undefined)).toBeUndefined();
        expect(resolveLaunchSnapshotId([], "deleted")).toBeUndefined();
    });

    it("uses the author's selection", () => {
        expect(resolveLaunchSnapshotId([{ id: "a" }, { id: "b" }], "b")).toBe("b");
    });

    it("falls back to the first when the selection names a snapshot that is gone", () => {
        expect(resolveLaunchSnapshotId([{ id: "a" }, { id: "b" }], "removed")).toBe("a");
        expect(resolveLaunchSnapshotId([{ id: "a" }, { id: "b" }], undefined)).toBe("a");
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

    it("carries the selected snapshot when the scene has one", () => {
        const { context, launch } = buildContext(
            [{ id: "morning", name: "Morning" }, { id: "night", name: "Night" }],
            "night",
        );

        launchStoryRowInDevMode({ context, storyId: STORY_ID, sceneId: SCENE_ID, blockId: BLOCK_ID });

        expect(launch).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: "night" }));
    });

    it("carries the first snapshot when the author has selected none", () => {
        const { context, launch } = buildContext([{ id: "morning", name: "Morning" }]);

        launchStoryRowInDevMode({ context, storyId: STORY_ID, sceneId: SCENE_ID, blockId: BLOCK_ID });

        expect(launch).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: "morning" }));
    });
});
