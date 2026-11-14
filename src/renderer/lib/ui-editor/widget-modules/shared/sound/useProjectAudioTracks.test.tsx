// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_AUDIO_TRACKS, type ProjectAudioTrack } from "@shared/types/audioTrack";
import { useProjectAudioTracks } from "./useProjectAudioTracks";

const listeners = new Set<() => void>();
let tracks: ProjectAudioTrack[] = [];
const service = {
    listTracks: () => [...tracks],
    onTracksChanged: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: { services: { get: () => service } }, isInitialized: true }),
}));

const ambience: ProjectAudioTrack = { id: "ambience", name: "Ambience", parentId: "sound", volume: 1, loop: true };

function addTrack() {
    tracks = [...tracks, ambience];
    for (const listener of listeners) listener();
}

function Picker() {
    const available = useProjectAudioTracks();
    return <output>{available.map(track => track.id).join(",")}</output>;
}

afterEach(() => {
    cleanup();
    listeners.clear();
});

describe("the project's audio-track picker", () => {
    it("shows a track changed between render and subscription", () => {
        tracks = [...BUILTIN_AUDIO_TRACKS];
        function OtherEditor() {
            useLayoutEffect(addTrack, []);
            return null;
        }
        render(<><Picker /><OtherEditor /></>);
        expect(screen.getByText(/ambience/)).toBeTruthy();
    });

    it("follows later changes and unsubscribes when the picker unmounts", () => {
        tracks = [...BUILTIN_AUDIO_TRACKS];
        const view = render(<Picker />);
        expect(screen.queryByText(/ambience/)).toBeNull();
        act(addTrack);
        expect(screen.getByText(/ambience/)).toBeTruthy();
        view.unmount();
        expect(listeners.size).toBe(0);
    });
});
