import type { AssetTransferEntry } from "@shared/types/assetTransfer";
import { getInterface } from "@/lib/app/bridge";
import { translateN } from "@/lib/i18n";
import {
    buildAssetTransferEntries,
    createTransferredAssetPort,
    importTransferredAssets,
    type TransferredAssetPort,
} from "@/lib/workspace/services/assets/assetTransferImport";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import type { BlueprintAssetPinResolver } from "@/lib/workspace/services/references/referenceModel";
import type { Service } from "@/lib/workspace/services/Service";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { createCatalogAssetPinResolver } from "./catalogAssetPins";
import { collectProjectElementIds } from "./elementRefSites";
import {
    getBlueprintGraphClipboard,
    readBlueprintGraphClipboardPayload,
    setBlueprintGraphClipboard,
    type BlueprintGraphClipboardPayload,
    type BlueprintGraphClipboardSource,
} from "./graphClipboard";
import {
    collectGraphClipboardAssetIds,
    countUnresolvedGraphAssetSites,
    countUnresolvedGraphElementRefs,
    countUnresolvedGraphFnCalls,
    isBlueprintGraphPasteFromAnotherProject,
} from "./graphForeignPaste";

/**
 * The workspace half of the graph editor's clipboard.
 *
 * A graph fragment used to live in a module variable, and a workspace window is its own renderer
 * process - so a copy could only ever be pasted back into the window that made it, while the
 * elements those graphs belong to had already learned to travel. Everything that needs a project
 * behind it lives here, so the rules about what a foreign payload does stay pure and testable
 * (`graphForeignPaste`).
 *
 * The route is the interface editor's (`uiEditorClipboardBridge`), deliberately: copy, cut and paste
 * in this editor are keybindings, and the keybinding dispatcher cancels the keystroke before
 * Chromium would raise a clipboard event - so the payload goes through the main process, which is
 * the only part of Studio holding the platform clipboard.
 */

const CLIPBOARD_KIND = "blueprint-nodes" as const;

/** What a copy and a paste need of the project around them. */
export type GraphClipboardEnvironment = {
    /** This window's project directory: the identity a pasted payload is compared against. */
    projectPath: string;
    /** What this project is called, carried on the clipboard so a foreign paste can name its source. */
    projectName: string;
    /** The project's `identifier`. Travels for display; it is not an identity. */
    projectIdentifier: string;
    assetsService: AssetsService | null;
    fileSystemService: FileSystemService | null;
    uiService: UIService | null;
    localBlueprintService: LocalBlueprintService | null;
    uiDocumentService: UIDocumentService | null;
    /** Read at the moment it is asked, because the callers ask again after every await. */
    isFrozen: () => boolean;
    /** Declared asset pins per node type, so a fragment is swept as the reference index sweeps it. */
    resolveAssetPins: BlueprintAssetPinResolver;
};

/**
 * The project around a workspace context, or null when there is none to read.
 *
 * Every lookup is guarded rather than assumed: a service registry that is still coming up must cost
 * the editor its cross-project reach and nothing else - the in-window clipboard is what this editor
 * had before, and it keeps working.
 */
