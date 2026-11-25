import React, { useCallback, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Checkbox, Input, Select } from "@/lib/components/elements";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { AssetCategory, AssetExtensions, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { Services } from "@/lib/workspace/services/services";
import type { CharacterAppearance } from "@/lib/workspace/services/character/CharacterAppearance";
import type { StoredCharacter } from "@/lib/workspace/services/character/types";
import { findCharacterImageFolder } from "@/lib/workspace/services/character/psdImportFolder";
import {
    imageNameStem,
    normalizePoseNamingRule,
    planPoseSources,
    uniquePoseNames,
    uniquePrefixes,
    type PoseNamingJoiner,
    type PoseNamingRule,
} from "@/lib/workspace/services/character/poseBatchImport";
import { cn } from "@/lib/utils/cn";
import { getPoseFolder, getPoseNamingRule, setPoseFolder, setPoseNamingRule } from "../characterEditorPaneState";

/**
 * Where the poses come from. Either way they are images already in the library.
 *
 * `folder` is the automatic path: the author picks a library folder in the dialog, and of the images
 * under it (sub-folders included) only those named after the character are offered. `assets` is the
 * batch path: images the author ticked in the library picker, every one of which is offered.
 */
export type PoseBatchSource =
    | { kind: "folder" }
    | { kind: "assets"; assets: Asset[] };

/** The folder choice that stands for every image in the library, foldered or not. */
export const ALL_IMAGES_FOLDER = "*";

type Row = {
    key: string;
    stem: string;
    assetId: string;
    /** `added`: some pose of this character already shows the image. */
    status: "ready" | "added";
    derived: string;
};

const JOINER_LABEL_KEYS = {
    " ": "characters.editor.poseBatch.joinerSpace",
    "_": "characters.editor.poseBatch.joinerUnderscore",
    "-": "characters.editor.poseBatch.joinerHyphen",
    "": "characters.editor.poseBatch.joinerNone",
} as const satisfies Record<PoseNamingJoiner, string>;

/** The image folders, parents before their children, each labelled with its path. */
function folderChoices(groups: readonly AssetGroup[]): { id: string; label: string }[] {
    const ids = new Set(groups.map(group => group.id));
    const children = new Map<string | undefined, AssetGroup[]>();
    for (const group of groups) {
        // A folder whose parent is gone is listed at the top rather than lost.
        const parent = group.parentGroupId && ids.has(group.parentGroupId) ? group.parentGroupId : undefined;
        children.set(parent, [...(children.get(parent) ?? []), group]);
    }
    const out: { id: string; label: string }[] = [];
    const seen = new Set<string>();
    const walk = (parent: string | undefined, path: string[]) => {
        for (const group of children.get(parent) ?? []) {
            if (seen.has(group.id)) continue;
            seen.add(group.id);
            const label = [...path, group.name];
            out.push({ id: group.id, label: label.join(" / ") });
            walk(group.id, label);
        }
    };
    walk(undefined, []);
    return out;
}

/**
 * Review, name and add a batch of poses.
 *
 * Nothing is written until Add. Every candidate is listed with the name it will get, and the author
 * can untick one, rename one, or change the rule and watch every name follow. An image some pose of
 * this character already shows is listed but unticked: running it again after adding three new
 * expressions to the folder offers the three, not all forty again.
 *
 * The whole add is one step of undo.
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
    const source = props.source;
    const isFolder = source.kind === "folder";

    const groups = useMemo<AssetGroup[]>(() => {
        if (!isFolder || !assetsService) return [];
        try {
            return assetsService.getGroupAssetsManager().getGroups(AssetCategory.Image);
        } catch {
            return []; // Folders not loaded yet: only "all images" is offered.
        }
    }, [assetsService, isFolder]);
    const folders = useMemo(() => folderChoices(groups), [groups]);

    // The folder this character's last run used, else the one named after the character, else none:
    // the author picks.
    const [folderId, setFolderId] = useState<string | null>(() => {
        if (!isFolder) return null;
        const remembered = panelState ? getPoseFolder(panelState, props.characterId) : null;
        if (remembered === ALL_IMAGES_FOLDER || (remembered && groups.some(group => group.id === remembered))) {
            return remembered;
        }
        return findCharacterImageFolder(groups, props.characterName.trim())?.id ?? null;
    });
    const [rule, setRule] = useState<PoseNamingRule>(() => normalizePoseNamingRule(
        panelState ? getPoseNamingRule(panelState, props.characterId) : null,
        props.characterName,
    ));
    const [prefixDraft, setPrefixDraft] = useState("");
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

    const chooseFolder = useCallback((next: string) => {
        setFolderId(next);
        setUnticked({});
        setTicked({});
        setEdited({});
        if (panelState) setPoseFolder(panelState, props.characterId, next);
    }, [panelState, props.characterId]);

    const images = useMemo<Asset[]>(() => {
        if (source.kind === "assets") return source.assets;
        if (!assetsService || !folderId) return [];
        if (folderId === ALL_IMAGES_FOLDER) {
            return Object.values(assetsService.getAssets()[AssetType.Image] ?? {}) as Asset[];
        }
        try {
            return assetsService.getGroupAssetsManager()
                .collectGroupAssets(AssetCategory.Image, folderId, true)
                .filter(asset => asset.type === AssetType.Image) as Asset[];
        } catch {
            return [];
        }
    }, [assetsService, folderId, source]);

    const rows = useMemo<Row[]>(() => {
        const used = new Set<string>();
        for (const pose of props.appearance.getPoses()) {
            if (pose.assetId) used.add(pose.assetId);
            for (const id of pose.sequence?.frameAssetIds ?? []) used.add(id);
        }
        const sources = images.map(asset => ({ key: asset.id, stem: imageNameStem(asset.name, AssetExtensions[AssetType.Image]) }));
        // From a folder, only the character's own files; picked by hand, every one.
        return planPoseSources(sources, rule, isFolder).map(entry => ({
            key: entry.key,
            stem: entry.stem,
            assetId: entry.key,
            status: used.has(entry.key) ? "added" : "ready",
            derived: entry.name,
        }));
    }, [images, isFolder, props.appearance, rule]);

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
    const allTicked = rows.length > 0 && chosen.length === rows.length;

    const addPrefix = useCallback(() => {
        const next = uniquePrefixes([...rule.prefixes, prefixDraft]);
        setPrefixDraft("");
        if (next.length !== rule.prefixes.length) updateRule({ prefixes: next });
    }, [prefixDraft, rule.prefixes, updateRule]);

    const add = useCallback(() => {
        const characterService = context?.services.get<CharacterService>(Services.Character);
        const character = characterService?.getCharacter(props.characterId);
        if (!characterService || !character || chosen.length === 0 || freeze.frozen) return;
        setBusy(true);
        setError(null);
        try {
            const before = structuredClone(character.toJSON()) as StoredCharacter;
            const made = props.appearance.addPoses(chosen.map(row => ({
                name: finalNames.get(row.key) ?? row.derived,
                assetId: row.assetId,
            })));
            if (made.length === 0) {
                setError(t("characters.editor.poseBatch.failed"));
                return;
            }
            characterService.recordCharacterEdit(props.characterId, before, { key: "workspace.history.entry.addPoses" });
            props.onAdded?.(made.map(pose => pose.id));
            props.onClose();
        } catch (thrown: unknown) {
            console.warn("[characters] batch pose add failed", thrown);
            setError(t("characters.editor.poseBatch.failed"));
        } finally {
            setBusy(false);
        }
    }, [chosen, context, finalNames, freeze.frozen, props, t]);

    const addDisabled = chosen.length === 0 || busy;

    return (
        <Modal
            isOpen
            onClose={props.onClose}
            title={t(isFolder ? "characters.editor.poseBatch.autoTitle" : "characters.editor.poseBatch.batchTitle")}
            helpTopic="appearances"
            size="lg"
            closeOnOverlayClick={!busy}
            footer={
                <div className="flex w-full items-center justify-end gap-2">
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
                        onClick={add}
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
                {isFolder && (
                    <div className="flex items-center gap-2">
                        <FieldLabel as="span" density="page" className="mb-0 shrink-0 whitespace-nowrap">{t("characters.editor.poseBatch.folder")}</FieldLabel>
                        <Select
                            size="sm"
                            portalMenu
                            fullWidth
                            ariaLabel={t("characters.editor.poseBatch.folder")}
                            placeholder={t("characters.editor.poseBatch.folderPlaceholder")}
                            value={folderId ?? undefined}
                            options={[
                                { value: ALL_IMAGES_FOLDER, labelKey: "characters.editor.poseBatch.allImages" },
                                ...folders.map(folder => ({ value: folder.id, label: folder.label })),
                            ]}
                            onChange={value => chooseFolder(String(value))}
                        />
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
                            {!isFolder
                                ? t("characters.editor.poseBatch.nothing")
                                : folderId
                                    ? t("characters.editor.poseBatch.noMatches")
                                    : t("characters.editor.poseBatch.chooseFolder")}
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
                                        <span className="w-2/5 min-w-0 truncate text-fg-muted" title={row.stem}>
                                            {row.stem}
                                        </span>
                                        <span className="w-16 shrink-0 text-right text-2xs text-fg-subtle">
                                            {row.status === "added" ? t("characters.editor.poseBatch.statusAdded") : ""}
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
