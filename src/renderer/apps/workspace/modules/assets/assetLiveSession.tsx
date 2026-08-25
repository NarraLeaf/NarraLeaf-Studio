import { useEffect, useMemo, useState } from "react";
import { CLAIM_REASSERT_MS } from "@/lib/live";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { assetsMetadataSpec } from "@shared/documents/specs";
import { assetClaimKey } from "@shared/live/ops";
import { useWorkspace } from "../../context";

/**
 * The asset library, as a live session shows it: which records somebody else is inside.
 *
 * `characterLiveSession` and `localizationLiveSession` one document along, and deliberately their
 * counterpart method for method - a third design for the same idea would be a third thing to keep
 * correct. What differs is what a claim is over: one asset record, keyed by its id alone, because an
 * id is minted once and is unique across the whole library.
 *
 * ⚠ **There is no counterpart for filing an asset in a folder**, and that is a ruling rather than an
 * omission. Filing rearranges the library without touching a word anybody wrote, so the loser of that
 * race loses a drag. See `CLAIMED_OPS`.
 */

/* --------------------------------------------------------------------------- freeze scopes */

/**
 * Which files the asset library writes, as the project-relative paths the freeze policy takes.
 *
 * **Every shard rather than the one a panel is looking at**, and that is honest rather than lazy: a
 * session carries the whole library or none of it (`LiveAssetsPort.shardTypes`), so "may I edit an
 * asset record" has one answer for all eight. A guard scoped to a single type would ask a narrower
 * question than the surface actually poses - the panel's rename shortcut acts on a selection, which
 * may be of any type.
 *
 * Through the document spec rather than spelled out here, for the reason `writeFreeze` gives: a path
 * written a second time is a path that falls behind the one `AssetsService` actually saves to, and
 * this one is compared against the set a live session declares writable.
 *
 * ⚠ **This is the metadata, never the bytes.** Importing, replacing and deleting write
 * `assets/content/`, which no session leaves writable - so those controls keep the unscoped guard and
 * stay greyed, which is what says out loud that a session shares what the project says about a file
 * and not the file.
 */
export function assetLibraryFreezeScope(): readonly string[] {
    return Object.values(AssetType).map(type => assetsMetadataSpec.pathFor({ type }));
}

/*
 * ⚠ **There is no scope for the asset folders, and that absence is the invariant working.**
 * `assets/assets.groups.<category>.json` has no verb, so creating, renaming and moving a folder stays
 * frozen for the length of a session - which is what an unscoped `useFreezeGuard()` already answers.
 * Naming a scope for it would only be a way to ask a question whose answer is always the same one.
 */

/* ---------------------------------------------------------------------------- holding one */

/** The one thing a hold needs of a live session. See `LiveSession.claimAsset`. */
export type AssetClaimPort = {
    claimAsset(assetId: string, holding: boolean): void;
};

/**
 * Hold the record this inspector has open, keep saying so, and give it back when it closes.
 *
 * ⚠ **Asserted for as long as the record is open, not for as long as its author is typing.** The
 * inspector's name and description are `TextField`s: they keep a draft in their own state until the
 * field is blurred, and their sync-from-props overwrites that draft the moment somebody else's edit
 * to the same record arrives. A claim that lapsed on a pause would let exactly that happen. This is
 * the rule the story editor arrived at the expensive way and the character panel inherited.
 *
 * Silent outside a session, so the inspector calls it without asking whether there is one.
 */
export function useAssetClaimHold(input: {
    /** Null before the workspace is up, which is a window that cannot be in a session either. */
    service: AssetClaimPort | null;
    /** The record open for editing, or null when none is. */
    assetId: string | null;
}): void {
    const { service, assetId } = input;

    useEffect(() => {
        if (!service || assetId === null) {
            return;
        }
        service.claimAsset(assetId, true);
        // An interval rather than a message per keystroke: see `CLAIM_REASSERT_MS`.
        const timer = setInterval(() => service.claimAsset(assetId, true), CLAIM_REASSERT_MS);
        return () => {
            clearInterval(timer);
            service.claimAsset(assetId, false);
        };
    }, [service, assetId]);
}

/* --------------------------------------------------------------------------- reading them */

/** Asset id to the account editing it, for every record somebody else holds. */
export type AssetClaims = Readonly<Record<string, string>>;

export const NO_ASSET_CLAIMS: AssetClaims = {};

/**
 * The claims on the asset library, kept as one value that only changes when it would read
 * differently.
 *
 * **One subscription for the whole panel**, for the reason the cast's provider gives: the session
 * publishes on every operation anybody in the room applies, and a browser row that read the service
 * itself would re-render on every remote keystroke. It rides in `AssetsPanelContext`, which every row
 * already reads, rather than in a context of its own - the panel's tree is deep and one more provider
 * around it would be a second thing to remember to wrap a view in.
 *
 * Empty outside a session, so the panel calls it without asking whether there is one.
 */
export function useAssetClaims(): AssetClaims {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
    const [claims, setClaims] = useState<AssetClaims>(NO_ASSET_CLAIMS);

    useEffect(() => {
        if (!service) {
            setClaims(NO_ASSET_CLAIMS);
            return;
        }
        const read = () => setClaims(previous => {
            const next = othersAssetClaims(service.getView());
            return signatureOf(next) === signatureOf(previous) ? previous : next;
        });
        // On the way in as well as on every change: a panel opened during a session has missed the
        // message that carried the claims standing at that moment.
        read();
        return service.onChanged(read);
    }, [service]);

    return claims;
}

function signatureOf(claims: AssetClaims): string {
    return Object.entries(claims)
        .map(([assetId, account]) => `${assetId}=${account}`)
        .sort()
        .join("\n");
}

/**
 * Everybody else's claims on the asset library, by record.
 *
 * **This window's own are left out**, for the story row's reason: a mark on the record its author has
 * open is the one place it could be read as being about them. A second machine signed in to the same
 * account is therefore unmarked, which is the cost of comparing accounts - a claim carries no other
 * name a person would recognise.
 *
 * ⚠ **Filtered by prefix.** The claim set holds rows, character records, translations in every
 * language and asset records at once; a reader that took every key would put a translator's name on a
 * picture.
 */
export function othersAssetClaims(view: LiveSessionView): AssetClaims {
    const self = selfAccount(view);
    const prefix = assetClaimKey("");
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
 * The mark a record wears while somebody else is editing it.
 *
 * The same monogram the member wears in the title bar, in the collaboration panel, on a story row, on
 * a character and on a translation - `nameInitials` and `nameMonogramColor` derive both halves from
 * the account name - so it says *a person* rather than *an action*, and says which person.
 */
export function AssetClaimMark({ account }: { account: string }) {
    const { t } = useTranslation();
    return (
        <span
            data-asset-claim={account}
            data-tip={t("assets.live.recordClaimed", { name: account })}
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-2xs font-medium leading-none text-white"
            style={{ backgroundColor: nameMonogramColor(account) }}
        >
            {nameInitials(account).slice(0, 1)}
        </span>
    );
}
