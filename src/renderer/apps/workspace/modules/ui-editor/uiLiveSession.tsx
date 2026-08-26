import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CLAIM_REASSERT_MS } from "@/lib/live";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { uiDocumentSpec, uiGraphsSpec } from "@shared/documents/specs";
import { uiElementClaimKey, UI_ELEMENT_CLAIM_PREFIX } from "@shared/live/ops";
import { useWorkspace } from "../../context";

/**
 * The interface, as a live session shows it: which elements somebody else is inside.
 *
 * `characterLiveSession` one document along, and deliberately the same file: a second design for the
 * same idea would be a second thing to keep correct. What differs is only what a claim is over - an
 * element of a Surface or of a component definition, rather than a character record.
 */

/**
 * Which files the interface editor writes, as the project-relative paths the freeze policy takes.
 *
 * **Both, always, for every surface of the interface editor and of the blueprint canvas.** They are
 * one editing surface written to two files: adding a widget writes `uidoc.json` and then reconciles
 * a private blueprint for it in `uigraphs.json`, in the same synchronous step, so a control scoped to
 * one of them would offer an edit whose other half the boundary refuses. `isFreezeBlocking` requires
 * every path in a list to be allowed, which is exactly the question being asked.
 *
 * Through the document specs rather than spelled out here, for the reason `writeFreeze` gives: a path
 * written a second time is one that falls behind the file the service actually saves to, and this one
 * is compared against the set a live session declares writable.
 */
export function interfaceDocumentFreezeScope(): readonly string[] {
    return [uiDocumentSpec.pathFor(), uiGraphsSpec.pathFor()];
}

/* ------------------------------------------------------------------------------- undoing */

/**
 * Who owns Ctrl+Z in the interface editor and on the blueprint canvas right now.
 *
 * **Null outside a session, and inside one it is the session.** Both editors keep snapshot stacks -
 * a whole Surface, a whole blueprint - of a document only this author ever had, so applying one
 * inside a shared session would put the screen back the way it was before anybody else joined and
 * delete everything they have written since, with nothing on either machine reporting it. That is
 * the catastrophe the session's own undo exists to avoid: it sends the inverse of this window's own
 * last operation and nothing else.
 *
 * ⚠ **A session keeps one stack per WINDOW rather than one per editor** - "my last operation",
 * whatever panel it was made in - so this answers the same thing wherever it is asked, exactly as
 * the shell's binding and the story editor's do.
 */
export function useLiveUndoOverride(): { undo(): void; redo(): void } | null {
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

    return useMemo(
        () => (service && inSession ? { undo: () => void service.undo(), redo: () => void service.redo() } : null),
        [service, inSession],
    );
}

/* ---------------------------------------------------------------------------- holding one */

/** The one thing a hold needs of a live session. See `LiveSession.claimUIElement`. */
export type UIElementClaimPort = {
    claimUIElement(componentId: string | null, elementId: string, holding: boolean): void;
};

/**
 * Hold the element this window has selected, keep saying so, and give it back when it changes.
 *
 * ⚠ **Asserted for as long as the element is selected, not for as long as its author is typing.**
 * That is the rule the story editor arrived at the expensive way, and the properties panel is the
 * shape it is about: its text fields keep a draft in their own state and reach the document on a
 * throttle or on blur, so what a claim means here is "somebody has this element open in front of
 * them", and being selected is what says so.
 *
 * Silent outside a session, so the editor calls it without asking whether there is one.
 */
export function useUIElementClaimHold(input: {
    /** Null before the workspace is up, which is a window that cannot be in a session either. */
    service: UIElementClaimPort | null;
    /** The component whose own element map this element is in, or null for a Surface's. */
    componentId: string | null;
    /** The element open for editing, or null when none is. */
    elementId: string | null;
}): void {
    const { service, componentId, elementId } = input;

    useEffect(() => {
        if (!service || elementId === null) {
            return;
        }
        service.claimUIElement(componentId, elementId, true);
        // An interval rather than a message per keystroke: see `CLAIM_REASSERT_MS`.
        const timer = setInterval(() => service.claimUIElement(componentId, elementId, true), CLAIM_REASSERT_MS);
        return () => {
            clearInterval(timer);
            service.claimUIElement(componentId, elementId, false);
        };
    }, [service, componentId, elementId]);
}

/* --------------------------------------------------------------------------- reading them */

/**
 * Element key to the account editing it, for every element somebody else holds.
 *
 * Keyed by the claim key rather than by the element id, because an element of a component definition
 * and an element of a Surface are two address spaces: the key is what tells them apart, and reading
 * one back out as the other would draw a stranger's mark on the wrong screen.
 */