export function readGraphClipboardEnvironment(
    context: WorkspaceContext | null | undefined,
): GraphClipboardEnvironment | null {
    if (!context) {
        return null;
    }
    const get = <T extends Service>(key: Services): T | null => {
        try {
            return context.services.get<T>(key);
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
        // Only the display half of a copy. A graph that can be edited because the blueprint loaded
        // is worth more than a clipboard payload with a name on it.
    }
    let projectPath = "";
    try {
        projectPath = context.project.getConfig().projectPath ?? "";
    } catch {
        // Without an identity nothing can be called foreign, so a copy made here is pasted here as
        // it always was. A keystroke may not raise a fault report for a project that is still
        // opening.
        return null;
    }
    return {
        projectPath,
        projectName,
        projectIdentifier,
        assetsService: get<AssetsService>(Services.Assets),
        fileSystemService: get<FileSystemService>(Services.FileSystem),
        uiService: get<UIService>(Services.UI),
        localBlueprintService: get<LocalBlueprintService>(Services.LocalBlueprint),
        uiDocumentService: get<UIDocumentService>(Services.UIDocument),
        isFrozen: () => freezeService?.isFrozen() ?? false,
        resolveAssetPins: createCatalogAssetPinResolver(catalog),
    };
}

/** The stamp a copy made in this project carries. */
export function graphClipboardSourceStamp(
    environment: GraphClipboardEnvironment,
): BlueprintGraphClipboardSource {
    return {
        path: environment.projectPath,
        identifier: environment.projectIdentifier,
        name: environment.projectName,
    };
}

/**
 * Put a copied fragment where the other project windows can reach it.
 *
 * Deliberately not awaited by the gesture that starts it. The in-window clipboard is already filled
 * by the time this runs, so the copy has happened; what is left is one round trip to vouch for the
 * files the fragment references and one to hand the payload to the platform clipboard, and making
 * Ctrl+C wait for either would be a pause with nothing to show for it. A copy whose grant has not
 * come back yet still reaches other windows - as a payload with no manifest, which is exactly what
 * a paste already handles when the copying window has closed.
 */
export function publishGraphClipboard(
    environment: GraphClipboardEnvironment,
    payload: BlueprintGraphClipboardPayload,
): void {
    void (async () => {
        const assets = await offerClipboardAssets(environment, payload);
        // The offer is folded into the payload the clipboard receives and into the one this window
        // holds, so a same-window paste and a cross-window paste describe the same copy.
        const published: BlueprintGraphClipboardPayload = assets ? { ...payload, assets } : payload;
        if (getBlueprintGraphClipboard()?.copyId === payload.copyId) {
            setBlueprintGraphClipboard(published);
        }
        try {
            await getInterface().clipboard.writeEditorSelection(CLIPBOARD_KIND, JSON.stringify(published));
        } catch (error) {
            // A copy that raised a dialog because the platform clipboard was busy would be a fault
            // report for pressing Ctrl+C. The window keeps its own copy either way.
            console.warn("[graphClipboard] could not publish the copied nodes", error);
        }
    })();
}

/** Where a paste's payload came from, and whether this project minted the ids in it. */
export type GraphPasteSource = {
    payload: BlueprintGraphClipboardPayload;
    foreign: boolean;
    environment: GraphClipboardEnvironment | null;
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
export async function resolveGraphPasteSource(
    environment: GraphClipboardEnvironment | null,
): Promise<GraphPasteSource | null> {
    const inMemory = getBlueprintGraphClipboard();
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
        // Asked of the payload rather than of where it was found: the same foreign copy is read off
        // the clipboard again on the next paste, and it is no less foreign the second time.
        foreign: isBlueprintGraphPasteFromAnotherProject(payload, environment.projectPath),
        environment,
    };
}

/** What a foreign paste did, in the terms the author is told about it. */
export type ForeignGraphPasteReport = {
    /** Files that were not in this project and now are. */
    imported: number;
    /** The workspace froze part-way through; the caller must abandon the paste. */
    frozen: boolean;
};

/**
 * Bring over what a foreign fragment references, before its nodes are written.
 *
 * Before rather than after, so an imported file makes its node resolve on the spot rather than
 * after a second gesture. The freeze is re-read on the far side of the import for the reason every
 * other awaited editor write does it: nodes written into a frozen workspace reach the in-memory
 * document, are refused at the file-system boundary, and are gone again at the thaw.
 */
export async function importForeignGraphAssets(source: GraphPasteSource): Promise<ForeignGraphPasteReport> {
    const { environment, payload } = source;
    const report: ForeignGraphPasteReport = { imported: 0, frozen: false };
    const port = createPortFor(environment);
    if (!environment || !port) {
        return report;
    }
    const transfer = await importTransferredAssets(
        port,
        payload.assets
            ? { token: payload.assets.token, declaredAssetIds: payload.assets.entries.map(entry => entry.assetId) }
            : undefined,
        collectGraphClipboardAssetIds(payload, environment.resolveAssetPins),
    );
    if (transfer.frozen || environment.isFrozen()) {
        return { ...report, frozen: true };
    }
    return { ...report, imported: transfer.imported };
}

/**
 * Say what the paste did, once.
 *
 * Counts only: which files came across, and how many references still need the author. Every
 * unresolved reference is also reported per site - `assets/missing` for a file,
 * `blueprint/element-ref-missing` for a widget, `blueprint/fn-target-missing` for a call - and
 * those are the reports that can jump to the node holding it.
 */
export function reportForeignGraphPaste(source: GraphPasteSource, report: ForeignGraphPasteReport): void {
    const { environment, payload } = source;
    if (!environment) {
        return;
    }
    const port = createPortFor(environment);
    const unresolved = countUnresolvedGraphAssetSites(
        payload,
        assetId => port?.has(assetId) ?? false,
        environment.resolveAssetPins,
    )
        + countUnresolvedGraphElementRefs(payload, readsElement(environment))
        + countUnresolvedGraphFnCalls(payload, readsBlueprint(environment));
    environment.uiService?.showNotification(
        describeForeignGraphPaste({
            nodes: payload.nodeIds.length,
            project: readClipboardProjectName(payload.source?.name),
            imported: report.imported,
            unresolved,
        }),
        unresolved > 0 ? "warning" : "info",
    );
}

/**
 * Vouch for the files a copied fragment references, and take back the token standing for them.
 *
 * A fragment whose nodes reference no importable file offers nothing at all, which is most
 * fragments. A refusal is data and arrives as one; a transport that throws is logged rather than
 * raised, because the copy has already happened.
 */
async function offerClipboardAssets(
    environment: GraphClipboardEnvironment,
    payload: BlueprintGraphClipboardPayload,
): Promise<BlueprintGraphClipboardPayload["assets"]> {
    const { assetsService } = environment;
    if (!assetsService) {
        return undefined;
    }
    const assetIds = collectGraphClipboardAssetIds(payload, environment.resolveAssetPins);
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
        console.warn("[graphClipboard] could not offer the fragment's assets", error);
        return undefined;
    }
}

