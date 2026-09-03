import { useCallback, useEffect, useState } from "react";
import { FolderOpen, SquareArrowOutUpRight } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { ContextMenu, useContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { useProjectDistrusted, useProjectDistrustedReason } from "@/apps/workspace/hooks/useProjectDistrusted";
import type { ExternalScriptEditor } from "@shared/types/scriptEditors";

/**
 * The editors this machine has, asked once per window.
 *
 * Module-level rather than per component: three surfaces offer this menu, the answer is a PATH
 * lookup per known editor, and it does not change while Studio is open. A failed probe is cached as
 * an empty list, which is the same thing the author sees - the two built-in targets and no editors.
 */
let detected: Promise<ExternalScriptEditor[]> | null = null;
function detectEditors(): Promise<ExternalScriptEditor[]> {
    detected ??= getInterface()
        .app.listScriptEditors()
        .then(result => (result.success ? result.data ?? [] : []))
        .catch((): ExternalScriptEditor[] => []);
    return detected;
}

type Props = {
    projectPath: string;
    /** The file to land on. Absent opens the folder alone. */
    scriptRef?: string;
    /** Rendered as a bare icon button rather than a labelled one, for a dense row. */
    compact?: boolean;
};

/**
 * "Open in…" for the project's scripts folder.
 *
 * **The folder, not the file**, in every target: a script resolves its types from
 * `scripts/tsconfig.json` and `scripts/.narraleaf/`, which an editor reads from the folder it has
 * open. The file travels alongside so the editor lands on it. See `externalScriptEditors.ts` in the
 * main process for why this is not the OS file association - on Windows `.ts` is frequently owned
 * by a media player, and opening it that way reported success.
 *
 * The list is what the machine has. An editor that is not installed is not offered, which is why
 * this is a menu rather than a row of buttons: the row would be different on every machine and
 * mostly disabled.
 */
export function ScriptOpenMenu({ projectPath, scriptRef, compact }: Props) {
    const { t } = useTranslation();
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [editors, setEditors] = useState<ExternalScriptEditor[]>([]);
    // Only the editors are refused for a distrusted project - starting a program on the project's
    // behalf is the thing it does not get - so only they are greyed. Revealing the folder and
    // handing it to the OS start nothing of Studio's, and looking at somebody else's files is
    // exactly what an author does before deciding to trust them.
    const distrusted = useProjectDistrusted();
    const distrustedReason = useProjectDistrustedReason();

    useEffect(() => {
        let cancelled = false;
        void detectEditors().then(found => {
            if (!cancelled) {
                setEditors(found);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const open = useCallback(
        (target: string) => {
            void getInterface().app.openScript(projectPath, scriptRef, target);
        },
        [projectPath, scriptRef],
    );

    const items: ContextMenuDef = [
        ...editors.map(editor => ({
            id: editor.id,
            label: t("blueprint.script.openIn", { editor: editor.name }),
            disabled: distrusted,
            tooltip: distrusted ? distrustedReason : undefined,
            onClick: () => open(editor.id),
        })),
        ...(editors.length > 0 ? [{ id: "sep", separator: true as const }] : []),
        {
            id: "reveal",
            label: t("blueprint.script.reveal"),
            onClick: () => open("reveal"),
        },
        {
            id: "system",
            label: t("blueprint.script.openFolder"),
            onClick: () => open("system"),
        },
    ];

    return (
        <>
            <button
                type="button"
                onClick={showMenu}
                aria-label={t("blueprint.script.open")}
                data-tip={compact ? t("blueprint.script.open") : undefined}
                className={
                    compact
                        ? "flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                        : "flex items-center gap-1.5 rounded-md border border-edge bg-fill-subtle px-2.5 py-1.5 text-2xs text-fg hover:bg-fill"
                }
            >
                {compact ? <FolderOpen className="h-3.5 w-3.5" /> : <SquareArrowOutUpRight className="h-3.5 w-3.5" />}
                {compact ? null : t("blueprint.script.open")}
            </button>
            {menuState.visible ? (
                <ContextMenu items={items} position={menuState.position} onClose={hideMenu} />
            ) : null}
        </>
    );
}
