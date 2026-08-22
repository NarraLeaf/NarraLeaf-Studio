import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { PenLine } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import type { StoryBlockId, StoryId } from "@shared/types/story";
import { useWorkspace } from "../../../context";

/**
 * Who is writing which row of this scene, and the mark that says so.
 *
 * A live session records a claim on a row while somebody is writing it, and refuses everybody
 * else's edits to it. Without a mark, the first an author knows about a claim is a refusal after
 * they have typed a paragraph - which is the failure the claim exists to prevent, arriving one
 * gesture too late.
 *
 * **Through one context, not one subscription per row.** A scene is hundreds of rows and the
 * session publishes on every operation anybody in the room applies. A row that read the service
 * itself would re-render on every remote keystroke; the provider below subscribes once and only
 * changes the value it hands down when the set of claims would actually look different.
 *
 * **This window's own claims are left out.** They are recorded by account like everybody's, but a
 * mark appearing on the row the author is typing in is the one place it could be read as being
 * about them - and it would arrive and go as they moved between lines. An author knows which line
 * they are on. (A second machine signed in to the same account is therefore unmarked here, which is
 * the cost of comparing accounts; a claim carries no other name a person would recognise.)
 */

/** Block id to the account writing it, for every row somebody else holds. */
export type StoryRowClaims = Readonly<Record<StoryBlockId, string>>;

const NO_CLAIMS: StoryRowClaims = {};

const StoryRowClaimsContext = createContext<StoryRowClaims>(NO_CLAIMS);

/**
 * The claims on one story, kept as one value that only changes when it would read differently.
 *
 * `storyId` is compared because a session owns one document: a scene of another story is not part
 * of the room, and its rows are the author's own to write.
 */
export function StoryRowClaimsProvider({ storyId, children }: {
    storyId: StoryId | undefined;
    children: React.ReactNode;
}) {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
    const [claims, setClaims] = useState<StoryRowClaims>(NO_CLAIMS);

    useEffect(() => {
        if (!service) {
            setClaims(NO_CLAIMS);
            return;
        }
        // Kept only where it would read differently. The session publishes on every operation
        // anybody applies, and a fresh object each time would re-render every row on screen for a
        // set of claims that had not moved.
        const read = () => setClaims(previous => {
            const next = othersClaims(service.getView(), storyId);
            return signatureOf(next) === signatureOf(previous) ? previous : next;
        });
        // Read on the way in as well as on every change: a scene opened during a session has missed
        // the message that carried the claims standing at that moment.
        read();
        return service.onChanged(read);
    }, [service, storyId]);

    return <StoryRowClaimsContext.Provider value={claims}>{children}</StoryRowClaimsContext.Provider>;
}

/** The rows and their holders, flattened, so two sets can be compared as one value. */
function signatureOf(claims: StoryRowClaims): string {
    return Object.entries(claims)
        .map(([blockId, account]) => `${blockId}=${account}`)
        .sort()
        .join("\n");
}

/** Who holds this row, or null when nobody else does. */
export function useStoryRowClaim(blockId: StoryBlockId): string | null {
    return useContext(StoryRowClaimsContext)[blockId] ?? null;
}

/**
 * Everybody else's claims on one story, by row.
 *
 * Exported for the test that pins the two exclusions - another story's rows, and this author's own
 * - because both are invisible on screen when they are working.
 */
export function othersClaims(view: LiveSessionView, storyId: StoryId | undefined): StoryRowClaims {
    if (storyId === undefined || view.storyId !== storyId) {
        return NO_CLAIMS;
    }
    const self = view.session?.members.find(member => member.instance === view.self)?.account ?? null;
    const held: Record<StoryBlockId, string> = {};
    for (const [blockId, account] of Object.entries(view.claims)) {
        if (account !== self) {
            held[blockId] = account;
        }
    }
    return held;
}

/**
 * The mark on a row somebody else is writing.
 *
 * **It takes no width, and that is the whole of its design.** A story row is four columns of
 * fixed-width cells and a body that wraps; anything added to that flow re-wraps the words, and text
 * that moves while somebody is reading it is the worst thing an editing surface can do - the row
 * has already had that bug twice (see the hover cluster, which is mounted on every row for exactly
 * this reason). So the mark is absolutely positioned into the row's own trailing padding, where
 * nothing else is drawn: appearing and disappearing as people move between lines costs the words
 * beside it nothing at all.
 *
 * The account is on hover rather than beside the glyph, because there is no width for a name and a
 * truncated one names nobody.
 */
export function StoryRowClaimMark({ account, onArtwork }: {
    account: string;
    /** The row's trailing edge is a background strip rather than the page. See `.nl-on-media`. */
    onArtwork?: boolean;
}) {
    const { t } = useTranslation();
    return (
        <span
            data-story-row-claim={account}
            data-tip={t("story.live.rowClaimed", { name: account })}
            className={[
                "absolute right-0 top-1 flex h-[var(--nl-story-row-box)] w-3 items-center justify-center text-fg-subtle",
                onArtwork ? "nl-on-media" : "",
            ].join(" ")}
        >
            <PenLine className="h-3 w-3" />
        </span>
    );
}
