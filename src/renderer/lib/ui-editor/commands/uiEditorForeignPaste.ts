import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { getUIComponentLink } from "@shared/types/ui-editor/document";
import { getUIFrameWidgetProps, UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import {
    extractBlueprintAssetReferences,
    listUIElementAssetIds,
    type BlueprintAssetPinResolver,
} from "@/lib/workspace/services/references/referenceModel";
import type { UIEditorClipboardPayload } from "./uiEditorClipboard";

/**
 * Interface elements pasted into a project other than the one they were copied from.
 *
 * The elements travel on the *system* clipboard, so a selection copied in one window can be pasted
 * into any other - and every id inside it (assets, library components, blueprints) is a UUID minted
 * by the project that wrote it. The rules are the ones the story editor's rows already follow, for
 * the reasons given in `storyForeignPaste`:
 *
 *  - **An id that would have resolved is never touched.** Two projects made from one template ship
 *    the same ids, so a reference that works here is a correct binding, not a coincidence.
 *  - **Assets are made to resolve.** Their bytes still exist in the source project and the main
 *    process can vouch for the copying window's right to read them, so the files are imported under
 *    the ids they already have and every prop pointing at one keeps pointing at it. That is what
 *    lets the elements be pasted verbatim, which matters more here than in a story: a widget's
 *    props are an open-ended bag, and rewriting ids inside one means knowing every shape it can
 *    take.
 *  - **Everything else keeps its id and is reported.** A file that could not be brought over is
 *    named per site by `assets/missing`; an instance of a library component this project does not
 *    have is named by `ui/component-missing`. Both refuse a build, which is the point - a reference
 *    the author can see and act on, rather than a widget that silently draws nothing.
 *
 * A component instance is deliberately *not* repaired the way an asset is. A component definition
 * is not a file: it is a second element tree with its own blueprints, and importing one would put a
 * component into the target project's library that its author never added. Keeping the link and
 * reporting it leaves the author both facts - which component, and where it is used - and the two
 * gestures that answer it: add the component, or unlink the instance.
 */

/**
 * Whether the payload was copied in a different project than the one pasting it.
 *
 * The project path is the identity, compared through `normalizeProjectPath` - the one key every
 * project-path comparison in Studio agrees on, and the only thing that tells two spellings of one
 * directory from two directories.
 *
 * A payload with no `source` never left this window: nothing writes one without the stamp, and the
 * system clipboard is the only way one can arrive from elsewhere. It is read as same-project, which
 * is the behaviour it was copied under.
 *
 * Takes only the stamp, so the surface clipboard's payload asks the same question of the same
 * function rather than carrying a second answer to it.
 */
export function isUiPasteFromAnotherProject(
    payload: Pick<UIEditorClipboardPayload, "source">,
    projectPath: string,
): boolean {
    const source = payload.source?.path;
    if (typeof source !== "string" || !source.trim() || !projectPath.trim()) {
        return false;
    }
    return normalizeProjectPath(source) !== normalizeProjectPath(projectPath);
}

/**
 * The library asset ids a copied selection names, in the order they are met.
 *
 * Both halves of the payload are swept, because both can hold one: an element's props, and the
 * widget blueprints that travel beside them - a graph that sets an image on a button holds that
 * image's id and nothing in the element does. Which fields count is `referenceModel`'s answer
 * rather than a second list here, so a widget or a node that starts naming an asset travels with it
 * without anyone remembering to say so twice.
 */
export function collectUiClipboardAssetIds(
    payload: UIEditorClipboardPayload,
    resolveAssetPins?: BlueprintAssetPinResolver,
): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    const add = (assetId: string) => {
        const id = assetId.trim();
        if (id && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    };
    for (const element of Object.values(payload.elements)) {
        listUIElementAssetIds(element).forEach(add);
    }
    for (const reference of extractBlueprintAssetReferences(clipboardBlueprintDocument(payload), { resolveAssetPins }).references) {
        add(reference.assetId);
    }
    return ids;
}

/**
 * The fields naming an asset this project does not have.
 *
 * Counted per field rather than per id, because that is what a report of them is: `assets/missing`
 * names each site separately and carries a jump to it, so two widgets naming one missing file are
 * two things for the author to look at.
 */
export function countUnresolvedUiAssetSites(
    payload: UIEditorClipboardPayload,
    resolves: (assetId: string) => boolean,
    resolveAssetPins?: BlueprintAssetPinResolver,
): number {
    let unresolved = 0;
    for (const element of Object.values(payload.elements)) {
        for (const assetId of listUIElementAssetIds(element)) {
            if (!resolves(assetId)) {
                unresolved += 1;
            }
        }
    }
    for (const reference of extractBlueprintAssetReferences(clipboardBlueprintDocument(payload), { resolveAssetPins }).references) {
        if (!resolves(reference.assetId)) {
            unresolved += 1;
        }
    }
    return unresolved;
}

/** The library components the copied elements are instances of, in the order they are met. */
export function collectUiClipboardComponentIds(payload: UIEditorClipboardPayload): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const element of Object.values(payload.elements)) {
        const componentId = getUIComponentLink(element)?.componentId;
        if (componentId && !seen.has(componentId)) {
            seen.add(componentId);
            ids.push(componentId);
        }
    }
    return ids;
}

