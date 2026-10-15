// @vitest-environment jsdom
/**
 * Every sound's track picker says where the sound goes: under it, the track chain and the player
 * volume that governs it. A page's music and an element's hover and click sounds say it the way a
 * scene's music does (`storySceneSchema.test.tsx`), and the line follows the track the picker shows,
 * an author's own track among them.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useReducer } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_AUDIO_TRACKS, type ProjectAudioTrack } from "@shared/types/audioTrack";
import type { UIElement, UISurface } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { SurfaceMusicField } from "@/apps/workspace/modules/properties/fields/SurfaceMusicField";
import { InteractionSoundField } from "./InteractionSoundField";

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    // Keys back, not prose: what is asserted is which track and which slider are named.
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

/** An author's own track, routed into the seeded SFX track. */
const AMBIENCE: ProjectAudioTrack = { id: "t_ambience", name: "Ambience", parentId: "sound", volume: 1, loop: true };

vi.mock("./useProjectAudioTracks", () => ({
    useProjectAudioTracks: () => [...BUILTIN_AUDIO_TRACKS, AMBIENCE],
}));

afterEach(cleanup);

const SFX_LINE = "project.audio.builtinName.sound · project.audio.slider.sound";
const AMBIENCE_LINE = "Ambience → project.audio.builtinName.sound · project.audio.slider.sound";
const MUSIC_LINE = "project.audio.builtinName.bgm · project.audio.slider.bgm";

/** Every bus line on screen: each names one of the player's volumes, and nothing else does. */
const busLines = () => screen.queryAllByText(/project\.audio\.slider\./).map(element => element.textContent);

/** Picks a track from the open fold's track picker. */
function pickTrack(name: string) {
    fireEvent.click(screen.getByRole("button", { name: "properties.interactionSound.track" }));
    fireEvent.click(screen.getByRole("option", { name }));
}

/** An element's sound slots over a document that takes their writes, as the inspector holds them. */
function renderElementSounds(props: Record<string, unknown>) {
    let element = { id: "button", type: "nl.button", props } as unknown as UIElement;
    function Harness() {
        const [, redraw] = useReducer((count: number) => count + 1, 0);
        const documentService = {
            getDocument: () => ({ elements: { [element.id]: element } }),
            updateElementProps: (_id: string, patch: Record<string, unknown>) => {
                element = { ...element, props: { ...element.props, ...patch } };
                redraw();
            },
        } as unknown as UIDocumentService;
        return <InteractionSoundField data={{ element, elements: [element], documentService }} onChange={() => undefined} />;
    }
    render(<Harness />);
    return { props: (): Record<string, unknown> => element.props ?? {} };
}

/** A page's music over a document that takes its writes. */
function renderPageMusic(music?: Record<string, unknown>) {
    let surface = { id: "title", kind: "appSurface", settings: music ? { music } : {} } as unknown as UISurface;
    function Harness() {
        const [, redraw] = useReducer((count: number) => count + 1, 0);
        const documentService = {
            updateSurface: (_id: string, mutate: (draft: UISurface) => void) => {
                const draft = { ...surface, settings: { ...(surface.settings ?? {}) } } as UISurface;
                mutate(draft);
                surface = draft;
                redraw();
            },
        } as unknown as UIDocumentService;
        return <SurfaceMusicField data={{ surface, documentService }} onChange={() => undefined} />;
    }
    render(<Harness />);
    return { music: () => (surface.settings as { music?: unknown } | undefined)?.music };
}

describe("an element sound's track row", () => {
    it("says where the sound goes under the track picker once its options are open", () => {
        renderElementSounds({ clickSound: { assetId: "click" } });
        expect(busLines()).toEqual([]);
        fireEvent.click(screen.getByRole("button", { expanded: false }));
        expect(busLines()).toEqual([SFX_LINE]);
    });

    it("follows the track picked, an author's own track routed into SFX among them, and writes only the track", () => {
        const { props } = renderElementSounds({ clickSound: { assetId: "click" } });
        fireEvent.click(screen.getByRole("button", { expanded: false }));
        pickTrack("Ambience");
        expect(props().clickSound).toEqual({ assetId: "click", audioTrackId: "t_ambience" });
        expect(busLines()).toEqual([AMBIENCE_LINE]);
    });

    it("shows a line for each slot that has a clip, and none for a slot without one", () => {
        renderElementSounds({ hoverSound: { assetId: "hover", audioTrackId: "t_ambience" } });
        fireEvent.click(screen.getByRole("button", { expanded: false }));
        expect(busLines()).toEqual([AMBIENCE_LINE]);
        expect(screen.getByText("properties.interactionSound.chooseClick")).not.toBeNull();
    });
});

describe("a page's music track row", () => {
    it("says where the music goes under the track picker once its options are open", () => {
        renderPageMusic({ assetId: "theme" });
        expect(busLines()).toEqual([]);
        fireEvent.click(screen.getByRole("button", { expanded: false }));
        expect(busLines()).toEqual([MUSIC_LINE]);
    });

    it("follows the track picked, an author's own track routed into SFX among them, and writes only the track", () => {
        const { music } = renderPageMusic({ assetId: "theme" });
        fireEvent.click(screen.getByRole("button", { expanded: false }));
        pickTrack("Ambience");
        expect(music()).toEqual({ assetId: "theme", audioTrackId: "t_ambience" });
        expect(busLines()).toEqual([AMBIENCE_LINE]);
    });

    it("shows no options and no line while the page has no music", () => {
        renderPageMusic();
        expect(screen.queryByRole("button", { expanded: false })).toBeNull();
        expect(busLines()).toEqual([]);
    });
});
