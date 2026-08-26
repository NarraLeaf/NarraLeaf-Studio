import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CLAIM_REASSERT_MS } from "@/lib/live";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { variableRegistrySpec } from "@shared/documents/specs";
import { variableClaimKey } from "@shared/live/ops";
import { useWorkspace } from "../../context";

/**
 * The variables panel, as a live session shows it: which entries somebody else is inside.
 *
 * `characterLiveSession` and `localizationLiveSession` one document along, and deliberately their
 * counterpart method for method - a fourth design for the same idea would be a fourth thing to keep
 * correct. What differs is what a claim is over: one registry entry, keyed by its id alone, because
 * there is one registry per project and an entry id is unique inside it.
 */

/* --------------------------------------------------------------------------- freeze scope */

/**
 * Which file the variables panel's two project scopes write, as the project-relative path the freeze
 * policy takes.
 *
 * Through the document spec rather than spelled out here, for the reason `writeFreeze` gives: a path
 * written a second time is a path that falls behind the one `VariableRegistryService` actually saves
 * to, and this one is compared against the set a live session declares writable. If the two ever
 * disagree, the panel offers an edit the write boundary refuses.
 *
 * ⚠ **The scene section is not this document and must not carry this scope.** Scene variables are
 * declaration rows in a story, so what governs them is the story's own freeze - and this panel shows
 * them read-only anyway.
 */
export function variableRegistryFreezeScope(): string {
    return variableRegistrySpec.pathFor();
}

/* ---------------------------------------------------------------------------- holding one */

/** The one thing a hold needs of a live session. See `LiveSession.claimVariable`. */
export type VariableClaimPort = {
    claimVariable(variableId: string, holding: boolean): void;
};

/**
 * Hold the entry this panel has open, keep saying so, and give it back when the row loses focus.
 *
 * ⚠ **Asserted for as long as a box on the row has focus, not for as long as its author is typing.**
 * The panel's name and default boxes are controlled inputs that write on every keystroke, so with a
 * session installed the box's value IS the document: an edit to the same entry arriving mid-word
 * lands under the cursor and takes whatever was being composed. A claim that lapsed on a pause would
 * let exactly that happen.
 *
 * Silent outside a session, so the panel calls it without asking whether there is one.
 */
export function useVariableClaimHold(input: {
    /** Null before the workspace is up, which is a window that cannot be in a session either. */
    service: VariableClaimPort | null;
    /** The entry a box is open on, or null when none is. */
    variableId: string | null;
}): void {
    const { service, variableId } = input;

    useEffect(() => {
        if (!service || variableId === null) {
            return;
        }
        service.claimVariable(variableId, true);
        // An interval rather than a message per keystroke: see `CLAIM_REASSERT_MS`.
        const timer = setInterval(() => service.claimVariable(variableId, true), CLAIM_REASSERT_MS);
        return () => {
            clearInterval(timer);
            service.claimVariable(variableId, false);
        };
    }, [service, variableId]);
}

/* --------------------------------------------------------------------------- reading them */

/** Entry id to the account editing it, for every entry somebody else holds. */
export type VariableClaims = Readonly<Record<string, string>>;

const NO_CLAIMS: VariableClaims = {};

const VariableClaimsContext = createContext<VariableClaims>(NO_CLAIMS);

/** Whether a live session is carrying this project's registry, for the controls it switches off. */
const VariableSessionContext = createContext<boolean>(false);

/**
 * The claims on the registry, and whether a session is running, as two values that only change when
 * they would read differently.
 *
 * One subscription rather than one per row, for the reason the cast's provider gives: the session
 * publishes on every operation anybody in the room applies, and a row that read the service itself
 * would re-render on every remote keystroke.
 */
export function VariableClaimsProvider({ children }: { children: React.ReactNode }) {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
    const [claims, setClaims] = useState<VariableClaims>(NO_CLAIMS);
    const [inSession, setInSession] = useState(false);

    useEffect(() => {
        if (!service) {
            setClaims(NO_CLAIMS);
            setInSession(false);
            return;
        }
        const read = () => {
            const view = service.getView();
            setClaims(previous => {
                const next = othersVariableClaims(view);
                return signatureOf(next) === signatureOf(previous) ? previous : next;
            });
            setInSession(view.phase !== "idle");
        };
        // On the way in as well as on every change: a panel opened during a session has missed the
        // message that carried the claims standing at that moment.
        read();
        return service.onChanged(read);
    }, [service]);

    return (
        <VariableSessionContext.Provider value={inSession}>
            <VariableClaimsContext.Provider value={claims}>{children}</VariableClaimsContext.Provider>
        </VariableSessionContext.Provider>
    );
}

function signatureOf(claims: VariableClaims): string {
    return Object.entries(claims)
        .map(([variableId, account]) => `${variableId}=${account}`)
        .sort()
        .join("\n");
}

/** Who else is editing this entry, or null when nobody is. */
export function useVariableClaim(variableId: string): string | null {
    return useContext(VariableClaimsContext)[variableId] ?? null;
}

/**
 * Whether removing a variable is available right now.
 *
 * ⚠ **False for the length of a live session**, and the reason is not the freeze: `editor/variables.json`
 * is writable throughout one. Removing a variable also clears the params of every blueprint node that
 * named it, and the blueprint document is not one a session carries - so the act cannot travel whole
 * and `VariableRegistryService` refuses it. This is the panel saying so before the author presses
 * anything, which is the same bargain the freeze guard makes.
 */
export function useVariableRemovalAvailable(): boolean {
    return !useContext(VariableSessionContext);
}

/**
 * Everybody else's claims on the registry, by entry.
 *
 * **This window's own are left out**, for the story row's reason: a mark on the row its author has
 * open is the one place it could be read as being about them, and it would arrive and go as they
 * moved between rows.
 *
 * ⚠ **Filtered by prefix.** The claim set holds rows, character records, translations, assets and
 * registry entries at once, keyed by a prefix; reading every key as an entry id would put a
 * translator's name on a variable.
 */
export function othersVariableClaims(view: LiveSessionView): VariableClaims {
    const self = selfAccount(view);
    const prefix = variableClaimKey("");
    const held: Record<string, string> = {};
    for (const [key, account] of Object.entries(view.claims)) {
        if (key.startsWith(prefix) && account !== self) {
            held[key.slice(prefix.length)] = account;
        }
    }
    return held;
}

function selfAccount(view: LiveSessionView): string | null {
    return view.session?.members.find(member => member.instance === view.self)?.account ?? null;
}

/* ------------------------------------------------------------------------- what it draws */

/**
 * The mark on an entry somebody else is editing.
 *
 * The same monogram the member wears in the title bar, in the collaboration panel, on a story row, on
 * a character and on a translation - `nameInitials` and `nameMonogramColor` derive both halves from
 * the account name - so it says *a person* rather than *an action*, and says which person.
 */
export function VariableClaimMark({ account }: { account: string }) {
    const { t } = useTranslation();
    return (
        <span
            data-variable-claim={account}
            data-tip={t("storyVars.live.entryClaimed", { name: account })}
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-2xs font-medium leading-none text-white"
            style={{ backgroundColor: nameMonogramColor(account) }}
        >
            {nameInitials(account).slice(0, 1)}
        </span>
    );
}