async function readSystemClipboardPayload(): Promise<BlueprintGraphClipboardPayload | null> {
    try {
        const status = await getInterface().clipboard.readEditorSelection(CLIPBOARD_KIND);
        const json = status.success ? status.data.payload : null;
        return json ? readBlueprintGraphClipboardPayload(json) : null;
    } catch (error) {
        console.warn("[graphClipboard] could not read the platform clipboard", error);
        return null;
    }
}

function createPortFor(environment: GraphClipboardEnvironment | null): TransferredAssetPort | null {
    if (!environment?.assetsService || !environment.fileSystemService) {
        return null;
    }
    return createTransferredAssetPort(environment.assetsService, environment.fileSystemService, environment.isFrozen);
}

/**
 * Whether this project has the element behind an id.
 *
 * A document that cannot be read answers yes to everything rather than no. The notification says
 * what the paste achieved, and one failed read must not turn that into an accusation about graphs
 * nobody has looked at - the lint sweep asks the same question again with the document in hand.
 */
function readsElement(environment: GraphClipboardEnvironment): (elementId: string) => boolean {
    try {
        const document = environment.uiDocumentService?.getDocument();
        if (!document) {
            return () => true;
        }
        const ids = collectProjectElementIds(document);
        return elementId => ids.has(elementId);
    } catch {
        return () => true;
    }
}

/** Whether this project has the blueprint behind an id. Unreadable answers yes, as above. */
function readsBlueprint(environment: GraphClipboardEnvironment): (blueprintId: string) => boolean {
    try {
        const document = environment.localBlueprintService?.getBlueprintDocument();
        if (!document) {
            return () => true;
        }
        const ids = new Set(Object.keys(document.blueprints ?? {}));
        return blueprintId => ids.has(blueprintId);
    } catch {
        return () => true;
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
function describeForeignGraphPaste(outcome: {
    nodes: number;
    project: string | null;
    imported: number;
    unresolved: number;
}): string {
    const parts = [
        outcome.project
            ? translateN("blueprint.crossProject.pastedFrom", outcome.nodes, { project: outcome.project })
            : translateN("blueprint.crossProject.pasted", outcome.nodes),
    ];
    if (outcome.imported > 0) {
        parts.push(translateN("blueprint.crossProject.imported", outcome.imported));
    }
    if (outcome.unresolved > 0) {
        parts.push(translateN("blueprint.crossProject.unresolved", outcome.unresolved));
    }
    return parts.join(" · ");
}
