import type { UISurface } from "@shared/types/ui-editor/document";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { getInterface } from "@/lib/app/bridge";
import { translate, translateN } from "@/lib/i18n";
import { getStageSlotLabel } from "@/lib/ui-editor/stageSlotLabel";
import {
    importTransferredAssets,
    readClipboardAssetGrant,
} from "@/lib/workspace/services/assets/assetTransferImport";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import {
    IMPORT_PLACEMENT_FROM_SOURCE,
    type ImportTemplateResult,
    type UIDocumentService,
} from "@/lib/workspace/services/ui-editor/UIDocumentService";
import {
    createClipboardAssetPort,
    offerClipboardAssetGrant,
    readClipboardProjectName,
    readUiClipboardEnvironment,
    type UiClipboardEnvironment,
} from "./uiEditorClipboardBridge";
import {
    collectUiClipboardAssetIds,
    countUnresolvedUiAssetSites,
    countUnresolvedUiComponentInstances,
    countUnresolvedUiFrameTargets,
    isUiPasteFromAnotherProject,
} from "./uiEditorForeignPaste";
import {
    asUiElementSelection,
    buildUiSurfaceClipboardPayload,
    chooseUiSurfacePastePayload,
    describeUiSurfacePaste,
    getUiSurfaceClipboard,
    getUiSurfacePasteLevel,
    readUiSurfaceClipboardPayload,
    setUiSurfaceClipboard,
    type UISurfaceClipboardPayload,
    type UiSurfacePasteOutcome,
} from "./uiSurfaceClipboard";

/**
 * Copying a whole interface between projects.
 *
 * The surfaces panel's two gestures, with the project behind them: a copy snapshots one page and
 * vouches for the files it references, and a paste brings those files over and hands the page to
 * `importTemplateBundle`, which is the only thing that knows how to re-id a surface together with
 * the blueprints filed against its old id.
 *
 * The rules a foreign payload follows are the element clipboard's and are not restated here; see
 * `uiSurfaceClipboard` for what travels and `uiEditorForeignPaste` for what happens to an id this
 * project cannot answer.
 */

const CLIPBOARD_KIND = "ui-surfaces" as const;

/**
 * Put one interface on the machine's clipboard.
 *
 * Answers false for a surface that cannot be copied - the main page, or one whose root element is
 * missing - so the caller can leave the gesture off rather than offer a copy that pastes as
 * nothing.
 *
 * The in-window copy is what the gesture returns on, so copying stays synchronous. Reaching the
 * other project windows is one round trip through the main process and is left to run on its own,
 * exactly as the element clipboard's publish does.
 */
export function copyUiSurface(
    documentService: UIDocumentService,
    localBlueprintService: LocalBlueprintService | null,
    surfaceId: string,
): boolean {
    const environment = readUiClipboardEnvironment(documentService);
    // Without a project behind it there is nothing to stamp and nowhere to publish to, and the copy
    // stays what it was: this window's own.
    const copyId = environment?.uuidService?.generate();
    const payload = buildUiSurfaceClipboardPayload({
        document: documentService.getDocument(),
        surfaceId,
        blueprintDocument: readBlueprintDocument(localBlueprintService),
        ...(environment && copyId
            ? {
                copyId,
                source: {
                    // The identity key rather than the spelling the author opened the project by: it
                    // is never shown, only compared.
                    path: normalizeProjectPath(environment.projectPath),
                    identifier: environment.projectIdentifier,
                    name: environment.projectName,
                },
            }
            : {}),
    });
    if (!payload) {
        return false;
    }
    setUiSurfaceClipboard(payload);
    if (environment && copyId) {
        publishUiSurfaceClipboard(environment, payload);
    }
    return true;
}

/**
 * Take the machine's clipboard as this window's own, when it is a different copy.
 *
 * Called when the panel mounts and whenever the window comes forward, which between them cover
 * every way an interface copied in another project can arrive. Without it the panel would have no
 * synchronous answer to "is there an interface to paste", and the affordance has to be absent
 * rather than offered over an empty clipboard.
 *
 * A clipboard holding something else leaves this window's copy standing, for the reason
 * {@link chooseUiSurfacePastePayload} gives.
 */
export async function refreshUiSurfaceClipboardFromSystem(): Promise<boolean> {
    const payload = await readSystemSurfacePayload();
    if (payload && payload.copyId !== getUiSurfaceClipboard()?.copyId) {
        setUiSurfaceClipboard(payload);
    }
    return Boolean(getUiSurfaceClipboard());
}

/**
 * Add the copied interface to this project, and say what the author now has.
 *
 * Returns the surface that arrived, so the panel can open it, or null when none did. Files come
 * over before the page is written - an asset that arrives first makes its widget draw on the spot
 * rather than after a second gesture - and the freeze is re-read on the far side of that import,
 * because a page written into a frozen workspace reaches the in-memory document, is refused at the
 * file-system boundary, and is gone again at the thaw.
 */
