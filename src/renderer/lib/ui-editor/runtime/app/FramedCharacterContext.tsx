import { createContext, useContext } from "react";
import type { ImageBackendContent, PuppetState } from "narraleaf-react";

/**
 * What the engine says the framed character looks like right now.
 *
 * The two arms are the engine's own two answers, kept apart rather than flattened. A character
 * Studio draws is an `Image`, and what the engine hands over is the sources it resolved — the whole
 * point of the image seam, since it means Studio never resolves a character's appearance a second
 * time. A character an author's runtime draws is a `Puppet`, and what the engine hands over is the
 * named state it stores for it; the pictures are the backend's business, not ours.
 *
 * `null` is a frame with no character in it, which is a perfectly ordinary thing for an author to
 * draw — a frame used as decoration, or one being edited before anything is put in it.
 */
export type FramedCharacterState =
    | { kind: "image"; content: ImageBackendContent }
    | { kind: "puppet"; state: PuppetState | null };

export type FramedCharacter = {
    /** Whose frame this is, when the story named a character. */
    characterId: string | undefined;
    state: FramedCharacterState | null;
};

const FramedCharacterContext = createContext<FramedCharacter>({ characterId: undefined, state: null });

export const FramedCharacterProvider = FramedCharacterContext.Provider;

/**
 * Read the framed character from inside a widget on an element-mounted surface.
 *
 * Context rather than props because what is between the two is `renderElementTree`, the recursive
 * function with twenty positional parameters — the same reason `SurfacePassiveContext` exists.
 */
export function useFramedCharacter(): FramedCharacter {
    return useContext(FramedCharacterContext);
}
