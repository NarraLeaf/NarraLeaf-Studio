import { useCallback, useEffect, useMemo } from "react";
import { CircleQuestionMark, LibraryBig } from "lucide-react";
import type { TranslationKey } from "@shared/i18n";
import { HelpOverlay, HELP_TOPICS, helpTitleKey, openHelpTopic, requestContextHelp, type HelpTopicId } from "@/lib/help";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { getKeybindingCatalogEntry } from "@/lib/workspace/services/ui/keybindingCatalog";
import { useWorkspace } from "../../context";
import { useKeybinding } from "../../hooks";
import { openHelpTab } from "../../modules/help/openHelpTab";

/**
 * The workspace's half of the help system: the popover host, `F1`, and one palette entry per topic.
 *
 * Mounted beside {@link KeybindingCheatSheet} rather than inside any panel - help has to answer for
 * whatever the author is looking at, so it cannot live inside one of the things it describes.
 *
 * `F1` with nothing under the cursor opens the browser instead of doing nothing: a help key that
 * silently does nothing teaches the author that help does not exist here.
 */
export function WorkspaceHelp() {
    const { context } = useWorkspace();

    // With a topic when the popover hands one over, without one when `F1` found nothing to answer
    // for: there is no question to carry then, so the browser opens on its list.
    const openBrowser = useCallback((topicId?: HelpTopicId) => {
        if (context) {
            openHelpTab(context, topicId);
        }
    }, [context]);

    useKeybinding({
        id: "workspace-context-help",
        catalogId: "workspace-context-help",
        key: "f1",
        description: "Help for what is focused",
        // "What is this field" is asked with the caret in the field.
        allowInEditable: true,
        handler: () => {
            if (!requestContextHelp()) {
                openBrowser();
            }
        },
        deps: [openBrowser],
    });

    // Chords resolve through this window's service, so a rebound key reads correctly in a topic.
    const resolveShortcut = useMemo(() => {
        const keybindings = context?.services.get<UIService>(Services.UI).keybindings;
        return (catalogId: string): string | undefined => {
            const entry = getKeybindingCatalogEntry(catalogId);
            if (!entry) {
                return undefined;
            }
            return keybindings?.getEffectiveKey({ id: entry.id, key: entry.key }) ?? entry.key;
        };
    }, [context]);

    /**
     * Every topic by name, plus the browser itself.
     *
     * Registered rather than derived: a topic is not an action, a panel or a keybinding, so
     * `collectPaletteCommands` has no source to find it in. Titles come through `titleKey`, so the
     * list follows a live language switch without this effect re-running.
     */
    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        return commandService.registerMany([
            {
                id: "help:browser",
                titleKey: "help.ui.allTopics",
                categoryKey: "help.ui.title",
                order: -1,
                // The one row here that is not a topic, so it is the one row that does not wear the
                // topic glyph: it opens the shelf rather than answering a question.
                icon: <LibraryBig className="w-4 h-4" />,
                run: () => openHelpTab(context),
            },
            ...HELP_TOPICS.map(topic => ({
                id: `help:${topic.id}`,
                titleKey: helpTitleKey(topic.id),
                categoryKey: "help.ui.title" as TranslationKey,
                // One glyph for all of them on purpose. Forty-nine hand-picked icons would be
                // forty-nine guesses at what a topic is about, when what the column has to say is
                // "this row answers a question" - the title already says which one.
                icon: <CircleQuestionMark className="w-4 h-4" />,
                // From the palette there is nothing to anchor to, so this centres - and the popover
                // is still the right surface, because the author asked one question.
                run: () => openHelpTopic(topic.id),
            })),
        ]);
    }, [context]);

    return <HelpOverlay onOpenBrowser={openBrowser} resolveShortcut={resolveShortcut} />;
}