export type UIElementClaims = Readonly<Record<string, string>>;

const NO_CLAIMS: UIElementClaims = {};

const UIElementClaimsContext = createContext<UIElementClaims>(NO_CLAIMS);

/**
 * The claims on the interface, kept as one value that only changes when it would read differently.
 *
 * One subscription rather than one per element, for the reason the cast's provider gives: the session
 * publishes on every operation anybody in the room applies, and an element that read the service
 * itself would re-render on every remote nudge of every other element.
 */
export function UIElementClaimsProvider({ children }: { children: React.ReactNode }) {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
    const [claims, setClaims] = useState<UIElementClaims>(NO_CLAIMS);

    useEffect(() => {
        if (!service) {
            setClaims(NO_CLAIMS);
            return;
        }
        const read = () => setClaims(previous => {
            const next = othersUIElementClaims(service.getView());
            return signatureOf(next) === signatureOf(previous) ? previous : next;
        });
        // On the way in as well as on every change: an editor opened during a session has missed the
        // message that carried the claims standing at that moment.
        read();
        return service.onChanged(read);
    }, [service]);

    return <UIElementClaimsContext.Provider value={claims}>{children}</UIElementClaimsContext.Provider>;
}

function signatureOf(claims: UIElementClaims): string {
    return Object.entries(claims)
        .map(([key, account]) => `${key}=${account}`)
        .sort()
        .join("\n");
}

/** Who else is inside this element, or null when nobody is. */
export function useUIElementClaim(componentId: string | null, elementId: string): string | null {
    return useContext(UIElementClaimsContext)[uiElementClaimKey(componentId, elementId)] ?? null;
}

/**
 * Everybody else's claims on the interface, by claim key.
 *
 * **This window's own are left out**, for the cast's reason: a mark on the element its author has
 * selected is the one place it could be read as being about them, and it would arrive and go as they
 * moved between elements.
 *
 * ⚠ The claim set holds rows, records, translations, assets, elements and nodes at once, keyed by a
 * prefix, so this reads only its own keys back out. Two documents' bare uuids meeting in one map
 * would be a confusion nothing could detect - and the story editor shipped that mistake once, with
 * every assertion in its tests agreeing with it.
 */
export function othersUIElementClaims(view: LiveSessionView): UIElementClaims {
    const self = selfAccount(view);
    const held: Record<string, string> = {};
    for (const [key, account] of Object.entries(view.claims)) {
        if (key.startsWith(UI_ELEMENT_CLAIM_PREFIX) && account !== self) {
            held[key] = account;
        }
    }
    return held;
}

/**
 * Who else holds ONE element, subscribed to directly.
 *
 * For a surface that is not inside {@link UIElementClaimsProvider} - the properties panel, which
 * shows one element at a time and is mounted somewhere else entirely.
 */
export function useUIElementClaimOf(componentId: string | null, elementId: string | null): string | null {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
    const [heldBy, setHeldBy] = useState<string | null>(null);

    useEffect(() => {
        if (!service || elementId === null) {
            setHeldBy(null);
            return;
        }
        const read = () => setHeldBy(uiElementClaimHolder(service.getView(), componentId, elementId));
        read();
        return service.onChanged(read);
    }, [service, componentId, elementId]);

    return heldBy;
}

/** Who else holds ONE element, read without React, for a caller outside the provider. */
export function uiElementClaimHolder(
    view: LiveSessionView,
    componentId: string | null,
    elementId: string,
): string | null {
    const account = view.claims[uiElementClaimKey(componentId, elementId)];
    return account === undefined || account === selfAccount(view) ? null : account;
}

function selfAccount(view: LiveSessionView): string | null {
    return view.session?.members.find(member => member.instance === view.self)?.account ?? null;
}

/* ------------------------------------------------------------------------- what it draws */

/**
 * The mark on an element somebody else is editing.
 *
 * The same monogram the member wears in the title bar, in the collaboration panel, on a story row and
 * on a character - `nameInitials` and `nameMonogramColor` derive both halves from the account name -
 * so it says *a person* rather than *an action*, and says which person.
 */
export function UIElementClaimMark({ account }: { account: string }) {
    const { t } = useTranslation();
    return (
        <span
            data-ui-element-claim={account}
            data-tip={t("uiEditor.live.elementClaimed", { name: account })}
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-2xs font-medium leading-none text-white"
            style={{ backgroundColor: nameMonogramColor(account) }}
        >
            {nameInitials(account).slice(0, 1)}
        </span>
    );
}
