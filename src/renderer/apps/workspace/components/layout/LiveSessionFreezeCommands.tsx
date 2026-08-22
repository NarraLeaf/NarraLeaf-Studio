import { useEffect } from "react";
import { Radio, Unlock } from "lucide-react";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { hasExperimentalCondition } from "@shared/types/experimental";
import { experimentalState } from "@/lib/experimental";
import { storyDocumentFreezeScope } from "../../modules/story/scene-editor/storySceneReadOnly";
import { useWorkspace } from "../../context";

/**
 * Put this workspace into the freeze a live session arms, without a session.
 *
 * A live session leaves one story document writable and refuses the rest of what the repository
 * stores. That is a large change to how the whole workspace behaves, and everything about it is
 * observable on one machine - which panels are inert, which controls still read, whether the game
 * still builds - while the part that needs a server, a second person and a room is none of it. So
 * the two are separated here: this arms the state, and a person looks at it.
 *
 * **Experimental, so it is off in every build an author could be holding.** Experimental mode is
 * refused outright by a packaged Studio and needs two flags even in a checkout, which is the right
 * bar for something that makes most of the workspace read-only with no session to explain why.
 * Nothing here is translated, for the reason the rest of that area is not.
 *
 *     yarn dev --experimental --x-live-session-freeze
 *
 * The writable document is the story in the active editor, because that is the one the person
 * running this is looking at. There is no picker: a session's document is decided by whoever opens
 * the session, never chosen from a list, and a picker here would be the wrong shape to then find in
 * the way.
 */
export function LiveSessionFreezeCommands() {
    const { context } = useWorkspace();

    useEffect(() => {
        if (!context || !hasExperimentalCondition(experimentalState(), "live-session-freeze")) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        const freezeService = context.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
        const ui = context.services.get<UIService>(Services.UI);
        const stories = context.services.get<StoryService>(Services.Story);
        const notify = (message: string, detail: string, type = NotificationType.Info) => {
            ui.notifications.show({ type, message, detail });
        };

        /**
         * The story the active editor is showing, or null.
         *
         * Checked against the library rather than trusted: an editor payload is untyped, so a tab
         * that is not a scene editor answers `undefined` here and one carrying a stale id would
         * otherwise arm a freeze whose writable document does not exist - every write refused, with
         * nothing on screen saying which document was meant.
         */
        const activeStoryId = (): string | null => {
            const storyId = (ui.editor.getActive()?.payload as { storyId?: unknown } | undefined)?.storyId;
            if (typeof storyId !== "string" || storyId === "") {
                return null;
            }
            return stories.listStories().some(story => story.id === storyId) ? storyId : null;
        };

        return commandService.registerMany([
            {
                id: "vcs:freeze-live-session",
                // Not a catalog key. Experimental conditions change shape often enough that a
                // translated string would describe the previous one as often as the current.
                title: "Freeze as a live session (experimental)",
                categoryKey: "workspace.shell.commandPalette.categoryVersionControl",
                // The same mark the Team panel puts on a room, because this is that state.
                icon: <Radio className="w-4 h-4" />,
                when: () => !freezeService.isFrozen() && activeStoryId() !== null,
                run: async () => {
                    const storyId = activeStoryId();
                    const scope = storyDocumentFreezeScope(storyId ?? undefined);
                    if (!scope) {
                        // Reachable between the palette reading `when` and the entry being run.
                        notify(
                            "No story is open",
                            "Open a story scene editor first; the writable document is the story it shows.",
                            NotificationType.Warning,
                        );
                        return;
                    }
                    await freezeService.freeze({
                        // A room id is what a real session carries. There is no room here, and a
                        // value that looked like one would be a lie the next reader has to check.
                        session: "experimental",
                        kind: "live-session",
                        writable: [scope],
                    });
                    notify(
                        "Frozen as a live session",
                        `Only ${scope} may be written. Everything else the repository stores is read-only, `
                        + "and building, previewing and testing keep working.",
                    );
                },
            },
            {
                id: "vcs:unfreeze-live-session",
                title: "Leave the live session freeze (experimental)",
                categoryKey: "workspace.shell.commandPalette.categoryVersionControl",
                icon: <Unlock className="w-4 h-4" />,
                // A real session is left by leaving the session; this exists because there is no
                // session to leave. Offered only for the freeze it armed, so it can never be the way
                // out of a merge or a revision view - those have their own, and their own reasons.
                when: () => freezeService.getReason()?.kind === "live-session" && !freezeService.isReleaseHeld(),
                run: () => {
                    freezeService.thaw();
                    notify("Left the live session freeze", "The whole project is writable again.");
                },
            },
        ]);
    }, [context]);

    return null;
}
