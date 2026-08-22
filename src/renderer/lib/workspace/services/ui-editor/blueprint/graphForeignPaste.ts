import type { Blueprint, BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_PARAM_FN_REF, BLUEPRINT_NODE_TYPE_FN_CALL } from "@shared/types/blueprint/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import {
    extractBlueprintAssetReferences,
    type BlueprintAssetPinResolver,
} from "@/lib/workspace/services/references/referenceModel";
import { listBlueprintElementRefSites, type BlueprintElementRefSite } from "./elementRefSites";
import { parseBlueprintFnRef } from "./fnCatalog";
import type { BlueprintGraphClipboardPayload } from "./graphClipboard";

/**
 * A graph fragment pasted into a project other than the one it was copied from.
 *
 * A fragment travels on the *system* clipboard, so nodes copied in one window can be pasted into
 * any other - and a page's logic is where cross-project references are densest: an asset on an
 * `Image Asset` node, a widget named by an `On Element Click` head, a `Call Fn` naming a blueprint
 * in the project it came from. The rules are the ones the story rows and the interface elements
 * already follow (`storyForeignPaste`, `uiEditorForeignPaste`):
 *
 *  - **An id that would have resolved is never touched.** Two projects made from one template ship
 *    the same ids, so a reference that works here is a correct binding, not a coincidence.
 *  - **Assets are made to resolve.** Their bytes still exist in the source project and the main
 *    process can vouch for the copying window's right to read them, so files are imported under the
 *    ids they already have and every param naming one keeps naming it. That is what lets the nodes
 *    be pasted verbatim, which matters here more than anywhere: a node's params are an open-ended
 *    bag and a plugin may put anything in one.
 *  - **Everything else keeps its id and is reported.** A file that could not be brought over is
 *    named per site by `assets/missing`; a widget this project does not have is named by
 *    `blueprint/element-ref-missing`; a `Call Fn` whose target is not here is named by
 *    `blueprint/fn-target-missing`. All three are errors that refuse a build, which is the point.
 */

/** The blueprint id the payload's graphs are filed under while they are being walked. */
const CLIPBOARD_BLUEPRINT_ID = "narraleaf.blueprint.clipboard";

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
 */
export function isBlueprintGraphPasteFromAnotherProject(
    payload: BlueprintGraphClipboardPayload,
    projectPath: string,
): boolean {
    const source = payload.source?.path;
    if (typeof source !== "string" || !source.trim() || !projectPath.trim()) {
        return false;
    }
    return normalizeProjectPath(source) !== normalizeProjectPath(projectPath);
}

/**
 * The library asset ids a copied fragment names, in the order they are met.
 *
 * Which pins count is `referenceModel`'s answer rather than a second list here, so a node that
 * starts naming an asset travels with it without anyone remembering to say so twice.
 */
export function collectGraphClipboardAssetIds(
    payload: BlueprintGraphClipboardPayload,
    resolveAssetPins?: BlueprintAssetPinResolver,
): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const reference of clipboardAssetReferences(payload, resolveAssetPins)) {
        const id = reference.assetId.trim();
        if (id && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    }
    return ids;
}

/**
 * The pins naming an asset this project does not have.
 *
 * Counted per pin rather than per id, because that is what a report of them is: `assets/missing`
 * names each site separately and carries a jump to it, so two nodes naming one missing file are two
 * things for the author to look at.
 */
export function countUnresolvedGraphAssetSites(
    payload: BlueprintGraphClipboardPayload,
    resolves: (assetId: string) => boolean,
    resolveAssetPins?: BlueprintAssetPinResolver,
): number {
    let unresolved = 0;
    for (const reference of clipboardAssetReferences(payload, resolveAssetPins)) {
        if (!resolves(reference.assetId)) {
            unresolved += 1;
        }
    }
    return unresolved;
}

/** The widgets a copied fragment binds to, one entry per node that names one. */
export function listGraphClipboardElementRefs(
    payload: BlueprintGraphClipboardPayload,
): BlueprintElementRefSite[] {
    return listBlueprintElementRefSites(clipboardGraphIr(payload));
}

/**
 * The nodes bound to a widget this project does not have.
 *
 * Per node, for the same reason assets are counted per pin: `blueprint/element-ref-missing` reports
 * each one where it sits and can jump to it. The element id is kept exactly as copied - repointing
 * it at nothing would throw away the one fact the author needs to fix it.
 */
export function countUnresolvedGraphElementRefs(
    payload: BlueprintGraphClipboardPayload,
    hasElement: (elementId: string) => boolean,
): number {
    return listGraphClipboardElementRefs(payload).filter(site => !hasElement(site.ref.elementId)).length;
}

/**
 * The `Call Fn` nodes whose target is not in this project.
 *
 * A call pasted together with the Fn head it names is repointed at the pasted head, so it is not
 * counted: the paste has already made it resolve. What is left is a call naming a blueprint the
 * pasting project does not have, which is the shape a fragment from elsewhere arrives in - and
 * which the graph editor reports as `fn.call_target_not_found` the moment the graph is opened.
 */
export function countUnresolvedGraphFnCalls(
    payload: BlueprintGraphClipboardPayload,
    hasBlueprint: (blueprintId: string) => boolean,
): number {
    const pasted = new Set(payload.nodeIds);
    let unresolved = 0;
    for (const nodeId of payload.nodeIds) {
        const node = payload.nodes[nodeId];
        if (node?.type !== BLUEPRINT_NODE_TYPE_FN_CALL) {
            continue;
        }
        const parsed = parseBlueprintFnRef(node.params?.[BLUEPRINT_NODE_PARAM_FN_REF]);
        if (!parsed || pasted.has(parsed.headNodeId) || hasBlueprint(parsed.blueprintId)) {
            continue;
        }
        unresolved += 1;
    }
    return unresolved;
}

/** The copied nodes and the edges between them, as one graph. */
function clipboardGraphIr(payload: BlueprintGraphClipboardPayload): BlueprintGraphIr {
    return { nodes: payload.nodes, edges: payload.edges };
}

function clipboardAssetReferences(
    payload: BlueprintGraphClipboardPayload,
    resolveAssetPins?: BlueprintAssetPinResolver,
) {
    return extractBlueprintAssetReferences(clipboardBlueprintDocument(payload), { resolveAssetPins }).references;
}

/**
 * The payload's nodes as a document, so the reference walk can read them.
 *
 * `extractBlueprintAssetReferences` takes a whole document because that is the shape it walks in the
 * index; here there is no document, only a fragment of one graph. The stand-in blueprint is given
 * an owner record naming itself, because the walk skips a blueprint no owner claims - in the index
 * that means "unreachable, and with no jump target to report it under", which is true of a stored
 * document and false of this one.
 */
function clipboardBlueprintDocument(payload: BlueprintGraphClipboardPayload): BlueprintDocument {
    const blueprint: Blueprint = {
        id: CLIPBOARD_BLUEPRINT_ID,
        name: CLIPBOARD_BLUEPRINT_ID,
        owner: { kind: "globalMain" },
        frontend: "visual",
        programKind: "graph",
        program: {
            kind: "graph",
            graphs: {
                events: {
                    [CLIPBOARD_BLUEPRINT_ID]: { id: CLIPBOARD_BLUEPRINT_ID, graph: clipboardGraphIr(payload) },
                },
                functions: {},
            },
        },
    };
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: { [CLIPBOARD_BLUEPRINT_ID]: blueprint },
        ownerRecords: {
            [CLIPBOARD_BLUEPRINT_ID]: { activeBlueprintId: CLIPBOARD_BLUEPRINT_ID, privateBlueprintIds: [] },
        },
    };
}
