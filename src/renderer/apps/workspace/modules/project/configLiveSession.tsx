import { useEffect, useMemo, useState } from "react";
import { CLAIM_REASSERT_MS } from "@/lib/live";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { appTagsSpec, brandSpec, dlcSpec } from "@shared/documents/specs";
import {
    appTagClaimKey,
    brandColorClaimKey,
    dlcClaimKey,
    type LiveClaimKey,
} from "@shared/live/ops";
import { useWorkspace } from "../../context";

/**
 * The project's three configuration tables, as a live session shows them: which rows somebody else
 * is inside.
 *
 * `characterLiveSession` one document along, three times over - and one file rather than three,
 * because the three differ in nothing but their key space. A build variant, a DLC and a colour of
 * the palette are all a row of a small table edited through a field that commits on blur, so the
 * claim, the mark and the freeze scope are one design with three addresses.
 *
 * **Nothing on these panels is switched off by a session.** Every gesture the three tables have is
 * an operation; what a session changes is that a row somebody else is inside is read-only while they
 * are in it, which is what the mark says.
 */

/* -------------------------------------------------------------------------- which document */

/**
 * Which file each table's editors write, as the project-relative path the freeze policy takes.
 *
 * Through the document specs rather than spelled out here, for `characterDocumentFreezeScope`'s
 * reason: a path written a second time is a path that falls behind the one the owning service
 * actually saves to, and these are compared against the set a live session declares writable. If the
 * two ever disagree, the panel offers an edit the write boundary refuses.
 */
export function appTagsDocumentFreezeScope(): string {
    return appTagsSpec.pathFor();
}

export function dlcDocumentFreezeScope(): string {
    return dlcSpec.pathFor();
}

export function brandDocumentFreezeScope(): string {
    return brandSpec.pathFor();
}

/* ------------------------------------------------------------------------------ one table */

/**
 * What one configuration table needs to take part in a session: its key space, and its door.
 *
 * A value rather than three copies of the hooks below. The door is a method on the session service
 * rather than a key handed to a generic one, because a claim is taken and given back by name - see
 * `LiveSession.claimAppTag` - and a single `claim(key)` door would let any surface assert any key.
 */
export type ConfigClaimKind = {
    keyOf(id: string): LiveClaimKey;
    hold(service: LiveSessionService, id: string, holding: boolean): void;
};

export const APP_TAG_CLAIMS: ConfigClaimKind = {
    keyOf: appTagClaimKey,
    hold: (service, id, holding) => service.claimAppTag(id, holding),
};

export const DLC_CLAIMS: ConfigClaimKind = {
    keyOf: dlcClaimKey,
    hold: (service, id, holding) => service.claimDlc(id, holding),
};

export const BRAND_COLOR_CLAIMS: ConfigClaimKind = {
    keyOf: brandColorClaimKey,
    hold: (service, id, holding) => service.claimBrandColor(id, holding),
};

/* ---------------------------------------------------------------------------- holding one */

/**
 * Hold the row somebody is inside, keep saying so, and give it back when they leave it.
 *
 * ⚠ **Held while the field is open in front of somebody, not while their fingers are moving**, which
 * is the rule the story editor arrived at the expensive way: an assertion that rode on keystrokes
 * left an author who stopped to think named on a row they no longer held, and somebody else was
 * shown "alice is writing this" over a line they were free to delete.
 *
 * The span here is a focused field rather than an open panel, which is the translations' answer
 * rather than the cast's, and the difference is what a row of these tables is. A character record is
 * a panel full of fields that stay drafted for as long as it is open; a variant, a DLC and a colour
 * are one or two blur-committed boxes, so the moment there is something unsaved to lose is exactly
 * the moment one of them has the caret - and after a blur there is no draft left to take.
 *
 * Silent outside a session, so a panel calls it without asking whether there is one.
 */
export function useConfigClaimHold(kind: ConfigClaimKind, id: string | null): void {
    const service = useLiveSessionService();

    useEffect(() => {
        if (!service || id === null) {
            return;
        }
        kind.hold(service, id, true);
        // An interval rather than a message per keystroke: see `CLAIM_REASSERT_MS`.
        const timer = setInterval(() => kind.hold(service, id, true), CLAIM_REASSERT_MS);
        return () => {
            clearInterval(timer);
            kind.hold(service, id, false);
        };
    }, [kind, service, id]);
}

/* --------------------------------------------------------------------------- reading them */

/**
 * Who else is inside one row, or null when nobody is.
 *
 * One subscription per row, where the cast's list takes one for all of them. These tables are tens
 * of rows at most - a project has a handful of variants and a couple of dozen colours - so the
 * provider that exists to stop hundreds of list items subscribing individually would be machinery
 * for a problem they do not have.
 */
export function useConfigClaim(kind: ConfigClaimKind, id: string | null): string | null {
    const service = useLiveSessionService();
    const [heldBy, setHeldBy] = useState<string | null>(null);

    useEffect(() => {
        if (!service || id === null) {
            setHeldBy(null);
            return;
        }
        const read = () => setHeldBy(configClaimHolder(service.getView(), kind, id));
        // On the way in as well as on every change: a panel opened during a session has missed the
        // message that carried the claims standing at that moment.
        read();
        return service.onChanged(read);
    }, [kind, service, id]);

    return heldBy;
}

/**
 * Who else holds ONE row, read without React.
 *
 * ⚠ **This window's own claims are left out**, for the story's reason: a mark on the row its author
 * is inside is the one place it could be read as being about them, and it would arrive and go as
 * they moved between fields. A second machine signed in to the same account is therefore unmarked,
 * which is the cost of comparing accounts - a claim carries no other name a person would recognise.
 *
 * The claim set holds every kind of row at once, keyed by a prefix, so a table reads only its own
 * keys back out. `kind.keyOf` is what builds the key here, rather than the id being compared
 * against the set directly: two tables' bare ids meeting in one map would be a confusion nothing
 * could detect.
 */
export function configClaimHolder(
    view: LiveSessionView,
    kind: ConfigClaimKind,
    id: string,
): string | null {
    const account = view.claims[kind.keyOf(id)];
    return account === undefined || account === selfAccount(view) ? null : account;
}

function selfAccount(view: LiveSessionView): string | null {
    return view.session?.members.find(member => member.instance === view.self)?.account ?? null;
}

function useLiveSessionService(): LiveSessionService | null {
    const { context, isInitialized } = useWorkspace();
    return useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
}

/* -------------------------------------------------------------------------- what it draws */

/**
 * The mark on a row somebody else is inside.
 *
 * The same monogram the member wears in the title bar, in the collaboration panel, on a story row
 * and on a character - `nameInitials` and `nameMonogramColor` derive both halves from the account
 * name - so it says *a person* rather than *an action*, and says which person. A glyph here read as
 * one more button on the row the pointer was over, which is the mistake the story row already made
 * once.
 */
export function ConfigClaimMark({ account }: { account: string }) {
    const { t } = useTranslation();
    return (
        <span
            data-config-claim={account}
            data-tip={t("project.live.entryClaimed", { name: account })}
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-2xs font-medium leading-none text-white"
            style={{ backgroundColor: nameMonogramColor(account) }}
        >
            {nameInitials(account).slice(0, 1)}
        </span>
    );
}
