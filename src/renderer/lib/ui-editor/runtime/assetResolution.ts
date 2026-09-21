/**
 * A picture a widget asked for and did not get, on its way to someone who can do something about it.
 *
 * ## Why this exists
 *
 * A widget reaches its bytes through `useAssetObjectUrl`, and when that fails the hook keeps the
 * reason in its own state and hands back an empty URL. The widget draws no `<img>`, and that was the
 * whole of it: nothing in the console, nothing in Dev Mode's issue list. "Bound to the wrong thing",
 * "the asset was deleted" and "the value is not an asset at all" all arrived at the author as the
 * same blank rectangle.
 *
 * So a widget in a running game says what happened to each asset slot it draws (see
 * `useAssetResolutionReport`), the host it runs in decides where that goes - the issue list in Dev
 * Mode, one line of the log in a packaged game - and this module holds what both hosts need to agree
 * on: what a report carries, how a failure is classified, and the sentence it becomes.
 *
 * ## Why the runtime reports facts and the host words them
 *
 * Telling "no longer in this project" from "could not be read" needs the project's asset table,
 * which only the host has (the Dev Mode bundle carries it; a packaged game deliberately does not).
 * The widget knows what it asked for and at which step it failed, and nothing beyond that - the same
 * split a story failure makes between the block id the runtime reports and the line number the host
 * locates.
 *
 * React-free, so the classification, the wording and the ledger can be tested against plain objects.
 */

import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { DEV_MODE_SAVE_PREVIEW_ASSET_ID_PREFIX } from "@shared/types/devModeSave";
import { isValidAssetStorageId } from "@shared/utils/assetStorageId";
import { CHARACTER_AVATAR_ASSET_ID_PREFIX } from "@shared/utils/characterAvatar";

/**
 * Which asset-bearing property of a widget this is about, named the way the inspector names it (see
 * {@link ASSET_SLOT_LABEL_KEYS}).
 */
export type AssetSlot = "imageFill" | "videoClip" | "videoPoster" | "surfaceBackground";

/** Where a slot is: the surface, the element on it, and which of that element's slots. */
export type AssetResolutionSite = {
    surfaceId: string;
    /** The element the slot belongs to; absent for a surface's own background, which has none. */
    elementId?: string;
    /**
     * What the author calls the owner of the slot: the element's name, or the surface's for a
     * background. Carried rather than looked up because the widget has it in hand, and an element
     * inside a component definition is not in the surface's own element table to be looked up in.
     */
    ownerName: string;
    slot: AssetSlot;
    /**
     * Tells repeated drawings of one element apart - a list row per item, all drawn from one
     * template element. Empty for an element drawn once.
     */
    instanceKey: string;
};

/**
 * Where one drawing of a slot stands.
 *
 * - `drawn`: the asset resolved and, where the widget can tell, loaded.
 * - `unused`: the slot asks for nothing - no asset chosen, a binding that answered nothing, or a
 *   fill type that does not draw a picture. Not a failure: an image with nothing chosen yet is where
 *   every new image starts, and a gallery cell that is locked shows no picture by design.
 * - `failed`: the slot asked for `requested` and did not get it. `resolve` is the lookup failing (no
 *   URL was ever produced); `load` is a URL the page could not load or decode.
 */
export type AssetResolutionOutcome =
    | { status: "drawn" }
    | { status: "unused" }
    | { status: "failed"; requested: string; stage: "resolve" | "load" };

/**
 * What a widget tells its host.
 *
 * `drawing` names one mounted instance of the reporting hook, so two drawings of the same slot - two
 * list rows, or a page and a layer showing the same surface - are counted apart. `released` is that
 * instance going away; a failure it reported outlives it (see {@link AssetResolutionLedger}).
 */
export type AssetResolutionReport =
    | {
          type: "outcome";
          drawing: string;
          site: AssetResolutionSite;
          outcome: AssetResolutionOutcome;
      }
    | { type: "released"; drawing: string };

export type AssetResolutionReporter = (report: AssetResolutionReport) => void;

/** A failure with where it happened, as the ledger holds it. */
export type AssetResolutionFailure = {
    site: AssetResolutionSite;
    requested: string;
    stage: "resolve" | "load";
};

