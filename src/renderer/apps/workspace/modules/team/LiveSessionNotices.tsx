import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { useWorkspace } from "../../context";
import { liveEndSentence, liveRefusalSentence, liveUndoRefusalSentence } from "./liveSessionText";
import { useLiveSession } from "./useLiveSession";

/**
 * The things a live session says that cannot wait for somebody to open a panel.
 *
 * An edit the host would not take, an undo that could not be sent, a session that ended without the
 * author asking it to - and, for a host, somebody arriving or asking to be let in. All of them
 * happen while the author is looking at a scene, none of them is visible in the scene, and the
 * panel that knows about rooms is a dialog two clicks away that is shut for the whole of a working
 * day.
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

    const { lastRefusal, undoRefusal, ended, requests, session, role } = view;

    /*
     * Who this window has already said something about, by instance.
     *
     * A ref rather than state, for the reason `say` is one: what decides whether a person is
     * announced is the roster the session published, and a component that re-rendered for any
     * other reason must not announce them again. Cleared with the room, because the next room's
     * roster is a different set of arrivals.
     */
    const announced = useRef(new Set<string>());
    const room = session?.id ?? null;
    useEffect(() => {
        announced.current = new Set<string>();
    }, [room]);

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

    /*
     * Somebody arrived, said once per person per room.
     *
     * The host is not told about itself, and nobody is told about a roster they were already
     * looking at when they joined: what is worth saying is a change, and the members already in
     * the room when this window entered are the room rather than an event in it.
     */
    useEffect(() => {
        if (!notifications || session === null) {
            return;
        }
        const arrived = session.members.filter(member => !announced.current.has(member.instance));
        for (const member of session.members) {
            announced.current.add(member.instance);
        }
        // The first pass after entering records everybody and says nothing: those are the people
        // who were already here.
        if (arrived.length === session.members.length) {
            return;
        }
        for (const member of arrived) {
            if (member.instance === view.self) {
                continue;
            }
            notifications.show({
                type: NotificationType.Info,
                message: say.current("workspace.shell.team.liveJoined", { name: member.account }),
            });
        }
    }, [notifications, session, view.self]);

    /*
     * Somebody is asking to be let in, with the answer on the notice itself.
     *
     * ⚠ **The actions are the point.** A request that only said "somebody is waiting" would send
     * the author to find a panel while the person waits, and the panel is two clicks away and shut.
     * The two buttons are the whole decision, and pressing either dismisses the notice.
     */
    const waiting = requests.map(member => member.instance).join(",");
    useEffect(() => {
        if (!notifications || role !== "host" || requests.length === 0) {
            return;
        }
        const live = context?.services.get<LiveSessionService>(Services.Live) ?? null;
        for (const member of requests) {
            if (announced.current.has(`asked:${member.instance}`)) {
                continue;
            }
            announced.current.add(`asked:${member.instance}`);
            notifications.show({
                type: NotificationType.Info,
                message: say.current("workspace.shell.team.liveAsked", { name: member.account }),
                actions: [
                    {
                        label: say.current("workspace.shell.team.liveAdmit"),
                        primary: true,
                        onClick: () => void live?.answerRequest(member.instance, true),
                    },
                    {
                        label: say.current("workspace.shell.team.liveTurnAway"),
                        onClick: () => void live?.answerRequest(member.instance, false),
                    },
                ],
            });
        }
    }, [notifications, role, requests, waiting, context]);

    return null;
}
