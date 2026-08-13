import { Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import { Select } from "@/lib/components/elements/Select";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { Services } from "@/lib/workspace/services/services";
import { formatByteSize } from "@/apps/workspace/modules/asset-overview/assetOverviewModel";
import {
    isBlockingModelProblem,
    scanFolderForModels,
    type ModelScanFs,
    type ModelScanProblem,
    type ScannedModel,
} from "@/lib/workspace/services/assets/modelImportScanner";
import { MODEL_FAMILIES, type ModelFamily } from "@shared/utils/modelImportScan";
import type { TranslationKey } from "@shared/i18n";
import { AlertTriangle, CheckCircle2, FolderOpen, Info, Loader2 } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

/** What the wizard hands back: one directory per asset, and which file inside it is the entry. */
export interface ModelImportSelection {
    rootPath: string;
    /** Relative to `rootPath`. Written to `AssetExtras.modelEntry` after the bundle is copied. */
    entry: string;
}

type Phase =
    | { step: "family" }
    | { step: "folder"; family: ModelFamily; root?: string }
    | { step: "scanning"; family: ModelFamily; root: string }
    | { step: "results"; family: ModelFamily; root: string; models: ScannedModel[] }
    | { step: "failed"; family: ModelFamily; root: string; message: string };

const FAMILY_LABEL: Record<ModelFamily, TranslationKey> = {
    live2d: "assets.modelImport.family.live2d",
    spine: "assets.modelImport.family.spine",
};

const FAMILY_HINT: Record<ModelFamily, TranslationKey> = {
    live2d: "assets.modelImport.family.live2dHint",
    spine: "assets.modelImport.family.spineHint",
};

/**
 * The guided import for Live2D and Spine model folders.
 *
 * Why a wizard rather than the folder picker every other bundle import uses: a model is a folder of
 * files that reference each other by name, and the two ways that goes wrong are both invisible at
 * the picker. Either the author points at the wrong level of the tree - the parent of the folder
 * they meant, or a library of twelve characters when the picker takes one - or the export is short
 * a texture, which nothing says until the model mounts with holes in it. Asking for the *kind*
 * first is what makes both answerable: it decides which manifest to look for, and a manifest is the
 * only thing that knows what the folder is supposed to contain.
 *
 * What it deliberately does not do is install, check for, or care about a drawing runtime. Files
 * come in here; the Live2D or Spine runtime is set up on the character that draws them, later and
 * elsewhere (see `PuppetRuntimeInstaller`). An author gathering assets should not be stopped by a
 * licence step that belongs to a different task.
 */
export function ModelImportWizard(props: {
    visible: boolean;
    onClose: () => void;
    /** Called with the folders to import, in list order. The wizard closes itself first. */
    onImport: (selection: ModelImportSelection[]) => void;
}) {
    const { t, tn } = useTranslation();
    const { context } = useWorkspace();

    const [phase, setPhase] = useState<Phase>({ step: "family" });
    /** Row ids the author has ticked. Seeded from the scan, then owned by the author. */
    const [checked, setChecked] = useState<Set<string>>(new Set());
    /** Entry overrides, for the folders that hold more than one model. */
    const [entries, setEntries] = useState<Record<string, string>>({});

    const reset = useCallback(() => {
        setPhase({ step: "family" });
        setChecked(new Set());
        setEntries({});
    }, []);

    const close = useCallback(() => {
        reset();
        props.onClose();
    }, [props, reset]);

    const scan = useCallback(async (family: ModelFamily, root: string) => {
        if (!context) return;
        setPhase({ step: "scanning", family, root });

        const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
        const fs: ModelScanFs = {
            async listTree(directory) {
                const result = await filesystem.directorySize(directory);
                return result.ok ? result.data.bytesByRelativePath : null;
            },
            async readText(path) {
                const result = await filesystem.read(path, "utf-8");
                return result.ok ? result.data : null;
            },
        };

        const outcome = await scanFolderForModels(family, root, fs);
        if (!outcome.ok) {
            setPhase({
                step: "failed",
                family,
                root,
                message: outcome.reason === "tooManyFiles"
                    ? t("assets.modelImport.tooManyFiles", { count: String(outcome.fileCount ?? 0) })
                    : t("assets.modelImport.unreadable"),
            });
            return;
        }

        // Everything clean starts ticked; anything with a blocking problem starts unticked but
        // stays in the list, because the listing this was judged against can be short in ways the
        // scan cannot see and an author who knows better must not be left with a dialog full of no.
        setChecked(new Set(outcome.models
            .filter(model => !model.problems.some(isBlockingModelProblem))
            .map(model => model.rootPath)));
        setEntries({});
        setPhase({ step: "results", family, root, models: outcome.models });
    }, [context, t]);

    const pickFolder = useCallback(async (family: ModelFamily) => {
        // Single-select: the folder is the thing being searched, and two of them would only make
        // the results list ambiguous about which one a row came from.
        const selection = await getInterface().fs.selectDirectory(false);
        if (!selection.success || !selection.data.ok || selection.data.data.length === 0) {
            return;
        }
        await scan(family, selection.data.data[0]);
    }, [scan]);

    const chooseFamily = useCallback(async (family: ModelFamily) => {
        setPhase({ step: "folder", family });
        await pickFolder(family);
    }, [pickFolder]);

    const models = phase.step === "results" ? phase.models : [];
    const selected = useMemo(
        () => models.filter(model => checked.has(model.rootPath)),
        [models, checked],
    );

    const toggle = useCallback((rootPath: string) => {
        setChecked(previous => {
            const next = new Set(previous);
            if (next.has(rootPath)) {
                next.delete(rootPath);
            } else {
                next.add(rootPath);
            }
            return next;
        });
    }, []);

    const toggleAll = useCallback(() => {
        setChecked(previous => (previous.size === models.length
            ? new Set<string>()
            : new Set(models.map(model => model.rootPath))));
    }, [models]);

    const confirm = useCallback(() => {
        const selection = selected.map(model => ({
            rootPath: model.rootPath,
            entry: entries[model.rootPath] ?? model.entry,
        }));
        close();
        props.onImport(selection);
    }, [close, entries, props, selected]);

    const describeProblem = useCallback((problem: ModelScanProblem): string => {
        switch (problem.kind) {
            case "missing":
                return t("assets.modelImport.problem.missing", {
                    role: t(`assets.modelImport.role.${problem.role}` as TranslationKey),
                    path: problem.path,
                });
            case "unusableReference":
                return t("assets.modelImport.problem.unusableReference", {
                    role: t(`assets.modelImport.role.${problem.role}` as TranslationKey),
                    raw: problem.raw,
                });
            case "manifestUnreadable":
                return t("assets.modelImport.problem.manifestUnreadable", { path: problem.path });
            case "atlasMissing":
                return t("assets.modelImport.problem.atlasMissing", { path: problem.path });
            case "atlasEmpty":
                return t("assets.modelImport.problem.atlasEmpty", { path: problem.path });
            case "nestedModel":
                return t("assets.modelImport.problem.nestedModel", { path: problem.path });
        }
    }, [t]);

    const body = (() => {
        if (phase.step === "family") {
            return (
                <div className="space-y-3 py-1">
                    <p className="text-xs text-fg-muted">{t("assets.modelImport.familyStep")}</p>
                    <div className="grid grid-cols-2 gap-2">
                        {MODEL_FAMILIES.map(family => (
                            <button
                                key={family}
                                className="flex flex-col gap-1 rounded-md border border-edge bg-fill-subtle px-3 py-2.5 text-left hover:border-primary hover:bg-fill"
                                onClick={() => void chooseFamily(family)}
                            >
                                <span className="text-xs font-medium text-fg">{t(FAMILY_LABEL[family])}</span>
                                <span className="text-2xs leading-relaxed text-fg-subtle">{t(FAMILY_HINT[family])}</span>
                            </button>
                        ))}
                    </div>
                    {/* The step authors expect to be blocked by is the runtime install, so this says
                        up front that it is not this dialog's business. */}
                    <p className="flex items-start gap-1.5 px-1 text-2xs leading-relaxed text-fg-subtle">
                        <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                        {t("assets.modelImport.familyNoRuntime")}
                    </p>
                </div>
            );
        }

        return (
            <div className="space-y-3 py-1">
                <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded-md border border-edge px-1.5 py-0.5 text-2xs text-fg-muted">
                        {t(FAMILY_LABEL[phase.family])}
                    </span>
                    {"root" in phase && phase.root ? (
                        <span className="truncate text-2xs text-fg-subtle" data-tip={phase.root}>{phase.root}</span>
                    ) : (
                        <span className="text-2xs text-fg-subtle">{t("assets.modelImport.folderHint")}</span>
                    )}
                </div>

                {phase.step === "folder" && (
                    <div className="flex flex-col items-start gap-2 py-4">
                        <p className="text-xs text-fg-muted">{t("assets.modelImport.folderStep")}</p>
                        <button
                            className={dialogFooterButtonClass({ variant: "primary" })}
                            onClick={() => void pickFolder(phase.family)}
                        >
                            <FolderOpen className="mr-1.5 inline h-3.5 w-3.5" />
                            {t("assets.modelImport.chooseFolder")}
                        </button>
                    </div>
                )}

                {phase.step === "scanning" && (
                    <div className="flex items-center gap-2 px-1 py-6 text-xs text-fg-muted">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("assets.modelImport.scanning")}
                    </div>
                )}

                {phase.step === "failed" && (
                    <div className="space-y-2 py-2">
                        <div className="flex items-center gap-2 text-xs text-fg">
                            <AlertTriangle className="h-4 w-4 text-danger" />
                            {t("assets.modelImport.failedTitle")}
                        </div>
                        <p className="px-1 text-2xs leading-relaxed text-fg-muted">{phase.message}</p>
                    </div>
                )}

                {phase.step === "results" && phase.models.length === 0 && (
                    <div className="space-y-1.5 py-6">
                        <p className="text-xs text-fg">
                            {t("assets.modelImport.noneFound", { family: t(FAMILY_LABEL[phase.family]) })}
                        </p>
                        <p className="text-2xs leading-relaxed text-fg-subtle">{t("assets.modelImport.noneFoundHint")}</p>
                    </div>
                )}

                {phase.step === "results" && phase.models.length > 0 && (
                    <>
                        <div className="flex items-center justify-between">
                            <span className="text-2xs text-fg-muted">
                                {tn("assets.modelImport.foundCount", phase.models.length)}
                            </span>
                            <button className="text-2xs text-primary hover:underline" onClick={toggleAll}>
                                {t(selected.length === phase.models.length
                                    ? "assets.modelImport.selectNone"
                                    : "assets.modelImport.selectAll")}
                            </button>
                        </div>

                        {/* Capped height rather than a growing dialog: a library folder can hold
                            dozens, and the footer's count has to stay reachable. */}
                        <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
                            {phase.models.map(model => {
                                const blocking = model.problems.filter(isBlockingModelProblem);
                                const advisory = model.problems.filter(problem => !isBlockingModelProblem(problem));
                                return (
                                    <div key={model.rootPath} className="rounded-md border border-edge bg-fill-subtle px-2.5 py-2">
                                        <label className="flex cursor-pointer items-start gap-2">
                                            <input
                                                type="checkbox"
                                                className="mt-0.5"
                                                checked={checked.has(model.rootPath)}
                                                onChange={() => toggle(model.rootPath)}
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-1.5">
                                                    <span className="truncate text-xs font-medium text-fg">{model.name}</span>
                                                    {blocking.length > 0 ? (
                                                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" />
                                                    ) : advisory.length > 0 ? (
                                                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                                                    ) : (
                                                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                                                    )}
                                                </span>
                                                <span className="block truncate text-2xs text-fg-subtle" data-tip={model.relativePath}>
                                                    {model.relativePath || "."}
                                                    {" · "}
                                                    {t("assets.modelImport.fileSummary", {
                                                        count: String(model.fileCount),
                                                        size: formatByteSize(model.totalBytes),
                                                    })}
                                                </span>
                                            </span>
                                        </label>

                                        {/* Only when the folder holds more than one model: otherwise the
                                            entry is not a decision and a select would imply it was. */}
                                        {model.entryChoices.length > 1 && (
                                            <div className="mt-1.5 flex items-center gap-2 pl-6">
                                                <span className="shrink-0 text-2xs text-fg-muted">
                                                    {t("assets.modelImport.entry")}
                                                </span>
                                                <Select
                                                    size="sm"
                                                    portalMenu
                                                    ariaLabel={t("assets.modelImport.entry")}
                                                    options={model.entryChoices.map(choice => ({ label: choice, value: choice }))}
                                                    value={entries[model.rootPath] ?? model.entry}
                                                    onChange={value => setEntries(previous => ({
                                                        ...previous,
                                                        [model.rootPath]: String(value),
                                                    }))}
                                                />
                                            </div>
                                        )}

                                        {model.problems.length > 0 && (
                                            <ul className="mt-1.5 space-y-0.5 pl-6">
                                                {model.problems.map((problem, index) => (
                                                    <li
                                                        key={index}
                                                        className={`break-words text-2xs leading-relaxed ${
                                                            isBlockingModelProblem(problem) ? "text-danger" : "text-warning"
                                                        }`}
                                                    >
                                                        {describeProblem(problem)}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {phase.models.some(model => model.problems.some(isBlockingModelProblem)) && (
                            <p className="px-1 text-2xs leading-relaxed text-fg-subtle">
                                {t("assets.modelImport.blockedHint")}
                            </p>
                        )}
                    </>
                )}
            </div>
        );
    })();

    return (
        <Modal
            isOpen={props.visible}
            onClose={close}
            title={t("assets.modelImport.title")}
            helpTopic="puppetRuntimes"
            size="lg"
            footer={
                <div className="flex justify-end gap-2">
                    {phase.step !== "family" && phase.step !== "scanning" && (
                        <button className={dialogFooterButtonClass({ variant: "secondary" })} onClick={reset}>
                            {t("common.back")}
                        </button>
                    )}
                    {(phase.step === "results" || phase.step === "failed") && (
                        <button
                            className={dialogFooterButtonClass({ variant: "secondary" })}
                            onClick={() => void scan(phase.family, phase.root)}
                        >
                            {t("assets.modelImport.rescan")}
                        </button>
                    )}
                    {phase.step === "results" && phase.models.length > 0 && (
                        <button
                            className={dialogFooterButtonClass({ variant: "primary", disabled: selected.length === 0 })}
                            disabled={selected.length === 0}
                            onClick={confirm}
                        >
                            {selected.length === 0
                                ? t("assets.modelImport.importAction")
                                : tn("assets.modelImport.importCount", selected.length)}
                        </button>
                    )}
                    <button
                        className={dialogFooterButtonClass({ variant: "secondary" })}
                        disabled={phase.step === "scanning"}
                        onClick={close}
                    >
                        {t("common.cancel")}
                    </button>
                </div>
            }
        >
            {body}
        </Modal>
    );
}
