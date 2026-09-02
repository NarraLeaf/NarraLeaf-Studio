import { useCallback, useEffect, useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { ownerRefToIndexKey } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import {
    scriptBindingsByRef,
    walkProjectScripts,
} from "@/lib/workspace/services/ui-editor/blueprint/projectScripts";
import type { Blueprint } from "@shared/types/blueprint/document";
import { blueprintContract } from "@shared/blueprint/ownerShape";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { ContextMenu, useContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { Services } from "@/lib/workspace/services/services";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { useWorkspace } from "../../../context";
import { useBlueprintDocumentRevision } from "../hooks/useBlueprintDocumentRevision";
import { BlueprintFrontendBadge } from "./BlueprintFrontendBadge";
import { interfaceDocumentFreezeScope } from "../../ui-editor/uiLiveSession";

/** The menu id that stands for "attach a file" rather than for one of the rows. */
const ATTACH_MENU = "\u0000attach";

type Props = {
    blueprint: Blueprint;
    localBp: LocalBlueprintService;
    /** After creating a sibling or switching active, reopen tab for the chosen blueprint id. */
    onReopenRevision?: (blueprintId: string) => void;
};

/**
 * The revisions of one slot: which is live, what each is written as, and the two ways to add one.
 *
 * A slot's logic is either a blueprint - a graph on a canvas - or a script, a TypeScript file the
 * author owns. Both are revisions of the same slot and only one runs, so they are listed together
 * and each says which of the two it is.
 */
export function BlueprintPrivateRevisionBar({ blueprint, localBp, onReopenRevision }: Props) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuFor, setMenuFor] = useState<string | null>(null);
    const [scriptFiles, setScriptFiles] = useState<string[]>([]);
    // Making a sibling revision writes the blueprint document. Switching which existing revision is
    // active writes too - it is what the game runs - so both are off; the list itself stays readable.
    const freeze = useFreezeGuard(interfaceDocumentFreezeScope());
    const blueprintRevision = useBlueprintDocumentRevision();
    const ownerKey = ownerRefToIndexKey(blueprint.owner);
    const doc = localBp.getBlueprintDocument();
    const rec = doc.ownerRecords[ownerKey];
    const ids = rec?.privateBlueprintIds ?? [];
    // A value binding is evaluated for its Return Value, and a script has no way to hand one back -
    // so the offer is withheld for that invocation rather than for that slot.
    const allowScriptRevision = blueprintContract(blueprint.owner).invocation !== "valueBinding";

    /**
     * Every source under `scripts/`.
     *
     * Both offers need it - re-pointing a script, and attaching a file that is already there. Read
     * when this bar appears, again whenever the document moves (making a script writes a file, and
     * removing a revision leaves one behind), and again when a menu opens, which is the only moment
     * a file that arrived from the author's own editor can be noticed.
     */
    const refreshScriptFiles = useCallback(async () => {
        if (!isInitialized || !context) {
            return;
        }
        const fs = context.services.get<FileSystemService>(Services.FileSystem);
        const files = await walkProjectScripts(async relative => {
            const result = await fs.list(context.project.resolve(relative.split("/")));
            return result.ok ? result.data : null;
        });
        setScriptFiles(files);
    }, [context, isInitialized]);

    useEffect(() => {
        void refreshScriptFiles();
    }, [refreshScriptFiles, blueprintRevision]);

    const openRowMenu = useCallback(
        (event: React.MouseEvent, blueprintId: string) => {
            setMenuFor(blueprintId);
            showMenu(event);
            void refreshScriptFiles();
        },
        [refreshScriptFiles, showMenu],
    );

    /**
     * Files nothing points at.
     *
     * The offer to attach one exists because a file can arrive in the project without Studio: an
     * author writes it in their editor, or renames one and leaves the old reference dangling. Only
     * unused files are offered - a file two slots run is a legitimate arrangement, but not one to
     * fall into by picking from a list.
     */
    const unusedScriptFiles = useMemo(() => {
        const bound = scriptBindingsByRef(doc);
        return scriptFiles.filter(ref => !bound.has(ref));
    }, [doc, scriptFiles]);

    const attachExisting = (scriptRef: string) => {
        void localBp
            .createSiblingPrivateBlueprintForOwnerKey(ownerKey, "typescript", { existingScriptRef: scriptRef })
            .then(newId => onReopenRevision?.(newId));
    };

    const rowMenuItems = (blueprintId: string): ContextMenuDef => {
        const target = doc.blueprints[blueprintId];
        const isScript = target?.program.kind === "scriptModule";
        const currentRef = target?.program.kind === "scriptModule" ? target.program.scriptRef : null;
        const canDelete = ids.length > 1;
        const items: ContextMenuDef = [];
        if (isScript) {
            const others = scriptFiles.filter(ref => ref !== currentRef);
            items.push({
                id: "changeFile",
                label: t("blueprint.script.changeFile"),
                submenu:
                    others.length === 0
                        ? [{ id: "none", label: t("blueprint.script.changeFileEmpty"), disabled: true }]
                        : others.map(ref => ({
                              id: ref,
                              label: ref,
                              onClick: () => localBp.setBlueprintScriptRef(blueprintId, ref),
                          })),
            });
            items.push({ id: "sep", separator: true });
        }
        items.push({
            id: "delete",
            label: isScript ? t("blueprint.revisions.deleteScript") : t("blueprint.revisions.delete"),
            disabled: !canDelete,
            tooltip: canDelete ? undefined : t("blueprint.revisions.deleteOnly"),
            onClick: () => {
                localBp.deletePrivateBlueprintForOwnerKey(ownerKey, blueprintId);
                const remaining = localBp.getBlueprintDocument().ownerRecords[ownerKey]?.activeBlueprintId;
                if (remaining) {
                    onReopenRevision?.(remaining);
                }
            },
        });
        return items;
    };

    return (
        <div className="space-y-2 text-2xs text-fg-muted">
            <p className="text-2xs tracking-wide text-fg-subtle">{t("blueprint.revisions.title")}</p>
            <ul className="space-y-1">
                {ids.map((id, index) => {
                    const b = doc.blueprints[id];
                    const active = rec?.activeBlueprintId === id;
                    return (
                        <li key={id} className="group/rev flex items-center gap-1.5">
                            <button
                                type="button"
                                className={`min-w-0 flex-1 truncate text-left font-mono text-2xs disabled:cursor-not-allowed disabled:opacity-40 ${active ? "text-primary" : "text-fg-muted hover:text-fg"}`}
                                {...freeze.writes(false)}
                                onClick={() => {
                                    if (!active) {
                                        localBp.setActivePrivateBlueprintForOwnerKey(ownerKey, id);
                                        onReopenRevision?.(id);
                                    }
                                }}
                            >
                                {b?.name || t("blueprint.revisions.unnamed", { index: index + 1 })} {active ? t("blueprint.revisions.active") : ""}
                            </button>
                            {b ? <BlueprintFrontendBadge kind={b.program.kind === "scriptModule" ? "typescript" : "visual"} /> : null}
                            <button
                                type="button"
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle opacity-0 transition-opacity hover:bg-surface-hover hover:text-fg focus-visible:opacity-100 group-hover/rev:opacity-100 disabled:cursor-not-allowed"
                                aria-label={t("blueprint.revisions.rowMenu")}
                                {...freeze.writes()}
                                onClick={event => openRowMenu(event, id)}
                            >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                        </li>
                    );
                })}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
                {allowScriptRevision ? (
                    <button
                        type="button"
                        className="rounded-md border border-edge bg-fill-subtle px-2 py-1 text-2xs text-fg hover:bg-fill disabled:cursor-not-allowed disabled:opacity-40"
                        {...freeze.writes()}
                        onClick={() => {
                            void localBp
                                .createSiblingPrivateBlueprintForOwnerKey(ownerKey, "typescript")
                                .then(newId => onReopenRevision?.(newId));
                        }}
                    >
                        {t("blueprint.revisions.newScript")}
                    </button>
                ) : null}
                {allowScriptRevision && unusedScriptFiles.length > 0 ? (
                    <button
                        type="button"
                        className="rounded-md border border-edge bg-fill-subtle px-2 py-1 text-2xs text-fg hover:bg-fill disabled:cursor-not-allowed disabled:opacity-40"
                        {...freeze.writes()}
                        onClick={event => {
                            setMenuFor(ATTACH_MENU);
                            showMenu(event);
                            void refreshScriptFiles();
                        }}
                    >
                        {t("blueprint.revisions.useExisting")}
                    </button>
                ) : null}
                <button
                    type="button"
                    className="rounded-md border border-edge bg-fill-subtle px-2 py-1 text-2xs text-fg hover:bg-fill disabled:cursor-not-allowed disabled:opacity-40"
                    {...freeze.writes()}
                    onClick={() => {
                        void localBp
                            .createSiblingPrivateBlueprintForOwnerKey(ownerKey, "visual")
                            .then(newId => onReopenRevision?.(newId));
                    }}
                >
                    {t("blueprint.revisions.newBlueprint")}
                </button>
            </div>
            {menuState.visible && menuFor ? (
                <ContextMenu
                    items={
                        menuFor === ATTACH_MENU
                            ? unusedScriptFiles.map(ref => ({
                                  id: ref,
                                  label: ref,
                                  onClick: () => attachExisting(ref),
                              }))
                            : rowMenuItems(menuFor)
                    }
                    position={menuState.position}
                    onClose={hideMenu}
                />
            ) : null}
        </div>
    );
}
