/**
 * Export a patch, or a DLC, for a build of this project.
 *
 * A dialog of its own rather than a page in the build dialog, because a patch is
 * not a build: it produces no installer, signs nothing, and targets no platform.
 * Everything the build dialog is made of - targets, formats, architectures,
 * signing - is a question a patch does not have, and a page that
 * answered none of them inside a dialog called "Build for distribution" would
 * read as a build that skipped them.
 *
 * The two do share a session: the export compiles the same project into the same
 * staging directory, so they cannot run at once, and both report into the build
 * console. That is why this dialog says so little about progress - the console is
 * already where an author watches this kind of work.
 *
 * ## The two questions, in the order they are asked
 *
 * Everything here answers one of two: which build does this file install into, and where does its
 * content come from. The first is what decides whether a player can open the file at all; the
 * second is what the file carries. They are separate fields because they are separate answers - an
 * edition upgrade names the demo in one and the full game in the other.
 *
 * The build being updated is arrived at in one of two ways, which is what the mode at the top
 * picks. Building it as part of the export is the answer for an upgrade or a DLC, where the build
 * being updated is reproducible from the project. Naming a folder is the answer for a fix to
 * something that already shipped, where it is not.
 *
 * Desktop only, and not stated on screen: the web export has no support binary to
 * read a patch through, and the mobile shells repack that same web payload, so
 * there is no other place a patch could attach to and nothing for the author to
 * choose between.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Select, type SelectOption } from "@/lib/components/elements";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { getInterface } from "@/lib/app/bridge";
import { translate, useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { cn } from "@/lib/utils/cn";
import { basename, join } from "@shared/utils/path";
import type { Workspace } from "@/lib/workspace/workspace";
import { Services } from "@/lib/workspace/services/services";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import type { BuildService } from "@/lib/workspace/services/core/BuildService";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { PatchBaselineMode, PatchConfiguration } from "@/lib/workspace/project/configuration";
import { RELEASE_APP_TAG, type ProjectAppTag } from "@shared/types/appTag";
import type { ProjectDlc } from "@shared/types/dlc";
import { dlcArtifactFileName } from "@shared/utils/dlcDelivery";
import type { DlcService } from "@/lib/workspace/services/dlc/DlcService";
import { PATCH_DIRECTORY_NAME } from "@shared/utils/patchDelivery";
import { patchExportBlocker, type PatchExportBlocker } from "./patchExportReadiness";
import { openProjectPanel } from "../project";

/** What the footer says while each blocker stands. */
const BLOCKER_MESSAGE_KEYS: Record<PatchExportBlocker, TranslationKey> = {
    output: "build.patch.blocked.output",
    reading: "build.patch.blocked.reading",
    artifact: "build.patch.blocked.artifact",
    dlcBaseline: "build.patch.blocked.dlcBaseline",
    dlcVariant: "build.patch.blocked.dlcVariant",
};

type PatchDialogInfo = {
    appTags: ProjectAppTag[];
    /** The project's DLC, each of which this dialog can export instead of a patch. */
    dlcs: ProjectDlc[];
    /** The remembered selection, or null for a project that has never had one exported. */
    stored: PatchConfiguration | null;
    /** Where the save dialog starts, and the name it offers. */
    defaultOutputFile: string;
};

/** What a chosen build folder says about itself, once it has been read. */
type BaselineReading = {
    appTagId: string | null;
    productName: string | null;
    version: string | null;
    builtAt: string | null;
};

export type PatchDialogChoice = {
    dlcId: string;
    baselineMode: PatchBaselineMode;
    /** The variant the patch installs into. Empty means the release variant. */
    targetAppTagId: string;
    contentAppTagId: string;
    baselineAppDir: string;
    outputFile: string;
    name: string;
    layer: string;
};

function formatBuiltAt(builtAt: string): string {
    const parsed = new Date(builtAt);
    return Number.isNaN(parsed.getTime()) ? builtAt : parsed.toLocaleString();
}

