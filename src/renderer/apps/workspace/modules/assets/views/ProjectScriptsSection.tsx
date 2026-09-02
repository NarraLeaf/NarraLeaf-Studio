import { useCallback, useEffect, useState } from "react";
import { AlertCircle, FileCode2, RefreshCw } from "lucide-react";
import { AccordionItem } from "@/lib/components/elements/Accordion";
import { useTranslation } from "@/lib/i18n";
import { ownerLabelKey } from "@shared/types/ui-editor/ownerLabels";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import {
    buildProjectScriptListing,
    scriptBindingsByRef,
    walkProjectScripts,
    type ProjectScriptEntry,
} from "@/lib/workspace/services/ui-editor/blueprint/projectScripts";
import { useBlueprintDocumentRevision } from "../../blueprint-lite/hooks/useBlueprintDocumentRevision";
import { useOpenBlueprintTarget } from "../../blueprint-lite/hooks/useOpenBlueprintTarget";
import { ScriptOpenMenu } from "../../blueprint-lite/ts/ScriptOpenMenu";
import { getScriptPreviewTabId } from "../../blueprint-lite/ts/scriptPreviewTabId";
import { ScriptPreviewEditor } from "../../blueprint-lite/ts/ScriptPreviewEditor";

/**
 * The accordion id. Also the handle verification uses to find the section on screen, the way every
 * asset category carries `data-asset-category`.
 */
export const PROJECT_SCRIPTS_SECTION_ID = "project-scripts";

/**
 * The project's scripts, in the panel an author already opens to see what the project holds.
 *
 * A script blueprint had no list anywhere. It could only be made from inside a blueprint editor, its
 * file could only be reached from that one blueprint, and nothing could answer "what scripts does
 * this project have" or "is anything running this file". This section is that answer: every source
 * under `scripts/`, which blueprint runs each, and the two things an author does with one - read it,
 * and open the folder in their own editor.
 *
 * **Not an asset category.** It sits beside them because this is where an author looks for the
 * project's files, but a script is not in the library: it has no id, no metadata, no thumbnail and
 * no place in an asset set, and the disk rather than Studio owns its bytes. Threading it through
 * `AssetType` would have made every importer, validator and packer answer for a thing none of them
 * can carry.
 */
export function ProjectScriptsSection({ open }: { open: boolean }) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const openBlueprint = useOpenBlueprintTarget();
    // The listing joins the disk with the blueprint document, so it is re-read when either moves.
    const blueprintRevision = useBlueprintDocumentRevision();
    const [entries, setEntries] = useState<ProjectScriptEntry[]>([]);
    const [loading, setLoading] = useState(false);

    const projectPath = isInitialized && context ? context.project.getConfig().projectPath : null;

    const refresh = useCallback(async () => {
        if (!isInitialized || !context) {
            return;
        }
        setLoading(true);
        const fs = context.services.get<FileSystemService>(Services.FileSystem);
        const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const files = await walkProjectScripts(async relative => {
            const result = await fs.list(context.project.resolve(relative.split("/")));
            // A directory that is not there is not an error here: a project with no scripts has no
            // `scripts/` folder to list, and the empty section says that better than a failure would.
            return result.ok ? result.data : null;
        });
        setEntries(buildProjectScriptListing(files, scriptBindingsByRef(localBp.getBlueprintDocument())));
        setLoading(false);
    }, [context, isInitialized]);

    useEffect(() => {
        void refresh();
    }, [refresh, blueprintRevision]);

    const openPreview = useCallback(
        (entry: ProjectScriptEntry) => {
            if (!isInitialized || !context) {
                return;
            }
            const uiService = context.services.get<UIService>(Services.UI);
            uiService.editor.open({
                id: getScriptPreviewTabId(entry.scriptRef),
                title: entry.fileName,
                icon: <FileCode2 className="h-4 w-4" />,
                component: ScriptPreviewEditor,
                closable: true,
                payload: { scriptRef: entry.scriptRef },
            });
        },
        [context, isInitialized],
    );

    return (
        <AccordionItem
            id={PROJECT_SCRIPTS_SECTION_ID}
            icon={<FileCode2 className="w-4 h-4" />}
            headerProps={{ "data-asset-category": PROJECT_SCRIPTS_SECTION_ID, "data-help-topic": "scripts" }}
            title={
                <span className="flex items-center gap-1.5">
                    <span>{t("blueprint.script.sectionTitle")}</span>
                    <span className="text-xs text-fg-subtle">{tn("assets.itemCount", entries.length)}</span>
                </span>
            }
            actions={
                loading ? (
                    <RefreshCw className="w-3 h-3 animate-spin text-fg" />
                ) : (
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            void refresh();
                        }}
                        className="p-1 hover:text-primary"
                        aria-label={t("common.refresh")}
                        data-tip={t("common.refresh")}
                    >
                        <RefreshCw className="w-3 h-3" />
                    </button>
                )
            }
        >
            {entries.length === 0 ? (
                <p className="px-3 py-2 text-xs text-fg-subtle">{t("blueprint.script.sectionEmpty")}</p>
            ) : (
                open && (
                    <ul>
                        {entries.map(entry => (
                            <li key={entry.scriptRef} className="group/script flex items-center gap-2 px-3 py-1 hover:bg-fill-subtle">
                                <button
                                    type="button"
                                    onClick={() => openPreview(entry)}
                                    className="flex min-w-0 flex-1 flex-col items-start text-left"
                                >
                                    <span className="flex w-full min-w-0 items-center gap-1.5">
                                        <span className="truncate font-mono text-xs text-fg">{entry.fileName}</span>
                                        {!entry.exists && (
                                            <AlertCircle className="h-3 w-3 shrink-0 text-danger" aria-label={t("blueprint.script.missing")} />
                                        )}
                                    </span>
                                    <span className="w-full truncate text-2xs text-fg-subtle">
                                        {entry.boundTo.length === 0
                                            ? t("blueprint.script.unbound")
                                            : entry.boundTo.length === 1
                                              ? t("blueprint.script.boundTo", { name: entry.boundTo[0]!.name })
                                              : t("blueprint.script.boundToMany", {
                                                    name: entry.boundTo[0]!.name,
                                                    count: String(entry.boundTo.length - 1),
                                                })}
                                    </span>
                                </button>
                                {entry.boundTo.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            openBlueprint({
                                                blueprintId: entry.boundTo[0]!.blueprintId,
                                                ownerKind: entry.boundTo[0]!.owner.kind,
                                                title: entry.boundTo[0]!.name,
                                            })
                                        }
                                        className="shrink-0 rounded-sm px-1.5 py-0.5 text-2xs text-fg-muted opacity-0 transition-opacity hover:bg-fill hover:text-fg group-hover/script:opacity-100"
                                    >
                                        {t(ownerLabelKey(entry.boundTo[0]!.owner.kind))}
                                    </button>
                                )}
                                {projectPath && <ScriptOpenMenu projectPath={projectPath} scriptRef={entry.scriptRef} compact />}
                            </li>
                        ))}
                    </ul>
                )
            )}
        </AccordionItem>
    );
}