export async function pasteUiSurface(documentService: UIDocumentService): Promise<UISurface | null> {
    const environment = readUiClipboardEnvironment(documentService);
    const payload = chooseUiSurfacePastePayload(getUiSurfaceClipboard(), await readSystemSurfacePayload());
    if (!payload) {
        return null;
    }
    setUiSurfaceClipboard(payload);
    // Asked of the payload rather than of where it was found: a foreign copy read off the clipboard
    // once is remembered in this window, and it is no less foreign the second time it is pasted.
    const foreign = isUiPasteFromAnotherProject(payload, environment?.projectPath ?? "");
    const port = createClipboardAssetPort(environment);
    let imported = 0;
    if (foreign && port) {
        const transfer = await importTransferredAssets(
            port,
            readClipboardAssetGrant(payload.assets),
            collectUiClipboardAssetIds(asUiElementSelection(payload), environment?.resolveAssetPins),
        );
        if (transfer.frozen) {
            return null;
        }
        imported = transfer.imported;
    }
    if (environment?.isFrozen()) {
        return null;
    }

    let result: ImportTemplateResult | null = null;
    try {
        result = documentService.importTemplateBundle({
            document: payload.document,
            graphs: payload.graphs,
            placement: IMPORT_PLACEMENT_FROM_SOURCE,
        });
    } catch (error) {
        // A payload this Studio cannot read costs the author the paste and nothing else; the
        // document is untouched, because the import writes only at the end of a surface it built.
        console.warn("[uiSurfaceClipboard] could not add the copied interface", error);
    }
    const added = result?.importedSurfaces ?? [];
    if (added.length > 0) {
        void documentService.save(documentService.getDocument()).catch(error => {
            console.warn("[uiSurfaceClipboard] could not save the added interface", error);
        });
    }

    const outcome: UiSurfacePasteOutcome = {
        added: added.length,
        slotsInUse: (result?.skippedSlots ?? []).map(slotId => getStageSlotLabel(slotId, translate)),
        project: foreign ? readClipboardProjectName(payload.source?.name) : null,
        imported,
        // Only about what arrived. An interface that stayed behind because its slot was taken has
        // no references in this project to be unresolved, and counting them would read as a fault
        // in a page the author cannot see.
        unresolved: added.length > 0 ? countUnresolvedReferences(documentService, environment, payload) : 0,
    };
    environment?.uiService?.showNotification(
        describeUiSurfacePaste(outcome, { t: translate, tn: translateN }),
        getUiSurfacePasteLevel(outcome),
    );
    return added[0] ?? null;
}

/**
 * Vouch for the copied interface's files and hand the payload to the platform clipboard.
 *
 * Not awaited by the gesture that starts it: the in-window copy is already made, and a copy whose
 * grant has not come back yet still reaches other windows - as a payload with no manifest, which is
 * what a paste already handles when the copying window has closed.
 */
function publishUiSurfaceClipboard(
    environment: UiClipboardEnvironment,
    payload: UISurfaceClipboardPayload,
): void {
    void (async () => {
        const assets = await offerClipboardAssetGrant(
            environment,
            collectUiClipboardAssetIds(asUiElementSelection(payload), environment.resolveAssetPins),
        );
        const published: UISurfaceClipboardPayload = assets ? { ...payload, assets } : payload;
        if (getUiSurfaceClipboard()?.copyId === payload.copyId) {
            setUiSurfaceClipboard(published);
        }
        try {
            await getInterface().clipboard.writeEditorSelection(CLIPBOARD_KIND, JSON.stringify(published));
        } catch (error) {
            // A copy that raised a dialog because the platform clipboard was busy would be a fault
            // report for a menu row. The window keeps its own copy either way.
            console.warn("[uiSurfaceClipboard] could not publish the copied interface", error);
        }
    })();
}

async function readSystemSurfacePayload(): Promise<UISurfaceClipboardPayload | null> {
    try {
        const status = await getInterface().clipboard.readEditorSelection(CLIPBOARD_KIND);
        const json = status.success ? status.data.payload : null;
        return json ? readUiSurfaceClipboardPayload(json) : null;
    } catch (error) {
        console.warn("[uiSurfaceClipboard] could not read the platform clipboard", error);
        return null;
    }
}

function readBlueprintDocument(localBlueprintService: LocalBlueprintService | null) {
    try {
        return localBlueprintService?.getBlueprintDocument() ?? null;
    } catch {
        // A blueprint store that is still coming up costs the copy its logic and not its layout.
        return null;
    }
}

/**
 * The fields still naming something this project does not have, counted per field.
 *
 * Read after the import rather than before it, against the document as it then is: an asset that
 * came over resolves, and a Page widget pointing at a page that arrived beside it resolves too.
 * Counted per field because that is what a report of them is - `assets/missing` names each site
 * separately and carries a jump to it.
 */
function countUnresolvedReferences(
    documentService: UIDocumentService,
    environment: UiClipboardEnvironment | null,
    payload: UISurfaceClipboardPayload,
): number {
    const port = createClipboardAssetPort(environment);
    const selection = asUiElementSelection(payload);
    const surfaceIds = new Set(documentService.getDocument().surfaces.map(surface => surface.id));
    for (const surface of payload.document.surfaces) {
        // The copied pages answer for each other: an `nl.frame` naming a sibling that travelled in
        // the same payload was repointed at the copy, so it is not a reference the author has lost.
        surfaceIds.add(surface.id);
    }
    return countUnresolvedUiAssetSites(
        selection,
        assetId => port?.has(assetId) ?? false,
        environment?.resolveAssetPins,
    )
        + countUnresolvedUiComponentInstances(selection, componentId => Boolean(documentService.getComponent(componentId)))
        + countUnresolvedUiFrameTargets(selection, surfaceId => surfaceIds.has(surfaceId));
}
