/**
 * The picture of the game a page opened over it keeps: the screen the player was looking at when
 * the page opened.
 *
 * A save's picture is the stage as the engine draws it (`LiveGame.capturePng`) - the scene and the
 * Game UI the story put on it, the dialogue box and the quick menu among them. A page opened over a
 * running game steps that Game UI off the stage until it closes (`isStageSlotConcealedByPage`), so a
 * save taken from the Save page pictured the scene with no dialogue box and no quick menu, while an
 * auto-save taken a moment earlier pictured both. Two saves of one moment, two different pictures.
 *
 * So the picture is taken as the page opens, before anything steps off: while it is being taken the
 * Game UI stays where it is - under the page, which is fading in over it - and steps off as soon as
 * the picture is in hand. Every save written while the page covers the stage keeps that picture,
 * whichever page writes it and however long after; it is the screen the player left to open the
 * menu, as a visual novel's save screen shows it.
 *
 * The picture is taken whether or not a save follows, because nothing can say beforehand that one
 * will: a page that saves is any page with a `Save Game` node. It is held only until the page closes,
 * and it is taken at the size a save keeps it (`captureSavePicture`): a full-size capture held the
 * Game UI on the stage for as long as drawing and encoding it took, for a picture no save ever kept
 * at that size.
 *
 * A desktop shell reads the picture back from the compositor, which costs the page nothing - but a
 * read-back shows what is on the screen, and the page is fading in over the stage. So while the
 * hold lasts the host keeps the page off the screen ({@link StageCoverCapture.holding}), and a
 * picture that arrives after the hold let go is not trusted to be of the stage alone: `capture` is
 * handed `stillHeld` to ask. The page's own picture, a clone of the stage that leaves pages out, is
 * the fallback; it blocked the main thread for most of a second per page opened, MEASURED in a
 * 1920x1080 port, which is why it is no longer the first choice.
 *
 * Comments in English per project convention.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Longest the Game UI waits on the stage for the picture before stepping off anyway. A capture that
 * takes longer than this is still used when it arrives; the screen just stops waiting for it.
 */
export const STAGE_COVER_CAPTURE_HOLD_MS = 1500;

export type StageCoverCapture = {
    /** Whether the Game UI on the stage steps off for the page now: covered, and the picture in hand. */
    concealed: boolean;
    /**
     * Covered, and the picture still being taken: the Game UI is on the stage, and a host that reads
     * the frame back keeps the page off the screen until this turns false.
     */
    holding: boolean;
    /**
     * The picture taken as the page now covering the stage opened, or null when the stage is not
     * covered or no picture could be taken. Resolves to null when taking it failed. Stable.
     */
    readPicture: () => Promise<string | null> | null;
};

type CoverEpisode = {
    /** Increments every time the stage becomes covered or uncovered. */
    id: number;
    covered: boolean;
    /** Covered, and the Game UI is still on the stage while the picture is taken. */
    holding: boolean;
};

export function useStageCoverCapture(input: {
    /** Whether a page is drawn over the stage (`isStageCoveredByPage`). */
    covered: boolean;
    /**
     * Start taking the picture, or answer null when there is no game on the stage to picture.
     * `stillHeld` answers whether this page's hold is still on - whether a frame read back now is
     * one the page was kept out of.
     */
    capture: (stillHeld: () => boolean) => Promise<string> | null;
    holdMs?: number;
}): StageCoverCapture {
    const [episode, setEpisode] = useState<CoverEpisode>({ id: 0, covered: false, holding: false });
    // Adjusted while rendering rather than in an effect, so the render that first sees the page is
    // already the one that holds - no frame in which the Game UI starts to step off and comes back.
    if (episode.covered !== input.covered) {
        setEpisode({ id: episode.id + 1, covered: input.covered, holding: input.covered });
    }

    const captureRef = useRef(input.capture);
    captureRef.current = input.capture;
    const pictureRef = useRef<{ episodeId: number; picture: Promise<string | null> } | null>(null);
    /** The cover whose hold is on, or null. Read by `stillHeld`, which outlives the render. */
    const heldEpisodeRef = useRef<number | null>(null);
    const holdMs = input.holdMs ?? STAGE_COVER_CAPTURE_HOLD_MS;

    // A layout effect, so a hold with nothing to picture is let go before the screen is painted.
    useLayoutEffect(() => {
        if (!episode.covered) {
            pictureRef.current = null;
            heldEpisodeRef.current = null;
            return;
        }
        if (!episode.holding || pictureRef.current?.episodeId === episode.id) {
            // Already taken for this cover - the second run StrictMode makes of an effect included.
            return;
        }
        const episodeId = episode.id;
        heldEpisodeRef.current = episodeId;
        const release = () => {
            if (heldEpisodeRef.current === episodeId) {
                heldEpisodeRef.current = null;
            }
            setEpisode(current => (current.id === episodeId && current.holding ? { ...current, holding: false } : current));
        };
        const stillHeld = () => heldEpisodeRef.current === episodeId;
        let taking: Promise<string> | null;
        try {
            taking = captureRef.current(stillHeld);
        } catch {
            taking = null;
        }
        if (!taking) {
            release();
            return;
        }
        const picture = taking.then(value => (typeof value === "string" && value.length > 0 ? value : null), () => null);
        pictureRef.current = { episodeId: episode.id, picture };
        void picture.then(release);
        // Not cleared on cleanup: it only ever releases this one cover, and a StrictMode cleanup
        // between two runs of this effect would otherwise leave nothing to let a stalled capture go.
        setTimeout(release, holdMs);
    }, [episode, holdMs]);

    const readPicture = useCallback(() => pictureRef.current?.picture ?? null, []);

    return { concealed: episode.covered && !episode.holding, holding: episode.covered && episode.holding, readPicture };
}
