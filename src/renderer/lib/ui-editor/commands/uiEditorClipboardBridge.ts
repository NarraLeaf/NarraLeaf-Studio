import type { AssetTransferEntry } from "@shared/types/assetTransfer";
import { getInterface } from "@/lib/app/bridge";
import { translateN } from "@/lib/i18n";
import {
    buildAssetTransferEntries,
    createTransferredAssetPort,
    findLibraryAsset,
    importTransferredAssets,
    type TransferredAssetPort,
} from "@/lib/workspace/services/assets/assetTransferImport";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { BlueprintAssetPin, BlueprintAssetPinResolver } from "@/lib/workspace/services/references/referenceModel";
import type { Service } from "@/lib/workspace/services/Service";
import { Services } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import {
    getUiEditorClipboard,
    readUiEditorClipboardPayload,
    setUiEditorClipboard,
    type UIEditorClipboardPayload,
} from "./uiEditorClipboard";
import {
    collectUiClipboardAssetIds,
    countUnresolvedUiAssetSites,
    countUnresolvedUiComponentInstances,
    countUnresolvedUiFrameTargets,
    isUiPasteFromAnotherProject,
} from "./uiEditorForeignPaste";

/**
 * The workspace half of the interface editor's clipboard.
 *
 * Everything that needs a project behind it lives here, so the command functions stay about what a
 * paste *means* and the rules about what a foreign payload does stay pure and testable
 * (`uiEditorForeignPaste`).
 *
 * The services are read off the document service's own workspace context rather than threaded down
 * from the editor tab: copy, cut and paste are reached from a keybinding, a canvas menu and an
 * outline menu, and each of those would otherwise have to carry four services it has no other use
 * for. A context that cannot be read at all - the component editor's document adapter is a stand-in
 * object, not a service - degrades to the in-window clipboard, which is what that editor had.
 */

const CLIPBOARD_KIND = "ui-elements" as const;

/** What a copy and a paste need of the project around them. */
export type UiClipboardEnvironment = {
    /** This window's project directory: the identity a pasted payload is compared against. */
    projectPath: string;
    /** What this project is called, carried on the clipboard so a foreign paste can name its source. */
    projectName: string;
    /** The project's `identifier`. Travels for display; it is not an identity. */
    projectIdentifier: string;
    assetsService: AssetsService | null;
    fileSystemService: FileSystemService | null;
    uiService: UIService | null;
    uuidService: UuidService | null;
    /** Read at the moment it is asked, because the callers ask again after every await. */
    isFrozen: () => boolean;
    /** Declared asset pins per node type, so a widget's graph is swept as the index sweeps it. */
    resolveAssetPins: BlueprintAssetPinResolver;
};

/**
 * The project around a document service, or null when there is none to read.
 *
 * Every lookup is guarded rather than assumed: a service registry that is still coming up, or a
 * document service that is a stand-in for one, must cost the editor its cross-project reach and
 * nothing else.
 */
export function readUiClipboardEnvironment(documentService: UIDocumentService): UiClipboardEnvironment | null {
    const context = typeof documentService.getContext === "function" ? tryGetContext(documentService) : null;
    if (!context) {
        return null;
    }
    const services = context.services;
    const get = <T extends Service>(key: Services): T | null => {
        try {
            return services.get<T>(key);
        } catch {
            return null;
        }
    };
    const freezeService = get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
    const projectService = get<ProjectService>(Services.Project);
    const catalog = get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);
    let projectName = "";
    let projectIdentifier = "";
    try {
        const config = projectService?.getProjectConfig();
        projectName = config?.name ?? "";
        projectIdentifier = config?.identifier ?? "";
    } catch {
        // Only the display half of a copy. A surface that can be edited because the document loaded
        // is worth more than a clipboard payload with a name on it.
    }
    return {
        projectPath: context.project.getConfig().projectPath ?? "",
        projectName,
        projectIdentifier,
        assetsService: get<AssetsService>(Services.Assets),
        fileSystemService: get<FileSystemService>(Services.FileSystem),
        uiService: get<UIService>(Services.UI),
        uuidService: get<UuidService>(Services.Uuid),
        isFrozen: () => freezeService?.isFrozen() ?? false,
        resolveAssetPins: nodeType => resolveCatalogAssetPins(catalog, nodeType),
    };
}

/**
 * Put a copied selection where the other project windows can reach it.
 *
 * Deliberately not awaited by the gesture that starts it. The in-window clipboard is already filled
 * by the time this runs, so the copy has happened; what is left is one round trip to vouch for the
 * files the selection references and one to hand the payload to the platform clipboard, and making
 * Ctrl+C wait for either would be a pause with nothing to show for it. A copy whose grant has not
 * come back yet still reaches other windows - as a payload with no manifest, which is exactly what
 * a paste already handles when the copying window has closed.
 */
