import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CLAIM_REASSERT_MS } from "@/lib/live";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { charactersSpec } from "@shared/documents/specs";
import { characterClaimKey } from "@shared/live/ops";
import { useWorkspace } from "../../context";

/**
 * The cast, as a live session shows it: which records somebody else is inside, and what the panel
 * may still do while a session is running.
 *
 * The story editor's file of the same shape is `storyRowClaims`, and everything here is its
 * counterpart one document along - deliberately, because a second design for the same idea would be
 * a second thing to keep correct. What differs is only what a claim is over (a character record
 * rather than a row) and what a session cannot carry at all (deleting a character).
 */

/** Which file the cast's editors write, as the project-relative path the freeze policy takes. */
export function characterDocumentFreezeScope(): string {
    // Through the document spec rather than spelled out here, for the reason `writeFreeze` gives for
    // naming its derived libraries by kind: a path written a second time is a path that falls behind
    // the one `CharacterService` actually saves to, and this one is compared against the set a live
    // session declares writable. If the two ever disagree, the panel offers an edit the write
    // boundary refuses.
    return charactersSpec.pathFor();
}

/* ---------------------------------------------------------------------------- holding one */

/** The one thing a hold needs of a live session. See `LiveSession.claimCharacter`. */
export type CharacterClaimPort = {
    claimCharacter(characterId: string, holding: boolean): void;
};

/**
 * Hold the record this panel has open, keep saying so, and give it back when it closes.
 *
 * ⚠ **Asserted for as long as the record is open, not for as long as its author is typing**, which
 * is the rule the story editor arrived at the expensive way: the assertion used to ride on
 * keystrokes, so an author who stopped to think went on being named on a row they no longer held,
 * and somebody else was shown "alice is writing this" over a line they were free to delete. The
 * properties panel is the same shape - its text fields keep a draft in their own state until the
 * field is blurred - so what a claim means here is "this record is open in front of somebody", and
 * that is what asserts it.
 *
 * Silent outside a session, so the panel calls it without asking whether there is one.
 */
export function useCharacterClaimHold(input: {
    /** Null before the workspace is up, which is a window that cannot be in a session either. */
    service: CharacterClaimPort | null;
    /** The record open for editing, or null when none is. */
    characterId: string | null;
}): void {
    const { service, characterId } = input;

    useEffect(() => {
        if (!service || characterId === null) {
            return;
        }
        service.claimCharacter(characterId, true);
        // An interval rather than a message per keystroke: see `CLAIM_REASSERT_MS`.
        const timer = setInterval(() => service.claimCharacter(characterId, true), CLAIM_REASSERT_MS);
        return () => {
            clearInterval(timer);
            service.claimCharacter(characterId, false);
        };
    }, [service, characterId]);
}

/* --------------------------------------------------------------------------- reading them */

/** Character id to the account editing it, for every record somebody else holds. */
export type CharacterClaims = Readonly<Record<string, string>>;

const NO_CLAIMS: CharacterClaims = {};

const CharacterClaimsContext = createContext<CharacterClaims>(NO_CLAIMS);

/**
 * The claims on the cast, kept as one value that only changes when it would read differently.
 *
 * One subscription rather than one per row, for the reason the story's provider gives: the session
 * publishes on every operation anybody in the room applies, and a list item that read the service
 * itself would re-render on every remote keystroke.
 */
export function CharacterClaimsProvider({ children }: { children: React.ReactNode }) {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
    const [claims, setClaims] = useState<CharacterClaims>(NO_CLAIMS);

    useEffect(() => {
        if (!service) {
            setClaims(NO_CLAIMS);
            return;
        }
        const read = () => setClaims(previous => {
            const next = othersCharacterClaims(service.getView());
            return signatureOf(next) === signatureOf(previous) ? previous : next;
        });
        // On the way in as well as on every change: a panel opened during a session has missed the
        // message that carried the claims standing at that moment.
        read();
        return service.onChanged(read);
    }, [service]);

    return <CharacterClaimsContext.Provider value={claims}>{children}</CharacterClaimsContext.Provider>;
}

function signatureOf(claims: CharacterClaims): string {
    return Object.entries(claims)
        .map(([characterId, account]) => `${characterId}=${account}`)
        .sort()
        .join("\n");
}

/** Who else is inside this record, or null when nobody is. */
export function useCharacterClaim(characterId: string): string | null {
    return useContext(CharacterClaimsContext)[characterId] ?? null;
}

