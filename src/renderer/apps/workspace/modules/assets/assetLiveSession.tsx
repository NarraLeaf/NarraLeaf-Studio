import { useEffect, useMemo, useState } from "react";
import { CLAIM_REASSERT_MS } from "@/lib/live";
import { nameInitials, nameMonogramColor } from "@/lib/components/monogram";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { AssetsService, AssetTransfer } from "@/lib/workspace/services/core/AssetsService";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import type { LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { ASSET_CATEGORY_ORDER, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { assetGroupsSpec, assetSetsSpec, assetsMetadataSpec } from "@shared/documents/specs";
import { ASSET_PAYLOAD_ROOT } from "@shared/live/sharedDocuments";
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
 * Everything the asset library writes, as the project-relative paths the freeze policy takes.
 *
 * **All of it rather than the part a panel is looking at**, and that is honest rather than lazy: a
 * session carries the library whole or not at all, so "may I change the library" has one answer. A
 * guard scoped to a single type would ask a narrower question than the surface actually poses - the
 * panel's rename shortcut acts on a selection, which may be of any type, and a drop can import,
 * re-file a row and move a folder depending on what was dragged.
 *
 * Three kinds of path, and the third is the one worth naming:
 *
 *  - the **metadata shards**, one per asset type;
 *  - the **folder shards**, one per section, which are a different axis - a folder under Media holds
 *    audio and video alike;
 *  - the **payloads**, `assets/content`, which is where a file's bytes are. `freezeAllowsWrite` takes
 *    an entry as standing for everything under it, so this one directory covers every file.
 *
 * The first two come from their document specs rather than being spelled here, for the reason
 * `writeFreeze` gives: a path written a second time is a path that falls behind the one the service
 * actually saves to, and this one is compared against the set a session declares writable. The third
 * has no spec because a payload is not a document anything parses - it is shared with
 * `@shared/live/sharedDocuments`, which is what the session builds its writable set from.
 */
export function assetLibraryFreezeScope(): readonly string[] {
    return [
        ...Object.values(AssetType).map(type => assetsMetadataSpec.pathFor({ type })),
        ...ASSET_CATEGORY_ORDER.map(category => assetGroupsSpec.pathFor({ category })),
        ASSET_PAYLOAD_ROOT,
    ];
}

/**
 * Which file the asset set editors write, as the project-relative path the freeze policy takes.
 *
 * Its own scope beside {@link assetLibraryFreezeScope} because it is its own document: a set holds
 * no files, and everything about which files belong to one is read off the library's tags at the
 * moment it is resolved.
 */
export function assetSetDocumentFreezeScope(): string {
    return assetSetsSpec.pathFor();
}

/**
 * What a gesture on a set row has to be allowed to write: the declaration AND the library.
 *
 * Both, because the panel's set gestures reach both documents and a guard that asked about one
 * would answer for a control that writes the other. Making a set writes the tags that make its
 * members members; deleting one offers to delete their files; filing one moves the rows drawn
 * inside it. Only renaming stays inside the declaration, and there is no freeze in this build that
 * allows one of the two and not the other - a session carries them together, and everything else
 * freezes the project whole.
 */
export function assetSetFreezeScope(): readonly string[] {
    return [assetSetDocumentFreezeScope(), ...assetLibraryFreezeScope()];
}

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

/* ------------------------------------------------------------------- what is arriving */

/** How far one file has got, by asset id. Between 0 and 1. */
export type AssetTransfers = Readonly<Record<string, number>>;

export const NO_ASSET_TRANSFERS: AssetTransfers = {};

/**
 * The files on their way into this library, and how far each has got.
 *
 * **The same on both machines and for the same reason the mark above is**: the room relays a message
 * back to whoever said it, so a file being carried in is a file arriving everywhere in the room -
 * including on the screen of the author who dragged it in. Neither side is watching an estimate.
 *
 * One subscription for the whole panel, like the claims: the service reports progress in steps
 * rather than per slice, and a row that subscribed for itself would still be one subscription per
 * row of a library that has hundreds.
 */
export function useAssetTransfers(): AssetTransfers {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null),
        [context, isInitialized],
    );
    const [transfers, setTransfers] = useState<AssetTransfers>(NO_ASSET_TRANSFERS);

    useEffect(() => {
        if (!service) {
            setTransfers(NO_ASSET_TRANSFERS);
            return;
        }
        const read = (arriving: readonly AssetTransfer[]) => setTransfers(
            arriving.length === 0 ? NO_ASSET_TRANSFERS : shareOf(arriving),
        );
        // On the way in as well: a panel opened while a file is arriving has missed the step that
        // said it started.
        read(service.transfers());
        return service.getEvents().on("transfers", read);
    }, [service]);

    return transfers;
}

/** What a bar is drawn from. A file with no slices in it yet is one whole slice, never a division by zero. */
function shareOf(arriving: readonly AssetTransfer[]): AssetTransfers {
    const out: Record<string, number> = {};
    for (const transfer of arriving) {
        out[transfer.assetId] = transfer.total <= 0
            ? 0
            : Math.min(1, transfer.slices / transfer.total);
    }
    return out;
}

/* ------------------------------------------------------------------------- what it draws */

/**
 * The mark a record wears while somebody else is editing it.
 *
 * The same monogram the member wears in the title bar, in the collaboration panel, on a story row, on
 * a character and on a translation - `nameInitials` and `nameMonogramColor` derive both halves from
 * the account name - so it says *a person* rather than *an action*, and says which person.
 */
/**
 * What a row wears while its file is still arriving.
 *
 * **A band across the row rather than a bar beside it.** The row is where the file will be - its
 * name, its type, the folder it was dropped into - so filling that row says which file is coming and
 * how far it has got in one place, without a second list of transfers to read alongside the library.
 *
 * Drawn behind the row's own text: the caller gives the row `relative isolate` and this sits under
 * it, so a name stays legible over the band at any width.
 */
export function AssetTransferSweep({ share, className }: { share: number; className?: string }) {
    return (
        <span
            aria-hidden
            data-asset-transfer={Math.round(share * 100)}
            className={cn(
                "pointer-events-none absolute inset-y-0 left-0 -z-10 bg-primary/20 transition-[width] duration-200",
                className,
            )}
            style={{ width: `${Math.round(share * 100)}%` }}
        />
    );
}

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
