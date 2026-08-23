import { useEffect, useMemo, useState } from "react";
import type { StoryId } from "@shared/types/story";
import { makeFreezeGuard, type FreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useTranslation } from "@/lib/i18n";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "../../context";

/**
 * What a live session takes away from the story surfaces, and what it leaves alone.
 *
 * A session carries a closed vocabulary of story operations (`@shared/live/ops`), and
 * `StoryService` hands exactly eleven of its mutators to the session's sink. An edit that reaches
 * the same document by any other route is written here and nowhere else: the other machines never
 * hear about it, their copies of the scene stop matching this one, and the next effect the host
 * broadcasts about that scene makes the divergence guard throw this window out of the room. Being
 * ejected for using a menu item is not a design.
 *
 * So the surfaces that write a story document by one of those other routes ask this whether a
 * session owns the document first, and switch the control off with a sentence when one does.
 *
 * **Asked of the session, never worked out from the freeze.** A session does arm a freeze, but the
 * freeze answers a different question - which *files* may be written - and it deliberately leaves
 * this story document writable so that ordinary editing keeps working. The question here is which
 * *edits travel*, and only the session knows that.
 *
 * The answer is shaped as a {@link FreezeGuard} because the workspace already has one bargain for a
 * control that cannot act, and the author has already learnt it: the control stays where it is,
 * greyed, with the reason on hover. Reusing the shape means these surfaces spread the same render
 * props they already spread for a freeze, and no call site grows a second convention.
 */

/**
 * Whether a live session owns this story document, as a guard the controls can spread.
 *
 * Subscribed rather than read once: a session opens and ends while the panels stay mounted, and a
 * control that answered from the moment it was rendered would keep offering an edit for the whole
 * of a session somebody else started.
 *
 * `undefined` for `storyId` - a panel with nothing selected - answers "not owned", which is the
 * only honest answer: there is no document for a session to own yet, and every control that could
 * write one is unreachable in that state anyway.
 */
export function useStoryLiveSessionGuard(storyId: string | undefined): FreezeGuard {
    const { context, isInitialized } = useWorkspace();
    const { t } = useTranslation();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
    const [owned, setOwned] = useState(false);

    useEffect(() => {
        if (!service || !storyId) {
            setOwned(false);
            return;
        }
        const read = () => setOwned(service.ownsStory(storyId as StoryId));
        // Read on the way in as well as on every change: a panel mounted during a session has
        // missed the event that started it.
        read();
        return service.onChanged(read);
    }, [service, storyId]);

    const reason = t("story.live.editUnavailable");
    return useMemo(() => makeFreezeGuard(owned, reason), [owned, reason]);
}

/**
 * Which of the two guards a control is actually held back by, when both could hold it back.
 *
 * A story surface has two answers to keep straight. `documentFreeze` is the workspace's - scoped to
 * this story document, so it is *open* inside a session, which is the whole point of a freeze that
 * leaves one file writable. `liveSession` is the one above.
 *
 * The freeze wins when it applies, and that is about what the author reads rather than about which
 * is stricter: a freeze covering this document has already greyed the entire editor, and the
 * workspace's own single string is what every other control in it is showing. A session that leaves
 * the document writable is the case where one control is missing from an editor that otherwise
 * works, and that is the case worth a sentence of its own.
 */
export function storyEditGuard(documentFreeze: FreezeGuard, liveSession: FreezeGuard): FreezeGuard {
    return documentFreeze.frozen ? documentFreeze : liveSession;
}
