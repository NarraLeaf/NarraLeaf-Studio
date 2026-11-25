import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { Checkbox, Input, Select } from "@/lib/components/elements";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { AssetCategory, AssetExtensions, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { Services } from "@/lib/workspace/services/services";
import type { CharacterAppearance } from "@/lib/workspace/services/character/CharacterAppearance";
import type { StoredCharacter } from "@/lib/workspace/services/character/types";
import { fileUnderCharacterFolder } from "@/lib/workspace/services/character/psdImportFolder";
import {
    fileStem,
    imageNameStem,
    normalizePoseNamingRule,
    planPoseSources,
    uniquePoseNames,
    uniquePrefixes,
    type PoseNamingJoiner,
    type PoseNamingRule,
} from "@/lib/workspace/services/character/poseBatchImport";
import { cn } from "@/lib/utils/cn";
import { getPoseNamingRule, setPoseNamingRule } from "../characterEditorPaneState";

/**
 * Where the poses come from.
 *
 * `folder` is the automatic path: a folder on disk, read recursively, of which only the files named
 * after the character are offered. `assets` is the batch path: images the author ticked in the
 * library picker, every one of which is offered.
 */
export type PoseBatchSource =
    | { kind: "folder"; folder: string; files: string[] }
    | { kind: "assets"; assets: Asset[] };

/** What a candidate already is in this project, which decides whether it is imported, reused or skipped. */
type CandidateStatus = "pending" | "new" | "library" | "added";

type Row = {
    key: string;
    stem: string;
    /** The file to import, or null for an image already in the library. */
    path: string | null;
    /** The image it is, when it is one the library already has. */
    assetId: string | null;
    status: CandidateStatus;
    derived: string;
};

const JOINER_LABEL_KEYS = {
    " ": "characters.editor.poseBatch.joinerSpace",
    "_": "characters.editor.poseBatch.joinerUnderscore",
    "-": "characters.editor.poseBatch.joinerHyphen",
    "": "characters.editor.poseBatch.joinerNone",
} as const satisfies Record<PoseNamingJoiner, string>;

/**
 * Ask for a folder and list the images under it. Null when the author cancels or the folder cannot be
 * read; the second case is logged, and a folder with no images comes back with an empty list so the
 * dialog can say so.
 */
export async function pickPoseFolder(assetsService: AssetsService): Promise<PoseBatchSource | null> {
    const picked = await getInterface().fs.selectDirectory(false);
    if (!picked.success || !picked.data.ok) {
        return null;
    }
    const folder = picked.data.data[0];
    if (!folder) {
        return null;
    }
    try {
        const expanded = await assetsService.expandImportPaths(AssetType.Image, [folder]);
        return { kind: "folder", folder, files: expanded.files };
    } catch (error) {
        console.warn("[characters] could not read the sprite folder", error);
        return { kind: "folder", folder, files: [] };
    }
}

async function hashFile(path: string): Promise<string | null> {
    try {
        const result = await getInterface().fs.hash(path);
        return result.success && result.data.ok && result.data.data ? result.data.data : null;
    } catch {
        return null;
    }
}

/**
 * Review, name and add a batch of poses.
 *
 * Nothing is written until Add. Every candidate is listed with the name it will get, and the author
 * can untick one, rename one, or change the rule and watch every name follow. A file already in the
 * library (same bytes) is reused rather than imported a second time, and an image some pose of this
 * character already shows is listed but unticked: running the import again after adding three new
 * expressions to the folder offers the three, not all forty again.
 *
 * The whole add is one step of undo, the way a PSD import is: the poses go, and so do the files it
 * brought into the library and the character folder it made for them.
 */
export function PoseBatchDialog(props: {
    /** Mounted only while open: a new source is a new review, with nothing carried over. */
    source: PoseBatchSource;
    onClose: () => void;
    characterId: string;
    characterName: string;
    appearance: CharacterAppearance;
    /** After a successful add, with the poses it made. */
    onAdded?: (poseIds: string[]) => void;
}) {
    const { t, tn } = useTranslation();
    const { context } = useWorkspace();
    const freeze = useFreezeGuard();
    const assetsService = context?.services.get<AssetsService>(Services.Assets) ?? null;
    const panelState = context?.services.get<PanelStateService>(Services.PanelState) ?? null;

    const [source, setSource] = useState<PoseBatchSource>(props.source);
    const [rule, setRule] = useState<PoseNamingRule>(() => normalizePoseNamingRule(
        panelState ? getPoseNamingRule(panelState, props.characterId) : null,
        props.characterName,
    ));
    const [prefixDraft, setPrefixDraft] = useState("");
    const [hashes, setHashes] = useState<Record<string, string | null>>({});
    const [unticked, setUnticked] = useState<Record<string, boolean>>({});
    const [ticked, setTicked] = useState<Record<string, boolean>>({});
    const [edited, setEdited] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const updateRule = useCallback((patch: Partial<PoseNamingRule>) => {
        setRule(current => {
            const next = { ...current, ...patch };
            if (panelState) setPoseNamingRule(panelState, props.characterId, next);
            return next;
        });
        // A rule change renames every row; a hand-typed name is the author's and stays.
    }, [panelState, props.characterId]);

    // Hash the folder's files, a few at a time, to recognise images the library already has.
    const files = source.kind === "folder" ? source.files : null;
    useEffect(() => {
        if (!files || files.length === 0) return;
        let cancelled = false;
        const queue = [...files];
        const worker = async () => {
            for (let path = queue.shift(); path !== undefined && !cancelled; path = queue.shift()) {
                const hash = await hashFile(path);
                if (!cancelled) setHashes(current => ({ ...current, [path as string]: hash }));
            }
        };
        void Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
        return () => { cancelled = true; };
    }, [files]);

    const rows = useMemo<Row[]>(() => {
        const used = new Set<string>();
        for (const pose of props.appearance.getPoses()) {
            if (pose.assetId) used.add(pose.assetId);
            for (const id of pose.sequence?.frameAssetIds ?? []) used.add(id);
        }
        if (source.kind === "assets") {
            return planPoseSources(source.assets.map(asset => ({ key: asset.id, stem: imageNameStem(asset.name, AssetExtensions[AssetType.Image]) })), rule, false)
                .map(entry => ({
                    key: entry.key,
                    stem: entry.stem,
                    path: null,
                    assetId: entry.key,
                    status: used.has(entry.key) ? "added" : "library",
                    derived: entry.name,
                }));
        }
        const images = assetsService?.getAssets()[AssetType.Image] ?? {};
        const byHash = new Map<string, string>();
        for (const image of Object.values(images)) {
            if (image.hash && !byHash.has(image.hash)) byHash.set(image.hash, image.id);
        }
        return planPoseSources(source.files.map(path => ({ key: path, stem: fileStem(path) })), rule, true)
            .map(entry => {
                const hash = hashes[entry.key];
                const assetId = hash ? byHash.get(hash) ?? null : null;
                const status: CandidateStatus = hash === undefined
                    ? "pending"
                    : assetId
                        ? (used.has(assetId) ? "added" : "library")
                        : "new";
                return { key: entry.key, stem: entry.stem, path: entry.key, assetId, status, derived: entry.name };
            });
    }, [assetsService, hashes, props.appearance, rule, source]);

    // An image a pose already shows starts unticked; everything else starts ticked.
    const isTicked = useCallback((row: Row) => (
        row.status === "added" ? Boolean(ticked[row.key]) : !unticked[row.key]
    ), [ticked, unticked]);
    const setRowTicked = useCallback((row: Row, on: boolean) => {
        if (row.status === "added") setTicked(current => ({ ...current, [row.key]: on }));
        else setUnticked(current => ({ ...current, [row.key]: !on }));
    }, []);

    const chosen = rows.filter(isTicked);
    const finalNames = useMemo(() => {
        const names = uniquePoseNames(
            chosen.map(row => edited[row.key]?.trim() || row.derived),
            props.appearance.getPoses().map(pose => pose.name),
        );
        return new Map(chosen.map((row, index) => [row.key, names[index]]));
    }, [chosen, edited, props.appearance]);
    const importCount = chosen.filter(row => !row.assetId).length;
    const pending = chosen.some(row => row.status === "pending");
    const allTicked = rows.length > 0 && chosen.length === rows.length;

    const addPrefix = useCallback(() => {
        const next = uniquePrefixes([...rule.prefixes, prefixDraft]);
        setPrefixDraft("");
        if (next.length !== rule.prefixes.length) updateRule({ prefixes: next });
    }, [prefixDraft, rule.prefixes, updateRule]);

    const changeFolder = useCallback(async () => {
        if (!assetsService) return;
        const next = await pickPoseFolder(assetsService);
        if (next) {
            setSource(next);
            setUnticked({});
            setTicked({});
            setEdited({});
            setHashes({});
        }
    }, [assetsService]);

    const add = useCallback(async () => {
        const characterService = context?.services.get<CharacterService>(Services.Character);
        const character = characterService?.getCharacter(props.characterId);
        if (!assetsService || !characterService || !character || chosen.length === 0 || freeze.frozen || pending) return;
        setBusy(true);
        setError(null);
        const change = assetsService.beginLibraryChange();
        let recorded = false;
        try {
            const before = structuredClone(character.toJSON()) as StoredCharacter;
            const toImport = chosen.filter(row => !row.assetId && row.path);
            const assetIds = new Map<string, string>();
            for (const row of chosen) if (row.assetId) assetIds.set(row.key, row.assetId);
            let imported: Asset[] = [];
            if (toImport.length > 0) {
                const result = await assetsService.importFromPaths(AssetType.Image, toImport.map(row => row.path as string));
                if (!result.success) {
                    console.warn("[characters] could not import the pose images", result.error);
                    setError(t("characters.editor.poseBatch.failed"));
                    return;
                }
                // One result per path, in order, which is what matches an image back to its row.
                toImport.forEach((row, index) => {
                    const status = result.data[index];
                    if (status?.success && status.data) assetIds.set(row.key, status.data.id);
                });
                imported = result.data.flatMap(status => (status.success && status.data ? [status.data] : []));
                change?.noteImported(imported);
                const filed = await fileUnderCharacterFolder(assetsService, imported, props.characterName);
                if (!filed.success) {
                    console.warn("[characters] could not file the pose images under the character's folder", filed.error);
                } else if (filed.data?.created) {
                    change?.noteCreatedFolder(AssetCategory.Image, filed.data.id);
                }
            }
            const entries = chosen.flatMap(row => {
                const assetId = assetIds.get(row.key);
                return assetId ? [{ name: finalNames.get(row.key) ?? row.derived, assetId }] : [];
            });
            if (entries.length === 0) {
                setError(t("characters.editor.poseBatch.failed"));
                return;
            }
            const made = props.appearance.addPoses(entries);
            characterService.recordCharacterEdit(
                props.characterId,
                before,
                { key: "workspace.history.entry.addPoses" },
                change ?? undefined,
            );
            recorded = true;
            props.onAdded?.(made.map(pose => pose.id));
            props.onClose();
            const missed = chosen.length - entries.length;
            if (missed > 0) {
                // The rest are in; the files that would not import are named in the log.
                console.warn("[characters] some pose images were not imported", chosen.filter(row => !assetIds.has(row.key)).map(row => row.path));
                void context?.services.get<UIService>(Services.UI)?.showAlert(tn("characters.editor.poseBatch.partlyFailed", missed));
            }
        } catch (thrown: unknown) {
            console.warn("[characters] batch pose import failed", thrown);
            setError(t("characters.editor.poseBatch.failed"));
        } finally {
            if (change && !recorded) {
                await change.undo().catch(undoError => {
                    console.warn("[characters] could not take back a failed pose import", undoError);
                });
                change.dispose();
            }
            setBusy(false);
        }
    }, [assetsService, chosen, context, finalNames, freeze.frozen, pending, props, t, tn]);

    const isFolder = source.kind === "folder";
    const addDisabled = chosen.length === 0 || busy || pending;

    return (
        <Modal
            isOpen
            onClose={props.onClose}
            title={t(isFolder ? "characters.editor.poseBatch.autoTitle" : "characters.editor.poseBatch.batchTitle")}
            helpTopic="appearances"
            size="lg"
            closeOnOverlayClick={!busy}
            footer={
                <div className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
                        {pending
                            ? t("characters.editor.poseBatch.reading")
                            : chosen.length > 0 && importCount > 0
                                ? tn("characters.editor.poseBatch.importCount", importCount)
                                : ""}
                    </span>
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "secondary", disabled: busy })}
                        onClick={props.onClose}
                        disabled={busy}
                    >
                        {t("common.cancel")}
                    </button>
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "primary", disabled: addDisabled || freeze.frozen })}
                        onClick={() => void add()}
                        {...freeze.writes(addDisabled)}
                    >
                        {busy
                            ? t("characters.editor.poseBatch.adding")
                            : tn("characters.editor.poseBatch.add", chosen.length)}
                    </button>
                </div>
            }
        >
            <div className="space-y-4">
                {source.kind === "folder" && (
                    <div className="flex items-center gap-2 text-xs">
                        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                        <span className="min-w-0 flex-1 truncate text-fg-muted" title={source.folder}>{source.folder}</span>
                        <button
                            type="button"
                            className={dialogFooterButtonClass({ variant: "secondary", disabled: busy })}
                            onClick={() => void changeFolder()}
                            disabled={busy}
                        >
                            {t("characters.editor.poseBatch.changeFolder")}
                        </button>
                    </div>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <FieldLabel as="span" density="page" className="mb-0 mr-1.5">{t("characters.editor.poseBatch.prefixes")}</FieldLabel>
                        {rule.prefixes.map(prefix => (
                            <span
                                key={prefix}
                                data-pose-prefix={prefix}
                                className="inline-flex min-h-7 items-center gap-1 rounded-md border border-edge pl-2 pr-1 text-xs"
                            >
                                {prefix}
                                <button
                                    type="button"
                                    className="rounded-md p-0.5 text-fg-subtle hover:bg-fill hover:text-fg"
                                    aria-label={t("characters.editor.poseBatch.removePrefix", { prefix })}
                                    onClick={() => updateRule({ prefixes: rule.prefixes.filter(entry => entry !== prefix) })}
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                        <Input
                            size="sm"
                            className="w-28"
                            value={prefixDraft}
                            placeholder={t("characters.editor.poseBatch.addPrefix")}
                            aria-label={t("characters.editor.poseBatch.addPrefix")}
                            onChange={event => setPrefixDraft(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    addPrefix();
                                }
                            }}
                            onBlur={() => { if (prefixDraft.trim()) addPrefix(); }}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <FieldLabel as="span" density="page" className="mb-0">{t("characters.editor.poseBatch.separators")}</FieldLabel>
                        <Input
                            size="sm"
                            className="w-20 font-mono"
                            value={rule.separators}
                            aria-label={t("characters.editor.poseBatch.separators")}
                            placeholder={t("characters.editor.poseBatch.separators")}
                            onChange={event => updateRule({ separators: event.target.value })}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <FieldLabel as="span" density="page" className="mb-0">{t("characters.editor.poseBatch.joiner")}</FieldLabel>
                        <Select
                            size="sm"
                            portalMenu
                            ariaLabel={t("characters.editor.poseBatch.joiner")}
                            value={rule.joiner === "" ? "none" : rule.joiner}
                            options={(Object.keys(JOINER_LABEL_KEYS) as PoseNamingJoiner[]).map(joiner => ({
                                value: joiner === "" ? "none" : joiner,
                                labelKey: JOINER_LABEL_KEYS[joiner],
                            }))}
                            onChange={value => updateRule({ joiner: (value === "none" ? "" : value) as PoseNamingJoiner })}
                        />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center gap-2 px-1">
                        <Checkbox
                            checked={allTicked}
                            disabled={rows.length === 0}
                            onCheckedChange={on => rows.forEach(row => setRowTicked(row, on))}
                            aria-label={t("characters.editor.poseBatch.selectAll")}
                        />
                        <span className="text-xs font-semibold text-fg">
                            {tn("characters.editor.poseBatch.found", rows.length)}
                        </span>
                    </div>
                    {rows.length === 0 ? (
                        <p className="px-1 py-6 text-center text-xs text-fg-subtle">
                            {isFolder
                                ? t("characters.editor.poseBatch.noMatches")
                                : t("characters.editor.poseBatch.nothing")}
                        </p>
                    ) : (
                        <div className="max-h-80 space-y-1 overflow-y-auto">
                            {rows.map(row => {
                                const on = isTicked(row);
                                return (
                                    <div
                                        key={row.key}
                                        data-pose-candidate={row.stem}
                                        className={cn(
                                            "flex items-center gap-2 rounded-md border border-edge bg-fill-subtle px-2 py-1 text-xs",
                                            !on && "opacity-60",
                                        )}
                                    >
                                        <Checkbox
                                            checked={on}
                                            onCheckedChange={next => setRowTicked(row, next)}
                                            aria-label={row.stem}
                                        />
                                        <span className="w-2/5 min-w-0 truncate text-fg-muted" title={row.path ?? row.stem}>
                                            {row.stem}
                                        </span>
                                        <span className="w-16 shrink-0 text-right text-2xs text-fg-subtle">
                                            {row.status === "added"
                                                ? t("characters.editor.poseBatch.statusAdded")
                                                : row.status === "library" && row.path
                                                    // Only worth saying of a file: every image picked
                                                    // from the library is in it by definition.
                                                    ? t("characters.editor.poseBatch.statusLibrary")
                                                    : ""}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                        <Input
                                            size="sm"
                                            fullWidth
                                            value={edited[row.key] ?? (on ? finalNames.get(row.key) : undefined) ?? row.derived}
                                            disabled={!on}
                                            aria-label={t("characters.editor.poseBatch.poseName", { file: row.stem })}
                                            onChange={event => {
                                                const value = event.target.value;
                                                setEdited(current => ({ ...current, [row.key]: value }));
                                            }}
                                            onBlur={() => {
                                                if (!(edited[row.key] ?? "").trim()) {
                                                    setEdited(current => {
                                                        const next = { ...current };
                                                        delete next[row.key];
                                                        return next;
                                                    });
                                                }
                                            }}
                                        />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {error && <p className="text-xs text-danger">{error}</p>}
            </div>
        </Modal>
    );
}
