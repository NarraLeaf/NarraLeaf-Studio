import { useCallback, useEffect, useMemo, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { ContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { DictionaryService } from "@/lib/workspace/services/dictionary/DictionaryService";
import type { SpellcheckContextMenuPayload } from "@shared/types/spellcheck";
import { useWorkspace } from "../context";
import { useFreezeGuard } from "./ui/freezeGuard";

/** How many of Chromium's replacements to offer. Past this the menu is a word list, not a choice. */
const MAX_SUGGESTIONS = 5;

/**
 * The menu a right click on editable text opens.
 *
 * It exists here, at the workspace root, rather than on the field that was clicked, because the
 * thing that decides its contents arrives from the main process: Chromium's spellchecker runs below
 * the page, so `misspelledWord` and its suggestions are only knowable there and reach the renderer
 * as a pushed event (see `AppWindow.prepareEvents`). Any field that leaves the default context-menu
 * behaviour alone gets this menu; a field that opens a menu of its own calls `preventDefault` and is
 * never seen here.
 *
 * The editing rows are here for the same reason the menu is: the story text field gave up its row
 * menu to let the request through, so this has to be a text menu and not only a spelling one. They
 * go through the window's edit commands rather than `document.execCommand`, because Chromium
 * refuses a scripted paste.
 */
export function SpellcheckContextMenu(): React.ReactElement | null {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const freeze = useFreezeGuard();
    const [target, setTarget] = useState<SpellcheckContextMenuPayload | null>(null);

    const dictionaryService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<DictionaryService>(Services.Dictionary);
    }, [context, isInitialized]);

    useEffect(() => {
        const token = getInterface().app.spellcheck.onContextMenu(payload => setTarget(payload));
        return () => token.cancel();
    }, []);

    const close = useCallback(() => setTarget(null), []);

    const items = useMemo<ContextMenuDef>(() => {
        if (!target) {
            return [];
        }
        const rows: ContextMenuDef = [];

        if (target.misspelledWord) {
            const suggestions = target.suggestions.slice(0, MAX_SUGGESTIONS);
            for (const suggestion of suggestions) {
                rows.push({
                    id: `spellcheck.suggestion.${suggestion}`,
                    label: suggestion,
                    onClick: () => void getInterface().app.spellcheck.replaceMisspelling(suggestion),
                });
            }
            if (suggestions.length === 0) {
                // A row rather than nothing. An empty suggestion list is a real answer - Chromium has
                // no near-miss for this word - and a menu that opened straight onto "Add to
                // dictionary" would read as if the word had not been checked at all.
                rows.push({
                    id: "spellcheck.noSuggestions",
                    label: t("workspace.shell.spellcheck.noSuggestions"),
                    disabled: true,
                });
            }
            rows.push({
                id: "spellcheck.addWord",
                label: t("workspace.shell.spellcheck.addToDictionary"),
                // The word goes into the project's document, not the machine's profile: it is the
                // author's own vocabulary and it travels with the repository.
                onClick: () => {
                    try {
                        dictionaryService?.addWord(target.misspelledWord);
                    } catch {
                        // A recovery-mode workspace never loaded the document. It also freezes
                        // project writes, so this row is already disabled - the catch is only here
                        // so a state nobody anticipated costs a menu click rather than a crash.
                    }
                },
                ...freeze.menuRow(!dictionaryService),
            });
            rows.push({ separator: true, id: "spellcheck.separator" });
        }

        rows.push({
            id: "spellcheck.cut",
            label: t("common.cut"),
            disabled: !target.canCut,
            onClick: () => getInterface().window.editCommand("cut"),
        });
        rows.push({
            id: "spellcheck.copy",
            label: t("common.copy"),
            disabled: !target.canCopy,
            onClick: () => getInterface().window.editCommand("copy"),
        });
        rows.push({
            id: "spellcheck.paste",
            label: t("common.paste"),
            disabled: !target.canPaste,
            onClick: () => getInterface().window.editCommand("paste"),
        });

        return rows;
    }, [dictionaryService, freeze, t, target]);

    if (!target) {
        return null;
    }

    return (
        <ContextMenu
            items={items}
            position={{ x: target.x, y: target.y }}
            onClose={close}
            visible
        />
    );
}