/**
 * How a failure reads to the author.
 *
 * - `missing`: shaped like an asset reference, and the project has no such asset - deleted, or
 *   bound to an id from somewhere else.
 * - `unreadable`: the project has the asset (or the reference is to a file Studio derives, like a
 *   baked avatar), and its bytes could not be had or could not be decoded.
 * - `notAsset`: the value is not an asset reference at all - text, a number, or an object turned
 *   into a string on its way to a property that names a picture by id.
 */
export type AssetFailureKind = "missing" | "unreadable" | "notAsset";

/**
 * Whether a string is shaped like something an asset slot can name.
 *
 * Library assets are addressed by a generated UUID or a legacy content digest and nothing else (see
 * `isValidAssetStorageId`); two derived kinds - a baked dialog avatar and a Dev Mode save preview -
 * ride a prefixed id of their own. Anything else that reaches a slot cannot name an asset in any
 * project, which is what lets "not an asset" be told apart from "no longer here".
 */
export function isAssetReferenceShaped(value: string): boolean {
    return isValidAssetStorageId(value) || isDerivedAssetReference(value);
}

function isDerivedAssetReference(value: string): boolean {
    return value.startsWith(CHARACTER_AVATAR_ASSET_ID_PREFIX)
        || value.startsWith(DEV_MODE_SAVE_PREVIEW_ASSET_ID_PREFIX);
}

/**
 * Sort a failure into the three things an author can act on, and name the asset when the project
 * says what it is called.
 *
 * `assetNames` is the project's `assetId -> name` table, or undefined/empty where the host has none
 * (a packaged game ships without it). Without it nothing can be called `unreadable` by name, so a
 * failed load is still `unreadable` (a URL was produced, so the reference named something) and a
 * failed lookup of a well-formed id falls to `missing`.
 */
export function classifyAssetFailure(
    failure: Pick<AssetResolutionFailure, "requested" | "stage">,
    assetNames: Readonly<Record<string, string>> | undefined,
): { kind: AssetFailureKind; assetName: string | null } {
    const known = assetNames?.[failure.requested];
    if (known) {
        return { kind: "unreadable", assetName: known };
    }
    if (!isAssetReferenceShaped(failure.requested)) {
        return { kind: "notAsset", assetName: null };
    }
    if (failure.stage === "load" || isDerivedAssetReference(failure.requested)) {
        return { kind: "unreadable", assetName: null };
    }
    return { kind: "missing", assetName: null };
}

/**
 * The inspector's own label for each slot, so the sentence names the field the author will look for.
 */
export const ASSET_SLOT_LABEL_KEYS: Readonly<Record<AssetSlot, TranslationKey>> = {
    imageFill: "widgets.rectangleInspector.imageFill",
    videoClip: "widgets.video.asset",
    videoPoster: "widgets.video.poster",
    surfaceBackground: "properties.scene.backgroundImage",
};

type Translate = (key: TranslationKey, params?: InterpolationParams) => string;

/**
 * The sentence a failure becomes, in the language `t` speaks.
 *
 * Never contains the requested value. For `missing` that value is a UUID, and an id with no asset
 * behind it names nothing an author can find; for `notAsset` it is typically `[object Object]` or a
 * stray piece of text, which says less than the sentence does. The asset's NAME is used where the
 * project has one.
 */
export function describeAssetResolutionFailure(
    failure: AssetResolutionFailure,
    assetNames: Readonly<Record<string, string>> | undefined,
    t: Translate,
): string {
    const { kind, assetName } = classifyAssetFailure(failure, assetNames);
    const params = {
        element: failure.site.ownerName,
        property: t(ASSET_SLOT_LABEL_KEYS[failure.site.slot]),
    };
    switch (kind) {
        case "missing":
            return t("devMode.issues.assetMissing", params);
        case "notAsset":
            return t("devMode.issues.assetNotAsset", params);
        case "unreadable":
            return assetName
                ? t("devMode.issues.assetUnreadableNamed", { ...params, asset: assetName })
                : t("devMode.issues.assetUnreadable", params);
    }
}