/**
 * Everybody else's claims on the cast, by record.
 *
 * **This window's own are left out**, for the story's reason: a mark on the record its author has
 * open is the one place it could be read as being about them, and it would arrive and go as they
 * moved between characters. A second machine signed in to the same account is therefore unmarked,
 * which is the cost of comparing accounts - a claim carries no other name a person would recognise.
 *
 * The claim set holds rows and records at once, keyed by a prefix, so the cast reads only its own
 * keys back out. Two documents' bare uuids meeting in one map would be a confusion nothing could
 * detect.
 */
export function othersCharacterClaims(view: LiveSessionView): CharacterClaims {
    const self = selfAccount(view);
    const held: Record<string, string> = {};
    for (const [key, account] of Object.entries(view.claims)) {
        const characterId = characterIdOf(key);
        if (characterId !== null && account !== self) {
            held[characterId] = account;
        }
    }
    return held;
}

/**
 * Who else holds ONE record, subscribed to directly.
 *
 * For a surface that is not inside {@link CharacterClaimsProvider} - the properties panel, which
 * shows one character at a time and is mounted somewhere else entirely. One subscription for one
 * record costs nothing; the provider exists for the list, where hundreds of rows would otherwise
 * take a subscription each.
 */
export function useCharacterClaimOf(characterId: string | null): string | null {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
    const [heldBy, setHeldBy] = useState<string | null>(null);

    useEffect(() => {
        if (!service || characterId === null) {
            setHeldBy(null);
            return;
        }
        const read = () => setHeldBy(characterClaimHolder(service.getView(), characterId));
        // On the way in as well as on every change: a panel opened during a session has missed the
        // message that carried the claims standing at that moment.
        read();
        return service.onChanged(read);
    }, [service, characterId]);

    return heldBy;
}

/** Who else holds ONE record, read without React, for a caller outside the provider. */
export function characterClaimHolder(view: LiveSessionView, characterId: string): string | null {
    const account = view.claims[characterClaimKey(characterId)];
    return account === undefined || account === selfAccount(view) ? null : account;
}

/** The record a claim key is over, or null when the key is about something else. */
function characterIdOf(key: string): string | null {
    const prefix = characterClaimKey("");
    return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

function selfAccount(view: LiveSessionView): string | null {
    return view.session?.members.find(member => member.instance === view.self)?.account ?? null;
}

/* ------------------------------------------------------------------------- what it draws */

/**
 * The mark on a character somebody else is editing.
 *
 * The same monogram the member wears in the title bar, in the collaboration panel and on a story
 * row - `nameInitials` and `nameMonogramColor` derive both halves from the account name - so it says
 * *a person* rather than *an action*, and says which person. A glyph here read as a sixth button on
 * the row the pointer was over, which is the mistake the story row already made once.
 */
export function CharacterClaimMark({ account }: { account: string }) {
    const { t } = useTranslation();
    return (
        <span
            data-character-claim={account}
            data-tip={t("characters.live.recordClaimed", { name: account })}
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-2xs font-medium leading-none text-white"
            style={{ backgroundColor: nameMonogramColor(account) }}
        >
            {nameInitials(account).slice(0, 1)}
        </span>
    );
}

/* ------------------------------------------------------------------ what a session refuses */

/** Whether the cast may still lose a member, and what to say when it may not. */
export type CharacterDeleteFreeze = {
    unavailable: boolean;
    /** Hover text for the control this switches off; undefined while it is live. */
    reason: string | undefined;
};

/**
 * Whether deleting a character is available, and why not when it is not.
 *
 * ⚠ **A session leaves the cast writable and still cannot carry a deletion**, which is the one place
 * on this panel where "the document is writable" is not the whole answer. Deleting a character
 * rewrites every dialogue row in the PROJECT that speaks it, across every story document, and a
 * session carries one: sending the deletion alone would leave the other documents holding an id that
 * resolves to nothing, and sweeping them would write to files the session froze.
 *
 * So it is refused whole rather than applied partly - the same ruling already shipped for the other
 * direction, promoting an unresolved speaker into a character, which is this seam seen from the other
 * side. `CharacterService.deleteCharacter` is what makes it true; this is only what says so before
 * the author presses anything.
 */
export function useCharacterDeleteFreeze(inSession: boolean): CharacterDeleteFreeze {
    const { t } = useTranslation();
    if (!inSession) {
        return { unavailable: false, reason: undefined };
    }
    return { unavailable: true, reason: t("characters.live.deleteUnavailable") };
}

/** Whether this window is in a live session at all. The one thing the delete rung has to ask. */
export function useInLiveSession(): boolean {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
    const [inSession, setInSession] = useState(false);

    useEffect(() => {
        if (!service) {
            setInSession(false);
            return;
        }
        const read = () => setInSession(service.getView().phase !== "idle");
        read();
        return service.onChanged(read);
    }, [service]);

    return inSession;
}
