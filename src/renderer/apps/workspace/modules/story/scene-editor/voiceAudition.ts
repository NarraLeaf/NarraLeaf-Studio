import { useSyncExternalStore } from "react";

/**
 * A single, app-wide voice audition player (WI-4). Only one take plays at a time, wherever the play
 * button lives — a story row, the inspector, or the voice table — so starting one always stops the
 * last. The bytes are loaded lazily (the caller fetches the audio only when a play actually begins),
 * and the object URL is revoked on stop, mirroring the voice table's own audition (VoiceEditorTab).
 */

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let currentKey: string | null = null;
// Bumped by every start/stop so a load that resolves after it was superseded (or stopped) is dropped.
let generation = 0;

const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) {
        listener();
    }
}

export function stopVoiceAudition(): void {
    generation++;
    if (currentAudio) {
        currentAudio.onended = null;
        currentAudio.pause();
        currentAudio = null;
    }
    if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
        currentUrl = null;
    }
    if (currentKey !== null) {
        currentKey = null;
        emit();
    }
}

/**
 * Toggle audition for `key`: stop if it is already the one playing, otherwise stop whatever is and
 * start this one. `load` returns the audio bytes (or null when the clip is gone); it is awaited, so a
 * newer toggle that lands first wins and this load's result is discarded.
 */
export async function toggleVoiceAudition(key: string, load: () => Promise<Uint8Array | null>): Promise<void> {
    if (currentKey === key) {
        stopVoiceAudition();
        return;
    }
    stopVoiceAudition();
    const myGeneration = generation;
    const bytes = await load().catch(() => null);
    if (myGeneration !== generation || !bytes || bytes.byteLength === 0) {
        return;
    }
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    const audio = new Audio(url);
    audio.onended = () => stopVoiceAudition();
    currentAudio = audio;
    currentUrl = url;
    currentKey = key;
    emit();
    try {
        await audio.play();
    } catch {
        // Playback rejected (e.g. the tab lost focus mid-load); stop only if still ours.
        if (currentKey === key) {
            stopVoiceAudition();
        }
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The key currently auditioning, or null. Re-renders subscribers when it changes. */
export function useVoiceAuditionKey(): string | null {
    return useSyncExternalStore(subscribe, () => currentKey, () => currentKey);
}