/**
 * The elements that are instances of a component this project does not have.
 *
 * Per element rather than per component: each one is a widget on a page drawing nothing, and
 * `ui/component-missing` reports each one where it sits.
 */
export function countUnresolvedUiComponentInstances(
    payload: UIEditorClipboardPayload,
    hasComponent: (componentId: string) => boolean,
): number {
    let unresolved = 0;
    for (const element of Object.values(payload.elements)) {
        const componentId = getUIComponentLink(element)?.componentId;
        if (componentId && !hasComponent(componentId)) {
            unresolved += 1;
        }
    }
    return unresolved;
}

/**
 * The Page widgets embedding a page this project does not have.
 *
 * The frame's sibling of {@link countUnresolvedUiComponentInstances}, and the same trade: the
 * surface id is kept exactly as copied and `ui/frame-target-missing` reports it where it sits, so
 * an author who pastes a menu and its embedded panel in two goes gets a working frame the moment
 * the second page arrives - which repointing the frame at nothing would have thrown away.
 */
export function countUnresolvedUiFrameTargets(
    payload: UIEditorClipboardPayload,
    hasSurface: (surfaceId: string) => boolean,
): number {
    let unresolved = 0;
    for (const element of Object.values(payload.elements)) {
        if (element.type !== UI_FRAME_ELEMENT_TYPE) {
            continue;
        }
        const target = getUIFrameWidgetProps(element).targetSurfaceId;
        if (target && !hasSurface(target)) {
            unresolved += 1;
        }
    }
    return unresolved;
}

/**
 * The payload's blueprints as a document, so the reference walk can read them.
 *
 * `extractBlueprintAssetReferences` takes a whole document because that is the shape it walks in the
 * index; here there is no document, only the private graphs that travelled with the widgets.
 *
 * Each one is given an owner record naming itself, because the walk skips a blueprint no owner
 * claims - in the index that means "unreachable, and with no jump target to report it under", which
 * is true of a stored document and false of this one: a clipboard carries only graphs that belong
 * to an element beside them. The key is the blueprint's own id rather than a `widgetMain:` key,
 * since which owner the paste files it under is decided when the paste registers it, not by what a
 * clipboard says.
 */
function clipboardBlueprintDocument(payload: UIEditorClipboardPayload): BlueprintDocument {
    const blueprints = { ...payload.widgetMainBlueprints, ...payload.widgetValueBlueprints };
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints,
        ownerRecords: Object.fromEntries(
            Object.keys(blueprints).map(id => [id, { activeBlueprintId: id, privateBlueprintIds: [] }]),
        ),
    };
}
