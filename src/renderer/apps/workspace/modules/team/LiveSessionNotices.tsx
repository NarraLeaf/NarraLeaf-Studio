import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { useWorkspace } from "../../context";
import { liveEndSentence, liveRefusalSentence, liveUndoRefusalSentence } from "./liveSessionText";
import { useLiveSession } from "./useLiveSession";

/**
 * The three things a live session says that cannot wait for somebody to open a panel.
 *
 * An edit the host would not take, an undo that could not be sent, and a session that ended without
 * the author asking it to. All three happen while the author is looking at a scene, none of them is
 * visible in the scene, and the panel that knows about rooms is a dialog two clicks away that is
 * shut for the whole of a working day.
 *
 * **Notifications, and deliberately nothing heavier.** A refused row is precisely the case where the
 * only copy of a finished paragraph is the text on screen: the host says no *because* the author is
 * about to lose it. So nothing here may take focus, move a caret, close a box or re-render a field
 * - a dialog over the editor would make the interruption cost what the refusal was preventing.
 * Studio's notifications stay until they are dismissed and land in the notification history, so a
 * quiet one is not a lost one.
 *
 * Mounted beside the Team cell, which is drawn for as long as the project is: a session outlives
 * every panel and every tab, and an ending reported by a component that had unmounted would be an
 * ending nobody heard.
 */
export function LiveSessionNotices(): null {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    /*
     * The translator, held rather than depended on.
     *
     * `useTranslation` answers with a fresh object every render, so an effect listing `t` among its
     * dependencies runs again on every render of this component - which would say the same refusal
     * once per operation anybody in the room applied. What decides whether something is said is the
     * value the session published, and nothing else.
     */
    const say = useRef(t);
    say.current = t;
    const { view } = useLiveSession();
    const notifications = useMemo(
        () => (context && isInitialized ? context.services.get<UIService>(Services.UI).notifications : null),
        [context, isInitialized],
    );

    const { lastRefusal, undoRefusal, ended } = view;

    /*
     * Each of the three keys on the value the session published, not on a render.
     *
     * The session replaces these whole - a refusal is one object, set once and cleared when the next
     * operation lands - so an effect keyed on it runs exactly once per thing that happened. The one
     * case it stays quiet for is the same gesture failing the same way twice in a row, which is the
     * author repeating something they have already been told about.
     */
    useEffect(() => {
        if (!notifications || lastRefusal === null) {
            return;
        }
        const sentence = liveRefusalSentence(lastRefusal);
        notifications.show({
            type: NotificationType.Warning,
            message: say.current(sentence.key, sentence.params),
        });
    }, [notifications, lastRefusal]);

    useEffect(() => {
        if (!notifications || undoRefusal === null) {
            return;
        }
        const key = liveUndoRefusalSentence(undoRefusal);
        if (key === null) {
            // The two ends of the stack. Pressing Ctrl+Z once more than there are steps is an
            // ordinary thing to do and is not worth saying anything about.
            return;
        }
        notifications.show({ type: NotificationType.Warning, message: say.current(key) });
    }, [notifications, undoRefusal]);

    useEffect(() => {
        if (!notifications || ended === null) {
            return;
        }
        const key = liveEndSentence(ended);
        if (key === null) {
            // The author left. They pressed the control and watched the row change.
            return;
        }
        notifications.show({
            // A divergence is not a goodbye: this machine's copy of the story stopped matching the
            // room's, so what is on this disk is neither the session's document nor anything the
            // others will receive. It is the one ending with something to do about it.
            type: ended.cause === "diverged" ? NotificationType.Error : NotificationType.Info,
            message: say.current(key),
            ...(ended.cause === "diverged"
                ? { detail: say.current("workspace.shell.team.liveEndedDivergedNext") }
                : {}),
        });
    }, [notifications, ended]);

    return null;
}
