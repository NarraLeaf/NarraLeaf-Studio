/**
 * The contract between the compiler and Studio's own puppet backend.
 *
 * An element-mounted surface reaches the stage as a `Puppet` whose backend is Studio's rather than
 * an author's: the engine owns the box and forwards `src` and `options` without reading either, so
 * these two functions are the whole of what the two sides have to agree on. Shared rather than
 * renderer-owned because both halves are compiled into different bundles.
 */

/** The backend name Studio registers for element-mounted surfaces. */
export const STAGE_SURFACE_BACKEND_NAME = "nl.surface";

/** What the compiler hands the engine as a puppet's `src`. Opaque to the engine. */
export function stageSurfaceSrc(surfaceId: string): string {
    return `uidoc:${surfaceId}`;
}

/** The surface id inside a `src` the compiler wrote, or null when it is not one. */
export function parseStageSurfaceSrc(src: string | undefined | null): string | null {
    if (typeof src !== "string" || !src.startsWith("uidoc:")) {
        return null;
    }
    const id = src.slice("uidoc:".length).trim();
    return id.length > 0 ? id : null;
}

/**
 * What the compiler puts in a puppet's `options` for this backend.
 *
 * `objectName` is the stage key the element was registered under, and it is what scopes the
 * surface's runtime state — two frames on stage at once must not share it.
 */
export type StageSurfaceMountOptions = {
    objectName?: string;
    /** Whose frame this is, for the widgets inside that draw a character. */
    characterId?: string;
};

export function readStageSurfaceMountOptions(options: unknown): StageSurfaceMountOptions {
    const raw = (options ?? {}) as Record<string, unknown>;
    return {
        objectName: typeof raw.objectName === "string" ? raw.objectName : undefined,
        characterId: typeof raw.characterId === "string" ? raw.characterId : undefined,
    };
}
