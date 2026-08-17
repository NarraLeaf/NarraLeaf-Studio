/**
 * Export a patch for a build of this project.
 *
 * A dialog of its own rather than a page in the build dialog, because a patch is
 * not a build: it produces no installer, signs nothing, and targets no platform.
 * Everything the build dialog is made of - targets, formats, architectures,
 * compression, signing - is a question a patch does not have, and a page that
 * answered none of them inside a dialog called "Build for distribution" would
 * read as a build that skipped them.
 *
 * The two do share a session: the export compiles the same project into the same
 * staging directory, so they cannot run at once, and both report into the build
 * console. That is why this dialog says so little about progress - the console is
 * already where an author watches this kind of work.
 *
 * Desktop only, and not stated on screen: the web export has no support binary to
 * read a patch through, and the mobile shells repack that same web payload, so
 * there is no other place a patch could attach to and nothing for the author to
 * choose between.
 */

import { useCallback, useMemo, useState } from "react";
import { Button, Input, Select, type SelectOption } from "@/lib/components/elements";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { getInterface } from "@/lib/app/bridge";
import { translate, useTranslation } from "@/lib/i18n";
import { basename, join } from "@shared/utils/path";
import type { Workspace } from "@/lib/workspace/workspace";
import { Services } from "@/lib/workspace/services/services";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import type { BuildService } from "@/lib/workspace/services/core/BuildService";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { RELEASE_APP_TAG, type ProjectAppTag } from "@shared/types/appTag";

type PatchDialogInfo = {
    appTags: ProjectAppTag[];
    /** Where the save dialog starts, and the name it offers. */
    defaultOutputFile: string;
};

function PatchDialogContent({
    info,
    onExport,
    onCancel,
}: {
    info: PatchDialogInfo;
    onExport: (choice: { appTagId: string; baselineAppDir: string; outputFile: string; name: string }) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [appTagId, setAppTagId] = useState("");
    const [baselineAppDir, setBaselineAppDir] = useState("");
    const [outputFile, setOutputFile] = useState(info.defaultOutputFile);
    const [name, setName] = useState("");

    const variantOptions = useMemo<SelectOption[]>(
        () => info.appTags.map(tag => ({ value: tag.id, label: tag.name })),
        [info.appTags],
    );

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

    return (
        <div className="grid gap-3 [&>*]:min-w-0">
            <div className="grid gap-1">
                <FieldLabel as="div">{t("build.patch.variantLabel")}</FieldLabel>
                <Select
                    options={variantOptions}
                    value={appTagId || RELEASE_APP_TAG.id}
                    onChange={value => setAppTagId(String(value) === RELEASE_APP_TAG.id ? "" : String(value))}
                    size="sm"
                    fullWidth
                    portalMenu
                    ariaLabel={t("build.patch.variantLabel")}
                />
                {/* Stated because it is the one way to get this wrong without being told: a patch
                    made under the other variant cannot be opened by the build it was meant for, and
                    nothing says so until a player tries it. */}
                <span className="text-2xs text-fg-subtle">{t("build.patch.variantHint")}</span>
            </div>

            <div className="grid gap-1">
                <FieldLabel as="div">{t("build.patch.baselineLabel")}</FieldLabel>
                <div className="flex min-w-0 items-center gap-2">
                    <Input
                        value={baselineAppDir}
                        onChange={event => setBaselineAppDir(event.target.value)}
                        placeholder={t("build.patch.baselinePlaceholder")}
                        size="sm"
                        className="min-w-0 flex-1"
                    />
                    <Button size="sm" variant="secondary" onClick={() => { void pickBaseline(); }}>
                        {t("build.patch.browse")}
                    </Button>
                </div>
                <span className="text-2xs text-fg-subtle">{t("build.patch.baselineHint")}</span>
            </div>

            <div className="grid gap-1">
                <FieldLabel as="div">{t("build.patch.outputLabel")}</FieldLabel>
                <div className="flex min-w-0 items-center gap-2">
                    <Input
                        value={outputFile}
                        onChange={event => setOutputFile(event.target.value)}
                        size="sm"
                        className="min-w-0 flex-1"
                    />
                    <Button size="sm" variant="secondary" onClick={() => { void pickOutput(); }}>
                        {t("build.patch.browse")}
                    </Button>
                </div>
            </div>

            <div className="grid gap-1">
                <FieldLabel as="div">{t("build.patch.nameLabel")}</FieldLabel>
                <Input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    placeholder={t("build.patch.namePlaceholder")}
                    size="sm"
                />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-edge pt-3">
                <Button size="sm" variant="ghost" onClick={onCancel}>
                    {t("common.cancel")}
                </Button>
                <Button
                    size="sm"
                    variant="primary"
                    disabled={!outputFile.trim()}
                    onClick={() => onExport({ appTagId, baselineAppDir: baselineAppDir.trim(), outputFile: outputFile.trim(), name })}
                >
                    {t("build.patch.exportAction")}
                </Button>
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
        uiService.showNotification(translate("build.patch.noKey"), "warning");
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
    const info: PatchDialogInfo = {
        appTags: appTagService?.listTags() ?? [RELEASE_APP_TAG],
        defaultOutputFile: join(projectPath, "dist", `${stem}.patch.dat`),
    };

    const dialogId = uiService.dialogs.show({
        title: translate("build.patch.title"),
        width: 520,
        closable: true,
        content: (
            <PatchDialogContent
                info={info}
                onCancel={() => uiService.dialogs.close(dialogId)}
                onExport={choice => {
                    uiService.dialogs.close(dialogId);
                    void buildService.exportPatch({
                        ...(choice.appTagId ? { appTagId: choice.appTagId } : {}),
                        ...(choice.baselineAppDir ? { baselineAppDir: choice.baselineAppDir } : {}),
                        outputFile: choice.outputFile,
                        ...(choice.name.trim() ? { name: choice.name.trim() } : {}),
                    });
                }}
            />
        ),
    });
}