export function publishUiClipboard(
    environment: UiClipboardEnvironment,
    payload: UIEditorClipboardPayload,
): void {
    void (async () => {
        const assets = await offerClipboardAssets(environment, payload);
        // The offer is folded into the payload the clipboard receives and into the one this window
        // holds, so a same-window paste and a cross-window paste describe the same copy.
        const published: UIEditorClipboardPayload = assets ? { ...payload, assets } : payload;
        if (getUiEditorClipboard()?.copyId === payload.copyId) {
            setUiEditorClipboard(published);
        }
        try {
            await getInterface().clipboard.writeEditorSelection(CLIPBOARD_KIND, JSON.stringify(published));
        } catch (error) {
            // A copy that raised a dialog because the platform clipboard was busy would be a fault
            // report for pressing Ctrl+C. The window keeps its own copy either way.
            console.warn("[uiClipboard] could not publish the copied selection", error);
        }
    })();
}

/** Where a paste's payload came from, and whether this project minted the ids in it. */
export type UiPasteSource = {
    payload: UIEditorClipboardPayload;
    foreign: boolean;
    environment: UiClipboardEnvironment | null;
};

/**
 * The payload a paste should use: the platform clipboard's, or this window's own.
 *
 * The clipboard outranks the in-window copy whenever the two are different copies, because the
 * clipboard is what the author last put there - possibly in another project's window. When they are
 * the *same* copy the in-window payload is used verbatim, which is what keeps a same-project paste
 * byte for byte what it has always been.
 *
 * A clipboard holding something else - text from another application, or nothing - leaves the
 * in-window copy standing rather than clearing it. That is the behaviour this editor has always
 * had, and it is the one an author expects of a copy they made in this window.
 */
export async function resolveUiPasteSource(documentService: UIDocumentService): Promise<UiPasteSource | null> {
    const inMemory = getUiEditorClipboard();
    const environment = readUiClipboardEnvironment(documentService);
    if (!environment) {
        return inMemory ? { payload: inMemory, foreign: false, environment: null } : null;
    }
    const fromClipboard = await readSystemClipboardPayload();
    const payload = !fromClipboard || (inMemory?.copyId && fromClipboard.copyId === inMemory.copyId)
        ? inMemory
        : fromClipboard;
    if (!payload) {
        return null;
    }
    return {
        payload,
        // Asked of the payload rather than of where it was found: a foreign copy read off the
        // clipboard once is remembered in this window (see {@link refreshUiClipboardFromSystem}),
        // and it is no less foreign the second time it is pasted.
        foreign: isUiPasteFromAnotherProject(payload, environment.projectPath),
        environment,
    };
}

/**
 * Take the platform clipboard's payload as this window's own, when it is a different copy.
 *
 * Called when the window comes forward, which is necessarily after any copy made elsewhere and
 * before any paste made here. Without it a window that has copied nothing itself offers a greyed
 * "Paste" row over a clipboard that does hold a selection - the keyboard would paste it and the
 * menu would say there was nothing to paste.
 *
 * A clipboard holding something else leaves this window's copy standing, for the reason
 * {@link resolveUiPasteSource} gives.
 */
export async function refreshUiClipboardFromSystem(): Promise<void> {
    const payload = await readSystemClipboardPayload();
    if (payload && payload.copyId !== getUiEditorClipboard()?.copyId) {
        setUiEditorClipboard(payload);
    }
}

/** What a foreign paste did, in the terms the author is told about it. */
export type ForeignUiPasteReport = {
    /** Files that were not in this project and now are. */
    imported: number;
    /** Fields still naming something this project does not have, counted per field. */
    unresolved: number;
    /** The workspace froze part-way through; the caller must abandon the paste. */
    frozen: boolean;
};

/**
 * Bring over what a foreign payload references, before its elements are written.
 *
 * Before rather than after, so an imported file makes its widget draw on the spot rather than after
 * a second gesture. The freeze is re-read on the far side of the import for the reason every other
 * awaited editor write does it: elements written into a frozen workspace reach the in-memory
 * document, are refused at the file-system boundary, and are gone again at the thaw.
 */
export async function importForeignUiAssets(source: UiPasteSource): Promise<ForeignUiPasteReport> {
    const { environment, payload } = source;
    const report: ForeignUiPasteReport = { imported: 0, unresolved: 0, frozen: false };
    const port = createPortFor(environment);
    if (!environment || !port) {
        return report;
    }
    const transfer = await importTransferredAssets(
        port,
        payload.assets ? { token: payload.assets.token, declaredAssetIds: payload.assets.entries.map(entry => entry.assetId) } : undefined,
        collectUiClipboardAssetIds(payload, environment.resolveAssetPins),
    );
    if (transfer.frozen || environment.isFrozen()) {
        return { ...report, frozen: true };
    }
    return { ...report, imported: transfer.imported };
}

/**
 * Say what the paste did, once.
 *
 * Counts only: which files came over, and how many references still need the author. Every
 * unresolved id is also reported per site by the project lint - `assets/missing` for a file,
 * `ui/component-missing` for an instance of a component this project does not have - and that is
 * the report which can jump to the widget holding it.
 */
