import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
    getBuiltinEditorFontCssFamily,
    isBuiltinEditorFontAssetId,
} from "@/lib/ui-editor/fonts/builtinVirtualEditorFonts";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { UIEditorFontFaceService } from "@/lib/workspace/services/ui-editor/UIEditorFontFaceService";
import { getInterface } from "@/lib/app/bridge";
import { resolveGameRuntimeAssetUrl } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
import { resolveDevModeAssetUrl } from "@/lib/ui-editor/runtime/devModeAssetUrls";
import { loadFontFaceFromUrl } from "@/lib/ui-editor/fonts/fontFaceFromUrl";
import { addFontFaceToDocument } from "@/lib/ui-editor/fonts/documentFontFaces";
import {
    getActiveProjectFontIds,
    resolveFontStackIds,
    subscribeActiveProjectFonts,
} from "@shared/typography/projectFonts";

export type EditorFontFamilyState = {
    cssFamily: string | null;
    loading: boolean;
    error: string | null;
};

function devModeCssFamilyForAssetId(assetId: string): string {
    return `nlDevFont_${assetId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

const devModeFontCache = new Map<string, { cssFamily: string; fontFace: FontFace }>();

/**
 * How a caller wants the project's default stack treated.
 *
 * `followProjectDefault: false` is for the one surface that is editing the stack itself: a row of
 * Project -> Design has to show the font it names and nothing else, or every row would preview as
 * the whole stack and the author could not tell which typeface they had actually put there.
 */
export type EditorFontFamilyOptions = {
    followProjectDefault?: boolean;
};

/** One resolved rung of the stack: the family to write, or why there is not one. */
type ResolvedFont = { assetId: string; cssFamily: string | null; error: string | null };

/**
 * The CSS `font-family` a field or widget should be set in, given the font it chose.
 *
 * **Not one font - a list.** What comes back is the chosen font followed by the project's own
 * default font stack (`@shared/types/typography`), and that is what makes "the default font is the
 * project's" true without a token being written into a single document: a widget that chose nothing
 * gets the project's stack alone, and one that chose a display face still falls through to the
 * project's fonts for the characters that face has no glyph for.
 *
 * Every rung is loaded, not only the first. A `font-family` list is resolved per character by the
 * browser, so a rung whose `FontFace` was never registered is a rung that silently does nothing -
 * and it would appear to work right up to the first line of text that needed it.
 *
 * `error` speaks for the **chosen** font alone. A rung of the project's stack that will not load is
 * a project-wide fact, reported where it can be acted on (Project -> Design); repeating it on every
 * text widget in the game would put one message on a hundred inspectors, none of them the place the
 * author would go to fix it.
 *
 * Project font assets are ref-counted through `UIEditorFontFaceService`; in Dev Mode, which has no
 * workspace services, they are resolved over IPC and cached for the window instead.
 */
export function useEditorFontFamily(
    assetId: string | null,
    options?: EditorFontFamilyOptions,
): EditorFontFamilyState {
    const followProjectDefault = options?.followProjectDefault !== false;
    let workspace: ReturnType<typeof useWorkspace> | null = null;
    try {
        workspace = useWorkspace();
    } catch {
        workspace = null;
    }
    const context = workspace?.context ?? null;
    const hasWorkspace = workspace !== null;

    // Subscribed rather than read once, so that changing the project's default font on the Design
    // surface repaints the canvas instead of waiting for whatever re-renders it next.
    const projectFontIds = useSyncExternalStore(
        subscribeActiveProjectFonts,
        getActiveProjectFontIds,
        getActiveProjectFontIds,
    );
    const stackIds = useMemo(
        // `resolveFontStackIds` reads the published stack, whose array identity changes exactly when
        // it is republished - which is what makes `projectFontIds` a dependency rather than dead
        // weight, even though it is not named in the body.
        () => (followProjectDefault ? resolveFontStackIds(assetId) : oneFontOnly(assetId)),
        [assetId, projectFontIds, followProjectDefault],
    );
    /**
     * What the effect is keyed on, in place of the array itself.
     *
     * `stackIds` is rebuilt whenever the memo recomputes, so an effect keyed on it would restart on
     * renders where nothing about the fonts moved - releasing and re-acquiring every face in a loop.
     * The list read inside the effect is still `stackIds`: it is derived from the same inputs in the
     * same render, so the closure and the key can never disagree.
     */
    const stackKey = stackIds.join("|");

    const [state, setState] = useState<EditorFontFamilyState>({
        cssFamily: null,
        loading: false,
        error: null,
    });

    useEffect(() => {
        const ids = stackIds;
        const primaryId = typeof assetId === "string" ? assetId.trim() : "";

        if (ids.length === 0) {
            setState({ cssFamily: null, loading: false, error: null });
            return;
        }

        const publish = (resolved: ResolvedFont[]): void => {
            const families = resolved
                .map(entry => entry.cssFamily)
                .filter((css): css is string => Boolean(css));
            const primary = resolved.find(entry => entry.assetId === primaryId);
            setState({
                cssFamily: families.length > 0 ? families.join(", ") : null,
                loading: false,
                error: primary?.error ?? null,
            });
        };

        // Built-in stacks are literals and need no load, so a stack made only of them settles without
        // ever showing a loading state - which is every project that has imported no font of its own.
        const immediate = ids.map(resolveBuiltinFont);
        if (immediate.every((entry): entry is ResolvedFont => entry !== null)) {
            publish(immediate);
            return;
        }

        if (!context && hasWorkspace) {
            setState({ cssFamily: null, loading: false, error: "Workspace not ready" });
            return;
        }

        const fontFaceService = context
            ? context.services.get<UIEditorFontFaceService>(Services.UIEditorFontFace)
            : null;
        const acquired: string[] = [];
        let cancelled = false;
        setState(prev => ({ ...prev, loading: true, error: null }));

        void Promise.all(ids.map(async (id, index): Promise<ResolvedFont> => {
            const builtin = immediate[index];
            if (builtin) {
                return builtin;
            }
            if (!fontFaceService) {
                return resolveDevModeFont(id);
            }
            const result = await fontFaceService.acquire(id);
            if (!result.ok) {
                return { assetId: id, cssFamily: null, error: result.error };
            }
            if (cancelled) {
                // The cleanup has already run and cannot know about this one, so it is released here
                // instead. Without this an acquire that settles after unmount holds its face - and
                // its blob URL - for the rest of the session.
                fontFaceService.release(id);
            } else {
                acquired.push(id);
            }
            return { assetId: id, cssFamily: result.cssFamily, error: null };
        })).then(resolved => {
            if (!cancelled) {
                publish(resolved);
            }
        });

        return () => {
            cancelled = true;
            for (const id of acquired) {
                fontFaceService?.release(id);
            }
        };
    }, [stackKey, assetId, context, hasWorkspace]);

    return state;
}

/** The chosen font alone, for a caller that has opted out of the project stack. */
function oneFontOnly(assetId: string | null): string[] {
    const id = typeof assetId === "string" ? assetId.trim() : "";
    return id ? [id] : [];
}

/** The rung as a literal, or null when it names a project font asset that has to be loaded. */
function resolveBuiltinFont(assetId: string): ResolvedFont | null {
    if (!isBuiltinEditorFontAssetId(assetId)) {
        return null;
    }
    const cssFamily = getBuiltinEditorFontCssFamily(assetId);
    return cssFamily
        ? { assetId, cssFamily, error: null }
        : { assetId, cssFamily: null, error: "Unknown built-in font" };
}

/**
 * Register a project font in Dev Mode's registry before any widget asks for it.
 *
 * The same registry the widgets read (`devModeFontCache`), so a text widget mounting afterwards finds
 * the face already there instead of loading its own. Throws when the face cannot be had, so a caller
 * warming a screen can count it as failed rather than as done.
 */
export async function warmDevModeFont(assetId: string): Promise<void> {
    const resolved = await resolveDevModeFont(assetId);
    if (!resolved.cssFamily) {
        throw new Error(resolved.error ?? `Font could not be loaded: ${assetId}`);
    }
}

/**
 * Dev Mode's route to a project font: no workspace services, so the window's own grant URL for the
 * asset is read and the face is registered here. Cached for the window's lifetime - Dev Mode has no
 * asset events to invalidate against, and a reload builds a fresh window anyway.
 */
async function resolveDevModeFont(assetId: string): Promise<ResolvedFont> {
    const cached = devModeFontCache.get(assetId);
    if (cached) {
        return { assetId, cssFamily: cached.cssFamily, error: null };
    }
    try {
        const url = resolveGameRuntimeAssetUrl(assetId)
            ?? resolveDevModeAssetUrl(assetId)
            ?? await resolveDevModeFontUrl(assetId);
        const cssFamily = devModeCssFamilyForAssetId(assetId);
        // From the bytes, not from `url(...)`, as the editor does with the same file - see
        // `fontFaceFromUrl` for why the browser's font loader is not handed an asset URL.
        const loaded = await loadFontFaceFromUrl(cssFamily, url);
        // With the stylesheet rule beside the face, so the engine's picture of the stage - a save's
        // thumbnail, an agent's play-test capture - is set in this font too. See `documentFontFaces`.
        addFontFaceToDocument(cssFamily, loaded);
        devModeFontCache.set(assetId, { cssFamily, fontFace: loaded.face });
        return { assetId, cssFamily, error: null };
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        reportDevModeFontFailure(assetId, error);
        return { assetId, cssFamily: null, error };
    }
}

/** Asset ids whose failure this window has already reported, so a page of widgets writes one line. */
const reportedDevModeFontFailures = new Set<string>();

/**
 * Put a font that did not load into the window's output.
 *
 * The text quietly takes the next family in its list, so without this a game set in the wrong
 * typeface said nothing at all about why - the `error` above reaches no one but the hook's state.
 */
function reportDevModeFontFailure(assetId: string, error: string): void {
    if (reportedDevModeFontFailures.has(assetId)) {
        return;
    }
    reportedDevModeFontFailures.add(assetId);
    console.warn(`[DevMode] font ${assetId} ${error}; its text is drawn in the next font of its list`);
}

async function resolveDevModeFontUrl(assetId: string): Promise<string> {
    const result = await getInterface().devMode.resolveAssetUrl(assetId, "font");
    if (!result.success || !result.data?.url) {
        throw new Error(`could not be found (${result.error ?? "no such asset"})`);
    }
    return result.data.url;
}