/** One key per slot drawing position, the same for every mount of it. */
function siteKey(site: AssetResolutionSite): string {
    return `${site.surfaceId}\u0000${site.elementId ?? ""}\u0000${site.slot}\u0000${site.instanceKey}`;
}

/**
 * The failures that are true right now, however many drawings reported them.
 *
 * One entry per DRAWING, not per report: a widget reports when its outcome changes, never per render,
 * and a drawing that reports twice replaces its own entry. Turning the failing ones into issues - and
 * collapsing the twelve rows of one gallery that fail the same way into one - is the host's job,
 * because it is the host that knows what makes two sentences the same.
 *
 * Drawings that draw fine are held too, for as long as they are mounted. They are how a failure left
 * by an earlier drawing of the same place is known to be over: a page's enter and exit animations
 * overlap, so the new drawing of a picture routinely answers while the old one is still on its way
 * out, and a ledger of failures alone would then keep the old failure for good.
 *
 * ## A failure outlives the drawing that reported it
 *
 * When a drawing goes away its failure is kept, marked released. Leaving a page is not fixing it, and
 * a list that forgot on unmount would empty the moment the author navigated to read it - or flicker
 * for a dialogue box that is rebuilt line by line. A released failure ends in one of three ways:
 * another drawing of the same place is on screen when it is released, or reports later (the page was
 * revisited, and that drawing's answer is the current one), or the host starts over on a new bundle
 * (see {@link forgetReleased}).
 */
export class AssetResolutionLedger {
    private readonly drawings = new Map<string, {
        site: AssetResolutionSite;
        failure: AssetResolutionFailure | null;
        released: boolean;
    }>();

    /** Apply one report. Answers whether the set of failures changed. */
    public apply(report: AssetResolutionReport): boolean {
        if (report.type === "released") {
            const entry = this.drawings.get(report.drawing);
            if (!entry) {
                return false;
            }
            if (!entry.failure) {
                this.drawings.delete(report.drawing);
                return false;
            }
            // A failure is only kept for a place nothing else is drawing - see the note on the class.
            if (this.liveDrawingOf(siteKey(entry.site), report.drawing)) {
                this.drawings.delete(report.drawing);
                return true;
            }
            entry.released = true;
            return false;
        }

        let changed = false;
        const place = siteKey(report.site);
        for (const [drawing, entry] of this.drawings) {
            if (entry.released && drawing !== report.drawing && siteKey(entry.site) === place) {
                this.drawings.delete(drawing);
                changed = true;
            }
        }

        const previous = this.drawings.get(report.drawing);
        const failure: AssetResolutionFailure | null = report.outcome.status === "failed"
            ? { site: report.site, requested: report.outcome.requested, stage: report.outcome.stage }
            : null;
        this.drawings.set(report.drawing, { site: report.site, failure, released: false });
        // A released failure still counts until something replaces it, so it is compared like any other.
        return changed || !sameFailure(previous?.failure ?? null, failure);
    }

    /**
     * Drop every failure whose drawing has gone.
     *
     * For a new bundle: the document those failures were drawn from has been replaced, and every
     * other runtime issue is cleared at the same moment. What is still on screen stays, because it
     * has not reported otherwise - and will not, unless something about it changes.
     */
    public forgetReleased(): void {
        for (const [drawing, entry] of this.drawings) {
            if (entry.released) {
                this.drawings.delete(drawing);
            }
        }
    }

    /** Every failure held, in the order the drawings behind them first reported. */
    public failures(): AssetResolutionFailure[] {
        const out: AssetResolutionFailure[] = [];
        for (const entry of this.drawings.values()) {
            if (entry.failure) {
                out.push(entry.failure);
            }
        }
        return out;
    }

    private liveDrawingOf(place: string, except: string): boolean {
        for (const [drawing, entry] of this.drawings) {
            if (drawing !== except && !entry.released && siteKey(entry.site) === place) {
                return true;
            }
        }
        return false;
    }
}

function sameFailure(a: AssetResolutionFailure | null, b: AssetResolutionFailure | null): boolean {
    if (!a || !b) {
        return a === b;
    }
    return siteKey(a.site) === siteKey(b.site)
        && a.site.ownerName === b.site.ownerName
        && a.requested === b.requested
        && a.stage === b.stage;
}