export function reportForeignUiPaste(
    documentService: UIDocumentService,
    source: UiPasteSource,
    report: ForeignUiPasteReport,
): void {
    const { environment, payload } = source;
    if (!environment) {
        return;
    }
    const port = createPortFor(environment);
    const surfaceIds = new Set(documentService.getDocument().surfaces?.map(surface => surface.id) ?? []);
    const unresolved = countUnresolvedUiAssetSites(
        payload,
        assetId => port?.has(assetId) ?? false,
        environment.resolveAssetPins,
    )
        + countUnresolvedUiComponentInstances(payload, componentId => Boolean(documentService.getComponent(componentId)))
        + countUnresolvedUiFrameTargets(payload, surfaceId => surfaceIds.has(surfaceId));
    environment.uiService?.showNotification(
        describeForeignUiPaste({
            elements: Object.keys(payload.elements).length,
            project: readClipboardProjectName(payload.source?.name),
            imported: report.imported,
            unresolved,
        }),
        unresolved > 0 ? "warning" : "info",
    );
}

/**
 * Vouch for the files a copied selection references, and take back the token standing for them.
 *
 * A selection whose widgets reference no importable file offers nothing at all, which is most
 * selections. A refusal is data and arrives as one; a transport that throws is logged rather than
 * raised, because the copy has already happened.
 */
async function offerClipboardAssets(
    environment: UiClipboardEnvironment,
    payload: UIEditorClipboardPayload,
): Promise<UIEditorClipboardPayload["assets"]> {
    const { assetsService } = environment;
    if (!assetsService) {
        return undefined;
    }
    const assetIds = collectUiClipboardAssetIds(payload, environment.resolveAssetPins);
    const entries: AssetTransferEntry[] = buildAssetTransferEntries(assetsService, assetIds);
    if (entries.length === 0) {
        return undefined;
    }
    try {
        const status = await getInterface().assets.transfer.offer(entries);
        if (!status.success || !status.data.offered) {
            return undefined;
        }
        return {
            token: status.data.token,
            // The paths stay in the offering process. What travels is what a paste is allowed to
            // know: which files these are, not where they live.
            entries: entries.map(({ sourcePath: _path, ...manifest }) => manifest),
        };
    } catch (error) {
        console.warn("[uiClipboard] could not offer the selection's assets", error);
        return undefined;
    }
}

async function readSystemClipboardPayload(): Promise<UIEditorClipboardPayload | null> {
    try {
        const status = await getInterface().clipboard.readEditorSelection(CLIPBOARD_KIND);
        const json = status.success ? status.data.payload : null;
        return json ? readUiEditorClipboardPayload(json) : null;
    } catch (error) {
        console.warn("[uiClipboard] could not read the platform clipboard", error);
        return null;
    }
}

function createPortFor(environment: UiClipboardEnvironment | null): TransferredAssetPort | null {
    if (!environment?.assetsService || !environment.fileSystemService) {
        return null;
    }
    return createTransferredAssetPort(environment.assetsService, environment.fileSystemService, environment.isFrozen);
}

function tryGetContext(documentService: UIDocumentService): ReturnType<UIDocumentService["getContext"]> | null {
    try {
        return documentService.getContext();
    } catch {
        return null;
    }
}

/**
 * The asset-bearing pins a node type declares, or null when the catalogue has never heard of it.
 *
 * Null and "declares none" are different answers, and `referenceModel` acts on the difference: a
 * node left behind by a plugin this project does not have could be holding anything.
 */
function resolveCatalogAssetPins(
    catalog: BlueprintNodeCatalogService | null,
    nodeType: string,
): readonly BlueprintAssetPin[] | null {
    if (!catalog) {
        return null;
    }
    try {
        if (!catalog.get(nodeType)) {
            return null;
        }
        return catalog.resolveCatalogEntry(nodeType).pins.flatMap(pin => (pin.assetRef
            ? [{
                pinId: pin.id,
                kind: pin.assetRef.kind,
                paramKey: pin.assetRef.paramKey ?? pin.id,
                input: pin.kind === "input",
                origin: pin.assetRef.origin,
            }]
            : []));
    } catch {
        return null;
    }
}

/**
 * The source project's name, when it is one a notification can carry.
 *
 * A payload written by another process says what it likes about itself, so a name that is blank or
 * longer than a line is dropped rather than shortened - the paste then reports its counts without
 * naming where they came from, which is true either way.
 */
function readClipboardProjectName(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const name = value.trim();
    return name && name.length <= CLIPBOARD_PROJECT_NAME_LIMIT ? name : null;
}

const CLIPBOARD_PROJECT_NAME_LIMIT = 64;

/** What a foreign paste did, as one line of counts. Anything that came to nothing is left out. */
function describeForeignUiPaste(outcome: {
    elements: number;
    project: string | null;
    imported: number;
    unresolved: number;
}): string {
    const parts = [
        outcome.project
            ? translateN("uiEditor.crossProject.pastedFrom", outcome.elements, { project: outcome.project })
            : translateN("uiEditor.crossProject.pasted", outcome.elements),
    ];
    if (outcome.imported > 0) {
        parts.push(translateN("uiEditor.crossProject.imported", outcome.imported));
    }
    if (outcome.unresolved > 0) {
        parts.push(translateN("uiEditor.crossProject.unresolved", outcome.unresolved));
    }
    return parts.join(" · ");
}
