// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StoryActionPayload } from "@shared/types/story";
import { AudioActionEditor } from "./StorySceneActionInspector";

/**
 * The inspector of an audio row whose fade, volume and rate were never typed.
 *
 * A `/sound locker.wav` row stores none of the three, and its inspector drew three empty boxes - no
 * value, no placeholder - while the game plays it with no fade, at full volume, at normal speed. The
 * boxes now show those answers greyed, as placeholders: the row still stores nothing, so the markup
 * must carry them as `placeholder` and never as `value`.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/i18n")>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/story/useProjectAudioTracks", async () => {
    const { BUILTIN_AUDIO_TRACKS } = await import("@shared/types/audioTrack");
    return { useProjectAudioTracks: () => [...BUILTIN_AUDIO_TRACKS] };
});

vi.mock("./AssetField", () => ({
    AssetField: () => null,
}));

vi.mock("@/lib/components/elements", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/components/elements")>()),
    Select: () => null,
}));

type AudioPayload = Extract<StoryActionPayload, { action: "audio" }>;

function markupOf(payload: Partial<AudioPayload>): Document {
    const html = renderToStaticMarkup(
        <AudioActionEditor
            payload={{ action: "audio", operation: "playSound", assetId: "locker", objectName: "locker", ...payload } as AudioPayload}
            scene={null}
            blockId="row-4"
            onChange={() => undefined}
        />,
    );
    return new DOMParser().parseFromString(html, "text/html");
}

function field(doc: Document, label: string): HTMLInputElement | HTMLButtonElement {
    const control = doc.querySelector<HTMLInputElement | HTMLButtonElement>(`[aria-label="${label}"]`);
    if (!control) {
        throw new Error(`no control named ${label}`);
    }
    return control;
}

describe("the audio row inspector's empty fields", () => {
    it("shows the fade, volume and rate a /sound row plays with, greyed", () => {
        const doc = markupOf({});
        const shown = (label: string) => {
            const control = field(doc, label);
            return control instanceof HTMLInputElement ? control.placeholder : control.textContent;
        };
        expect(shown("storyInspector.audio.fade")).toBe("0");
        expect(shown("storyInspector.audio.volume")).toBe("1");
        expect(shown("storyInspector.audio.rate")).toBe("1");
    });

    it("stores nothing for them: the defaults are placeholders, not values", () => {
        const doc = markupOf({});
        for (const label of ["storyInspector.audio.fade", "storyInspector.audio.volume", "storyInspector.audio.rate"]) {
            const control = field(doc, label);
            if (control instanceof HTMLInputElement) {
                expect(control.value).toBe("");
            }
        }
    });

    it("shows a typed value as the value", () => {
        const doc = markupOf({ fadeMs: 1200, volume: 0.7, rate: 1.5 });
        const value = (label: string) => {
            const control = field(doc, label);
            return control instanceof HTMLInputElement ? control.value : control.textContent;
        };
        expect(value("storyInspector.audio.fade")).toBe("1.2");
        expect(value("storyInspector.audio.volume")).toBe("0.7");
        expect(value("storyInspector.audio.rate")).toBe("1.5");
    });
});