function PatchDialogContent({
    info,
    onExport,
    onCancel,
}: {
    info: PatchDialogInfo;
    onExport: (choice: PatchDialogChoice) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    /**
     * What this dialog is exporting: a patch, or one of the project's DLC.
     *
     * One choice rather than a second dialog, because everything below it is the same question
     * either way - which build, what to leave out, where to write it - and a DLC only answers three
     * of them from its own record instead of from a field.
     *
     * Not remembered between exports, unlike the fields below it: reopening on the DLC exported
     * last time would offer to ship one to an author who came here for a patch.
     */
    const [dlcId, setDlcId] = useState("");
    /** How the build this patch updates is arrived at. */
    const [baselineMode, setBaselineMode] = useState<PatchBaselineMode>(
        info.stored?.baselineMode ?? "variant",
    );
    /**
     * The variant whose build this file installs into.
     *
     * Blank is the release variant. In the folder mode it is only asked where the folder does not
     * state its own, so it is a fallback there rather than the answer.
     */
    const [targetAppTagId, setTargetAppTagId] = useState(info.stored?.targetAppTagId ?? "");
    /**
     * Which variant's content goes in, when it is not the one the patch installs into.
     *
     * Blank means the same one, which is the ordinary patch. The other case is an edition shipped
     * without content the author now wants to deliver: the file has to open on the build the player
     * owns, and carry the other edition's scenes and art.
     */
    const [contentAppTagId, setContentAppTagId] = useState(info.stored?.contentAppTagId ?? "");
    const [baselineAppDir, setBaselineAppDir] = useState(info.stored?.baselineAppDir ?? "");
    const [outputFile, setOutputFile] = useState(info.stored?.outputFile || info.defaultOutputFile);
    const [name, setName] = useState("");
    /**
     * Where this patch sits among the others installed on the same build, held as text so a partly
     * typed value - an empty box, a lone minus sign - stays what the author typed.
     */
    const [layer, setLayer] = useState("");

    /** What the chosen folder says about itself, and why it says nothing when it does not. */
    const [reading, setReading] = useState<BaselineReading | null>(null);
    const [readingError, setReadingError] = useState<string | null>(null);
    const [readingBusy, setReadingBusy] = useState(false);

    const variantOptions = useMemo<SelectOption[]>(
        () => info.appTags.map(tag => ({ value: tag.id, label: tag.name })),
        [info.appTags],
    );

    const kindOptions = useMemo<SelectOption[]>(
        () => [
            { value: "", label: t("build.patch.kindPatch") },
            ...info.dlcs.map(dlc => ({ value: dlc.id, label: dlc.name })),
        ],
        [info.dlcs, t],
    );

    const modeOptions = useMemo<SelectOption[]>(
        () => [
            { value: "variant", label: t("build.patch.baselineModeVariant") },
            { value: "artifact", label: t("build.patch.baselineModeArtifact") },
        ],
        [t],
    );

    const dlc = useMemo(() => info.dlcs.find(entry => entry.id === dlcId) ?? null, [dlcId, info.dlcs]);
    const variantName = useCallback(
        (id: string) => info.appTags.find(tag => tag.id === (id || RELEASE_APP_TAG.id))?.name
            ?? (id || RELEASE_APP_TAG.id),
        [info.appTags],
    );

    /**
     * Read the chosen folder as soon as it is chosen, so the edition it installs into is stated
     * rather than remembered. The reader is the export's own, so a folder refused here is one the
     * export would have refused later.
     */
    const pending = useRef("");
    useEffect(() => {
        const target = baselineMode === "artifact" ? baselineAppDir.trim() : "";
        pending.current = target;
        if (!target) {
            setReading(null);
            setReadingError(null);
            setReadingBusy(false);
            return;
        }
        setReadingBusy(true);
        void getInterface().gameBuild.readPatchBaseline(target).then(result => {
            // Answers for a folder the author has since replaced are dropped; the one for the folder
            // in the box always wins, whichever order the answers arrive in.
            if (pending.current !== target) {
                return;
            }
            setReadingBusy(false);
            if (result.success) {
                setReading(result.data);
                setReadingError(null);
            } else {
                setReading(null);
                setReadingError(result.error ?? null);
            }
        });
    }, [baselineAppDir, baselineMode]);

    /**
     * The variant this file installs into, which is what the export is told.
     *
     * A DLC states it on its own record; a build folder states it in what it shipped. The field is
     * what answers only where neither of those does.
     */
    const effectiveTargetId = dlc
        ? dlc.attachTo
        : (baselineMode === "artifact" ? (reading?.appTagId ?? targetAppTagId) : targetAppTagId);
    const effectiveContentId = dlc ? effectiveTargetId : (contentAppTagId || effectiveTargetId);
    /** A DLC belongs to one edition; a folder from another one cannot be the build it updates. */
    const dlcVariantMismatch = Boolean(dlc && reading?.appTagId && reading.appTagId !== dlc.attachTo);
    /**
     * Both sides of the comparison would be the same edition of the same project, so the file would
     * carry nothing. Stated rather than blocked - the export still produces a valid patch, and an
     * author checking the delivery path has a reason to want one.
     */
    const carriesNothing = baselineMode === "variant"
        && !dlc
        && (effectiveContentId || RELEASE_APP_TAG.id) === (effectiveTargetId || RELEASE_APP_TAG.id);

    /**
     * What is standing in the way of exporting, or null when nothing is.
     *
     * Computed from what the fields say rather than checked when the button is pressed: an export
     * compiles the project twice, and a selection that was never going to work should stop being
     * pressable while the author is still looking at the field it is wrong in.
     */
    const blocker = useMemo<PatchExportBlocker | null>(() => patchExportBlocker({
        outputFile: outputFile.trim(),
        baselineMode,
        baselineAppDir: baselineMode === "artifact" ? baselineAppDir.trim() : "",
        readingBaseline: readingBusy,
        baselineUnreadable: Boolean(readingError),
        baselineAppTagId: reading?.appTagId ?? null,
        dlcAttachTo: dlc?.attachTo ?? null,
    }), [baselineAppDir, baselineMode, dlc, outputFile, reading, readingBusy, readingError]);

    const pickBaseline = useCallback(async () => {
        const result = await getInterface().gameBuild.selectPatchBaseline(baselineAppDir || undefined);
        if (result.success && result.data.path) {
            setBaselineAppDir(result.data.path);
        }
    }, [baselineAppDir]);

    const pickOutput = useCallback(async () => {
        const result = await getInterface().gameBuild.selectPatchFile(outputFile || undefined);
        if (result.success && result.data.path) {
            setOutputFile(result.data.path);
        }
    }, [outputFile]);

    /** The variant this file installs into, shown when it is not this author's to choose here. */
    const statedTarget = (
        <div className="grid gap-1">
            <FieldLabel as="div">{t("build.patch.targetLabel")}</FieldLabel>
            <span className="text-xs text-fg">{variantName(effectiveTargetId)}</span>
            <span className="text-2xs text-fg-subtle">
                {dlc ? t("build.patch.dlcVariantHint") : t("build.patch.artifactVariantStated")}
            </span>
        </div>
    );

    const chosenTarget = (
        <div className="grid gap-1">
            <FieldLabel as="div">{t("build.patch.targetLabel")}</FieldLabel>
            <Select
                options={variantOptions}
                value={targetAppTagId || RELEASE_APP_TAG.id}
                onChange={value => setTargetAppTagId(
                    String(value) === RELEASE_APP_TAG.id ? "" : String(value),
                )}
                fullWidth
                portalMenu
                ariaLabel={t("build.patch.targetLabel")}
            />
            {/* Stated because it is the one way to get this wrong without being told: a patch
                made under the other variant cannot be opened by the build it was meant for, and
                nothing says so until a player tries it. */}
            <span className="text-2xs text-fg-subtle">{t("build.patch.targetHint")}</span>
        </div>
    );

    return (
        // Negative margins undo DialogContainer's content padding so the footer meets the dialog
        // edges and reads as the same band the test picker and the build dialog end with, rather
        // than a rule drawn inside the form. The fields keep that padding back.
        <div className="-mx-6 -my-4 flex min-w-0 flex-col">
            <div className="grid gap-3 px-6 py-4 [&>*]:min-w-0">
                {info.dlcs.length > 0 && (
                    <div className="grid gap-1">
                        <FieldLabel as="div">{t("build.patch.kindLabel")}</FieldLabel>
                        <Select
                            options={kindOptions}
                            value={dlcId}
                            onChange={value => setDlcId(String(value))}
                            fullWidth
                            portalMenu
                            ariaLabel={t("build.patch.kindLabel")}
                        />
                    </div>
                )}

                <div className="grid gap-1">
                    <FieldLabel as="div">{t("build.patch.baselineModeLabel")}</FieldLabel>
                    <Select
                        options={modeOptions}
                        value={baselineMode}
                        onChange={value => setBaselineMode(value === "variant" ? "variant" : "artifact")}
                        fullWidth
                        portalMenu
                        ariaLabel={t("build.patch.baselineModeLabel")}
                    />
                    <span className="text-2xs text-fg-subtle">
                        {baselineMode === "variant"
                            ? t("build.patch.baselineModeVariantHint")
                            : t("build.patch.baselineModeArtifactHint")}
                    </span>
                </div>

                {baselineMode === "artifact" && (
                    <div className="grid gap-1">
                        <FieldLabel as="div">{t("build.patch.artifactLabel")}</FieldLabel>
                        <div className="flex min-w-0 items-center gap-2">
                            <Input
                                value={baselineAppDir}
                                onChange={event => setBaselineAppDir(event.target.value)}
                                placeholder={t("build.patch.artifactPlaceholder")}
                                className="min-w-0 flex-1"
                            />
                            <Button variant="secondary" onClick={() => { void pickBaseline(); }}>
                                {t("build.patch.browse")}
                            </Button>
                        </div>
                        {/* One line per fact, never one line for both: what the folder holds and what
                            it says about its edition are separate answers, and a single sentence for
                            the two is where "reads fine, states nothing" hides. */}
                        {readingBusy && (
                            <span className="text-2xs text-fg-subtle">{t("build.patch.artifactReading")}</span>
                        )}
                        {readingError && (
                            <span className="text-2xs text-danger">{readingError}</span>
                        )}
                        {reading && (
                            <span className="text-2xs text-fg-subtle">
                                {/* Two spellings rather than a placeholder for an absent version: a
                                    build made before the project had one would otherwise read as a
                                    product whose name ends in a dash. */}
                                {t(
                                    reading.version
                                        ? "build.patch.artifactReadVersioned"
                                        : "build.patch.artifactRead",
                                    {
                                        product: reading.productName ?? "—",
                                        version: reading.version ?? "",
                                        date: reading.builtAt ? formatBuiltAt(reading.builtAt) : "—",
                                    },
                                )}
                            </span>
                        )}
                        {reading && !reading.appTagId && (
                            <span className="text-2xs text-warning">{t("build.patch.artifactVariantUnknown")}</span>
                        )}
                        {dlcVariantMismatch && (
                            <span className="text-2xs text-warning">
                                {t("build.patch.artifactVariantMismatch", {
                                    build: variantName(reading?.appTagId ?? ""),
                                    variant: variantName(dlc?.attachTo ?? ""),
                                })}
                            </span>
                        )}
                        {!baselineAppDir.trim() && !dlc && (
                            <span className="text-2xs text-fg-subtle">{t("build.patch.artifactWholeGame")}</span>
                        )}
                    </div>
                )}

                {/* Stated, not asked, wherever something else has already answered it: a DLC record
                    names the edition it belongs to, and a build folder names the edition it is. Two
                    places to say it is one place for the two to disagree. */}
                {dlc || (baselineMode === "artifact" && reading?.appTagId) ? statedTarget : chosenTarget}

                {!dlc && info.appTags.length > 1 && (
                    <div className="grid gap-1">
                        <FieldLabel as="div">{t("build.patch.contentLabel")}</FieldLabel>
                        <Select
                            options={variantOptions}
                            value={effectiveContentId || RELEASE_APP_TAG.id}
                            onChange={value => setContentAppTagId(
                                String(value) === (effectiveTargetId || RELEASE_APP_TAG.id) ? "" : String(value),
                            )}
                            fullWidth
                            portalMenu
                            ariaLabel={t("build.patch.contentLabel")}
                        />
                        <span className={cn("text-2xs", carriesNothing ? "text-warning" : "text-fg-subtle")}>
                            {carriesNothing ? t("build.patch.sameVariant") : t("build.patch.contentHint")}
                        </span>
                    </div>
                )}

                <div className="grid gap-1">
                    <FieldLabel as="div">{t("build.patch.outputLabel")}</FieldLabel>
                    <div className="flex min-w-0 items-center gap-2">
                        <Input
                            value={outputFile}
                            onChange={event => setOutputFile(event.target.value)}
                            className="min-w-0 flex-1"
                        />
                        <Button variant="secondary" onClick={() => { void pickOutput(); }}>
                            {t("build.patch.browse")}
                        </Button>
                    </div>
                    {/* The chosen path decides the folder; the name comes from the DLC's id, which
                        the author already settled once and a player will see. */}
                    {dlc ? (
                        <span className="text-2xs text-fg-subtle">
                            {t("build.patch.dlcOutputHint", { file: dlcArtifactFileName(dlc.id) })}
                        </span>
                    ) : null}
                </div>

                <div className="grid gap-1">
                    <FieldLabel as="div">{t("build.patch.nameLabel")}</FieldLabel>
                    <Input
                        value={name}
                        onChange={event => setName(event.target.value)}
                        placeholder={dlc ? dlc.name : t("build.patch.namePlaceholder")}
                    />
                </div>

                <div className="grid gap-1">
                    <FieldLabel as="div">{t("build.patch.layerLabel")}</FieldLabel>
                    <Input
                        type="number"
                        step={1}
                        value={layer}
                        onChange={event => setLayer(event.target.value)}
                        placeholder="0"
                        aria-label={t("build.patch.layerLabel")}
                    />
                    <span className="text-2xs text-fg-subtle">{t("build.patch.layerHint")}</span>
                </div>
            </div>

            {/* The reason sits beside the button rather than on it: a disabled control takes no
                pointer events, so a tooltip there is a sentence nobody can reach. */}
            <div className="flex items-center justify-between gap-3 border-t border-edge bg-surface-overlay px-6 py-3">
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
                    {blocker ? t(BLOCKER_MESSAGE_KEYS[blocker]) : ""}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" onClick={onCancel}>
                    {t("common.cancel")}
                </Button>
                <Button
                    variant="primary"
                    disabled={Boolean(blocker)}
                    onClick={() => onExport({
                        dlcId,
                        baselineMode,
                        targetAppTagId: effectiveTargetId,
                        // Never sent alongside a DLC: a DLC adds to the edition it attaches to, and
                        // a content variant left over from the last patch would be what the export's
                        // gates ran against.
                        contentAppTagId: dlc ? "" : contentAppTagId,
                        baselineAppDir: baselineMode === "artifact" ? baselineAppDir.trim() : "",
                        outputFile: outputFile.trim(),
                        name,
                        layer,
                    })}
                >
                    {t("build.patch.exportAction")}
                </Button>
                </div>
            </div>
        </div>
    );
}

export async function openPatchDialog(workspace: Workspace): Promise<void> {
    const context = workspace.getContext();
    const services = context.services;
    const uiService = services.get<UIService>(Services.UI);
    const buildService = services.get<BuildService>(Services.Build);
    const projectService = services.get<ProjectService>(Services.Project);

    if (buildService.isBuilding()) {
        uiService.showNotification(translate("build.patch.busy"), "warning");
        return;
    }

    // Same reason the build dialog reloads it: the manifest on disk is what the
    // export reads, and the cached copy only tracks writes this window made.
    await projectService.reloadProjectConfig().catch(() => undefined);
    const projectConfig = projectService.getProjectConfig();

    // Said here rather than left to the export, because it is a thing to go and do
    // rather than a thing that went wrong, and the place to do it is one click away.
    if (!projectService.getDistributionConfiguration()) {
        uiService.showNotification(translate("build.patch.noKey"), "warning", {
            // Sticky, because the default five seconds is not long enough to read the message and
            // decide to act on it, and the action is the point of the notification.
            sticky: true,
            actions: [{
                label: translate("build.patch.noKeyAction"),
                primary: true,
                // The distribution key is created on the Project page, beside the check a build
                // runs - not on App, which is about the application the build produces.
                onClick: () => openProjectPanel(context, { section: "project" }),
            }],
        });
        return;
    }

    let appTagService: AppTagService | null = null;
    try {
        appTagService = services.get<AppTagService>(Services.AppTags);
    } catch (error) {
        console.warn("[patch] app tag service unavailable", error);
    }

    const projectPath = context.project.getConfig().projectPath;
    const stem = (projectConfig.name?.trim() || basename(projectPath) || "patch")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-");
    let dlcService: DlcService | null = null;
    try {
        dlcService = services.get<DlcService>(Services.Dlc);
    } catch (error) {
        console.warn("[patch] dlc service unavailable", error);
    }

    const appTags = appTagService?.listTags() ?? [RELEASE_APP_TAG];
    // A remembered variant whose record has since been deleted resolves to the release variant, the
    // same way every other reading of a dangling variant id in this project does.
    const known = (id: string | undefined): string => (id && appTags.some(tag => tag.id === id) ? id : "");
    const stored = projectService.getPatchConfiguration();
    const info: PatchDialogInfo = {
        appTags,
        dlcs: dlcService?.list() ?? [],
        stored: stored
            ? {
                baselineMode: stored.baselineMode,
                targetAppTagId: known(stored.targetAppTagId),
                contentAppTagId: known(stored.contentAppTagId),
                baselineAppDir: stored.baselineAppDir ?? "",
                outputFile: stored.outputFile ?? "",
            }
            : null,
        // Inside a `patch` folder, because that folder is what gets zipped and
        // extracted. The export puts it there regardless; showing it here means the
        // field says where the file will actually be.
        defaultOutputFile: join(projectPath, "dist", PATCH_DIRECTORY_NAME, `${stem}.patch.dat`),
    };

    const dialogId = uiService.dialogs.show({
        title: translate("build.patch.title"),
        width: 520,
        closable: true,
        // What a patch can carry, and what installing one does at the player's end, is decided
        // here and readable from none of the fields.
        helpTopic: "patches",
        content: (
            <PatchDialogContent
                info={info}
                onCancel={() => uiService.dialogs.close(dialogId)}
                onExport={choice => {
                    uiService.dialogs.close(dialogId);
                    // Zero is what a patch that says nothing already gets, so it is not sent.
                    const layer = Number.parseInt(choice.layer, 10);
                    // Remembered before the export starts, so a selection survives an export that
                    // fails - which is the one an author is most likely to come back and repeat.
                    void projectService.updatePatchConfiguration({
                        baselineMode: choice.baselineMode,
                        ...(choice.targetAppTagId ? { targetAppTagId: choice.targetAppTagId } : {}),
                        ...(choice.baselineAppDir ? { baselineAppDir: choice.baselineAppDir } : {}),
                        ...(choice.contentAppTagId ? { contentAppTagId: choice.contentAppTagId } : {}),
                        outputFile: choice.outputFile,
                    }).catch(() => undefined);
                    void buildService.exportPatch({
                        ...(choice.dlcId ? { dlcId: choice.dlcId } : {}),
                        ...(choice.targetAppTagId ? { appTagId: choice.targetAppTagId } : {}),
                        ...(choice.contentAppTagId ? { contentAppTagId: choice.contentAppTagId } : {}),
                        ...(choice.baselineAppDir ? { baselineAppDir: choice.baselineAppDir } : {}),
                        ...(choice.baselineMode === "variant" ? { baselineFromBuild: true } : {}),
                        outputFile: choice.outputFile,
                        ...(choice.name.trim() ? { name: choice.name.trim() } : {}),
                        ...(Number.isInteger(layer) && layer !== 0 ? { order: layer } : {}),
                    });
                }}
            />
        ),
    });
}
