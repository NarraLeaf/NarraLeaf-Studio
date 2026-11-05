// @vitest-environment jsdom
/**
 * A scene's music is set the way a page's is: a Music section holding one picker row, and under it
 * the playback options folded beneath a line that states them. The volume reads as it is stored,
 * 0 to 1, as every other sound's does.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { type ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryScene, StorySceneBgm, StorySceneUpdate } from "@shared/types/story";
import type { CustomFieldProps } from "../framework/types";
import { storyScenePropertySchema, type StorySceneEditorContext } from "./storySceneSchema";

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    // Echoes a key with its arguments, so the test reads which phrase was chosen and with what.
    useTranslation: () => ({
        t: (key: string, args?: Record<string, unknown>) =>
            args ? `${key}(${Object.entries(args).map(([name, value]) => `${name}=${value}`).join(",")})` : key,
        locale: "en",
    }),
}));

vi.mock("@/apps/workspace/context", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useWorkspace: () => ({ context: null, isInitialized: false }),
    useOptionalWorkspace: () => null,
}));

vi.mock("@/apps/workspace/modules/assets/state/useAssetSetPickerSource", () => ({
    useAssetSetPickerSource: () => ({ virtualGroups: undefined, resolveAssetPreviewUrl: undefined, findSet: () => null }),
}));

vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: () => ({ url: null }),
}));

vi.mock("@/apps/workspace/modules/assets/components/AssetSelector", () => ({
    AssetSelector: () => null,
}));

afterEach(cleanup);

type Field = { id: string; type: string; title?: string; fields?: Field[]; component?: ComponentType<CustomFieldProps<StorySceneEditorContext>> };

const fields = () => (storyScenePropertySchema((key: string) => key) as unknown as { fields: Field[] }).fields;

function renderMusic(bgm?: StorySceneBgm) {
    const updates: StorySceneUpdate[] = [];
    const Component = fields().find(field => field.id === "storyScene.music")!.fields![0].component!;
    const scene = { id: "s", name: "S", rootBlockIds: [], blocks: {}, ...(bgm ? { bgm } : {}) } as unknown as StoryScene;
    const data: StorySceneEditorContext = {
        scene,
        onUpdateScene: patch => {
            updates.push(patch);
            return true;
        },
    };
    render(<Component data={data} onChange={() => undefined} />);
    const fold = () => screen.getByRole("button", { expanded: false });
    return { updates, fold };
}

/** The typed box among the controls a label names (the volume's slider carries the same name). */
const textBox = (label: string) => screen.getAllByLabelText(label)
    .find(element => element instanceof HTMLInputElement && element.type === "text") as HTMLInputElement;

const daily: StorySceneBgm = { assetId: "bgm-daily", volume: 0.8, fadeMs: 1000 };

describe("scene music section", () => {
    it("is a section of its own, titled Music, after the default background", () => {
        const all = fields();
        const section = all.find(field => field.id === "storyScene.music");
        expect(section?.type).toBe("section");
        expect(section?.title).toBe("properties.music.title");
        expect(section?.fields?.map(field => field.id)).toEqual(["storyScene.music.editor"]);
        expect(all.map(field => field.id).slice(-2)).toEqual(["storyScene.defaultBackground", "storyScene.music"]);
    });

    it("offers the picker row and nothing under it while no music is chosen", () => {
        renderMusic();
        expect(screen.getByText("properties.music.none")).not.toBeNull();
        expect(screen.getByText("properties.music.chooseScene")).not.toBeNull();
        expect(screen.queryByRole("button", { expanded: false })).toBeNull();
    });

    it("folds the options under one line that states them, the volume as stored", () => {
        const { fold } = renderMusic(daily);
        expect(fold().textContent).toBe(
            "properties.interactionSound.summary(volume=0.8,track=project.audio.builtinName.bgm)"
            + " · properties.music.loops · properties.music.fadeSummary(seconds=1)",
        );
        expect(screen.queryByText("properties.interactionSound.volume")).toBeNull();
    });

    it("opens to labelled options: volume 0 to 1, track, the player volume it follows, loop, fade", () => {
        const { fold } = renderMusic(daily);
        fireEvent.click(fold());
        for (const label of ["properties.interactionSound.volume", "properties.interactionSound.track", "properties.music.loop", "properties.music.fade"]) {
            expect(screen.getByText(label)).not.toBeNull();
        }
        expect(textBox("properties.interactionSound.volume").value).toBe("0.8");
        expect(textBox("properties.music.fade").value).toBe("1");
        expect(screen.getByText("project.audio.builtinName.bgm · project.audio.slider.bgm")).not.toBeNull();
    });

    it("writes a volume typed into the box as the 0 to 1 value it reads, keeping the rest of the record", () => {
        const { fold, updates } = renderMusic(daily);
        fireEvent.click(fold());
        const volumeBox = textBox("properties.interactionSound.volume");
        fireEvent.change(volumeBox, { target: { value: "0.5" } });
        fireEvent.blur(volumeBox);
        expect(updates).toEqual([{ bgm: { assetId: "bgm-daily", volume: 0.5, fadeMs: 1000 } }]);
    });

    it("writes the fade in milliseconds, and no fade as an absent field", () => {
        const { fold, updates } = renderMusic(daily);
        fireEvent.click(fold());
        const fadeBox = textBox("properties.music.fade");
        fireEvent.change(fadeBox, { target: { value: "1.5" } });
        fireEvent.blur(fadeBox);
        fireEvent.change(fadeBox, { target: { value: "0" } });
        fireEvent.blur(fadeBox);
        expect(updates).toEqual([
            { bgm: { assetId: "bgm-daily", volume: 0.8, fadeMs: 1500 } },
            { bgm: { assetId: "bgm-daily", volume: 0.8 } },
        ]);
    });

    it("clears the whole record from the picker row", () => {
        const { updates } = renderMusic(daily);
        fireEvent.click(screen.getByText("common.clear"));
        expect(updates).toEqual([{ bgm: null }]);
    });
});
