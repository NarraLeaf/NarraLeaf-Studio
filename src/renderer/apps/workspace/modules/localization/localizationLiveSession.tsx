import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CLAIM_REASSERT_MS } from "@/lib/live";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { localizationDocumentSpec, localizationKeysSpec, voiceDocumentSpec } from "@shared/documents/specs";
import { translationClaimKey } from "@shared/live/ops";
import { useWorkspace } from "../../context";

/**
 * The translation table, as a live session shows it: which lines somebody else is inside.
 *
 * `characterLiveSession` one document along, and deliberately its counterpart method for method - a
 * second design for the same idea would be a second thing to keep correct. What differs is what a
 * claim is over: one entry of one language, because the same line has an entry in every language and
 * two translators working in two of them are not in each other's way.
 *
 * ⚠ **There is no counterpart for the voice table**, and that is a ruling rather than an omission. A
 * take is dropped on a row and approved with a button; the one drafted thing on it is a director's
 * short note, whose loser can read the winner's in the box. See `CLAIMED_OPS`.
 */

/* --------------------------------------------------------------------------- freeze scopes */

/**
 * Which file one language's translation table writes, as the project-relative path the freeze policy
 * takes.
 *
 * Through the document spec rather than spelled out here, for the reason `writeFreeze` gives: a path
 * written a second time is a path that falls behind the one `LocalizationService` actually saves to,
 * and this one is compared against the set a live session declares writable. If the two ever
 * disagree, the table offers an edit the write boundary refuses.
 */
export function translationDocumentFreezeScope(locale: string): string {
    return localizationDocumentSpec.pathFor({ locale });
}

/** Which file one language's voice table writes. The translations' mirror. */
export function voiceDocumentFreezeScope(locale: string): string {
    return voiceDocumentSpec.pathFor({ locale });
}

/**
 * Which file the named-key registry writes.
 *
 * ⚠ **Deliberately NOT a document a session carries.** Declaring a UI string has no verb, so it stays
 * frozen for the length of a session and says so - which is the invariant working rather than a gap:
 * a document is writable during a session exactly when the session can carry its changes. Naming the
 * scope here is what keeps the key controls greyed while the translations beside them stay live.
 */
export function localizationKeysFreezeScope(): string {
    return localizationKeysSpec.pathFor();
}

/* ---------------------------------------------------------------------------- holding one */

/** The one thing a hold needs of a live session. See `LiveSession.claimTranslation`. */
export type TranslationClaimPort = {
    claimTranslation(locale: string, unitId: string, holding: boolean): void;
};

/**
 * Hold the line this table has open, keep saying so, and give it back when the field closes.
 *
 * ⚠ **Asserted for as long as the field is open, not for as long as its author is typing.** The
 * translation field IS the working copy - a contentEditable the browser edits, reaching the document
 * on Enter or blur - so a claim that lapsed on a translator's pause would let somebody else write
 * over a line they were halfway through. This is the rule the story editor arrived at the expensive
 * way and the character panel inherited.
 *
 * Silent outside a session, so the table calls it without asking whether there is one.
 */
export function useTranslationClaimHold(input: {
    /** Null before the workspace is up, which is a window that cannot be in a session either. */
    service: TranslationClaimPort | null;
    locale: string;
    /** The line open for editing, or null when none is. */
    unitId: string | null;
}): void {
    const { service, locale, unitId } = input;

    useEffect(() => {
        if (!service || unitId === null) {
            return;
        }
        service.claimTranslation(locale, unitId, true);
        // An interval rather than a message per keystroke: see `CLAIM_REASSERT_MS`.
        const timer = setInterval(() => service.claimTranslation(locale, unitId, true), CLAIM_REASSERT_MS);
        return () => {
            clearInterval(timer);
            service.claimTranslation(locale, unitId, false);
        };
    }, [service, locale, unitId]);
}

/* --------------------------------------------------------------------------- reading them */

/** Unit id to the account translating it, for every line somebody else holds in THIS language. */
export type TranslationClaims = Readonly<Record<string, string>>;

const NO_CLAIMS: TranslationClaims = {};

const TranslationClaimsContext = createContext<TranslationClaims>(NO_CLAIMS);

/**
 * The claims on one language, kept as one value that only changes when it would read differently.
 *
 * One subscription rather than one per row, for the reason the cast's provider gives: the session
 * publishes on every operation anybody in the room applies, and a table row that read the service
 * itself would re-render on every remote keystroke.
 */
export function TranslationClaimsProvider({ locale, children }: { locale: string; children: React.ReactNode }) {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
    const [claims, setClaims] = useState<TranslationClaims>(NO_CLAIMS);

    useEffect(() => {
        if (!service) {
            setClaims(NO_CLAIMS);
            return;
        }
        const read = () => setClaims(previous => {
            const next = othersTranslationClaims(service.getView(), locale);
            return signatureOf(next) === signatureOf(previous) ? previous : next;
        });
        // On the way in as well as on every change: a table opened during a session has missed the
        // message that carried the claims standing at that moment.
        read();
        return service.onChanged(read);
    }, [service, locale]);

    return <TranslationClaimsContext.Provider value={claims}>{children}</TranslationClaimsContext.Provider>;
}

function signatureOf(claims: TranslationClaims): string {
    return Object.entries(claims)
        .map(([unitId, account]) => `${unitId}=${account}`)
        .sort()
        .join("\n");
}

/** Who else is translating this line, or null when nobody is. */
export function useTranslationClaim(unitId: string): string | null {
    return useContext(TranslationClaimsContext)[unitId] ?? null;
}

/**
 * Everybody else's claims on one language, by line.
 *
 * **This window's own are left out**, for the story row's reason: a mark on the line its author has
 * open is the one place it could be read as being about them, and it would arrive and go as they
 * moved between rows. A second machine signed in to the same account is therefore unmarked, which is
 * the cost of comparing accounts - a claim carries no other name a person would recognise.
 *
 * ⚠ **Filtered by language.** The claim set holds rows, character records and translations in every
 * language at once, keyed by a prefix; a table that read every `translation:` key would put the
 * French translator's name on the Japanese line.
 */
export function othersTranslationClaims(view: LiveSessionView, locale: string): TranslationClaims {
    const self = selfAccount(view);
    const prefix = translationClaimKey(locale, "");
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
 * The mark on a line somebody else is translating.
 *
 * The same monogram the member wears in the title bar, in the collaboration panel, on a story row and
 * on a character - `nameInitials` and `nameMonogramColor` derive both halves from the account name -
 * so it says *a person* rather than *an action*, and says which person.
 */
export function TranslationClaimMark({ account }: { account: string }) {
    const { t } = useTranslation();
    return (
        <span
            data-translation-claim={account}
            data-tip={t("workspace.localization.live.entryClaimed", { name: account })}
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-2xs font-medium leading-none text-white"
            style={{ backgroundColor: nameMonogramColor(account) }}
        >
            {nameInitials(account).slice(0, 1)}
        </span>
    );
}
