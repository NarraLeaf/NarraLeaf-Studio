import { parseBrandLink } from "@shared/brand/brandLink";
import { collectBrandLinkReferences, type BrandLinkReference } from "@shared/brand/brandReferences";
import { BRAND_LINK_MAX_DEPTH, getActiveBrandPalette, type BrandPalette } from "@shared/brand/brandRegistry";
import type { TranslationKey } from "@shared/i18n/catalog";
import type { SearchJumpTarget } from "../../workspace/services/search/searchIndexModel";
import type { LintContext } from "../context";
import type { LintFinding, LintRule } from "../types";

/**
 * `brand` - colour links that cannot paint.
 *
 * A widget stores `nlbrand:<id>` rather than a hex literal (see `@shared/brand/brandLink`), and the
 * link is resolved on the paint path. When it cannot be resolved the caller draws its own fallback,
 * so the game still runs and the surface still appears - which is exactly why this needs a rule.
 * A broken link is *invisible*: the button is a plausible colour, just not the author's, and nothing
 * anywhere says so. That is also the argument for **warning rather than error**. Nothing is
 * unplayable and nothing needs to stop a build; something needs to be said out loud.
 *
 * **The palette comes from the module-level active one, not from `LintContext`.** Every colour field
 * in Studio resolves against that palette, and the question this rule asks - "would this link paint?"
 * - has to be answered by whatever the paint path would answer, or lint and the canvas can disagree
 * about the same link. `BrandService` publishes it during project open, before any sweep can run.
 * The pure half of the rule takes a palette as a parameter, so a test never touches global state to
 * describe a broken project.
 *
 * Only links *pointing into* the palette are reported, not links *inside* it. A ring between two
 * palette entries paints nothing, but until something points at it nothing on screen is wrong, and
 * the entry that closes the ring is visible in the Brand panel where the author put it.
 */

/** Why a link does not paint. */
export type BrandLinkFailureReason =
    | { kind: "missing" }
    /** The id resolves, but a link further down the chain names an entry that is not there. */
    | { kind: "chain"; missingId: string }
    /** The chain loops - or runs longer than the resolver follows, which is the same document. */
    | { kind: "cycle" };

export type BrandLinkFailure = {
    reference: BrandLinkReference;
    reason: BrandLinkFailureReason;
};

/**
 * Why `id` does not paint, or `null` when it does.
 *
 * `resolveCss` decides *whether* - it is the same call the canvas makes, so this rule can never
 * report a link the canvas is happily painting. The walk below only decides *which of the three
 * reasons* to say, and it is only entered once the resolver has already failed.
 *
 * Telling `chain` apart from `cycle` is not pedantry: deleting an author's own colour that a control
 * slot points at is the ordinary way a project ends up here, and it produces a chain that dangles two
 * links away from the widget. Calling that "the link leads back to itself" would send the author
 * looking for a ring that does not exist.
 */
export function classifyBrandLink(palette: BrandPalette, id: string): BrandLinkFailureReason | null {
    if (!palette.get(id)) {
        return { kind: "missing" };
    }
    if (palette.resolveCss(id) !== null) {
        return null;
    }

    const visited = new Set<string>();
    let cursor = id;
    for (let depth = 0; depth <= BRAND_LINK_MAX_DEPTH; depth += 1) {
        if (visited.has(cursor)) {
            return { kind: "cycle" };
        }
        visited.add(cursor);

        const color = palette.get(cursor);
        if (!color) {
            // Never on the first step - `id` was looked up above - so this is always deeper in.
            return { kind: "chain", missingId: cursor };
        }
        const link = parseBrandLink(color.value);
        if (!link) {
            // The walk reached a literal, so the chain is intact and the resolver refused for a
            // reason that is not about links at all (only a blank value can do this, and the
            // document normalizer drops those). Not this rule's finding to make: it is about links,
            // and there is no link here to name.
            return null;
        }
        cursor = link.id;
    }
    // Past the depth the resolver follows without closing a ring. Reported as one anyway - it takes
    // nine chained links to get here, which no panel can produce and no reader would call anything
    // other than "this points at itself the long way round".
    return { kind: "cycle" };
}

/** Every reference that does not paint, in the order the references were found. */
export function collectBrokenBrandLinks(
    references: readonly BrandLinkReference[],
    palette: BrandPalette,
): BrandLinkFailure[] {
    // One lookup per distinct id rather than per reference: a project points at `button.primary`
    // from every button it has, and the answer is the same every time.
    const byId = new Map<string, BrandLinkFailureReason | null>();
    const failures: BrandLinkFailure[] = [];

    for (const reference of references) {
        if (!byId.has(reference.id)) {
            byId.set(reference.id, classifyBrandLink(palette, reference.id));
        }
        const reason = byId.get(reference.id) ?? null;
        if (reason) {
            failures.push({ reference, reason });
        }
    }
    return failures;
}

function messageKeyFor(reason: BrandLinkFailureReason): TranslationKey {
    switch (reason.kind) {
        case "missing":
            return "lint.rule.brandBrokenLink.message";
        case "chain":
            return "lint.rule.brandBrokenLink.messageChain";
        case "cycle":
            return "lint.rule.brandBrokenLink.messageCycle";
    }
}

function runBrokenLink(ctx: LintContext): LintFinding[] {
    // Only the UI document. `LintContext.characters` carries a summary (id, name, asset ids) rather
    // than the profile, so a character's accent colour is not reachable from here - the scanner
    // covers that source for the delete-confirmation caller, which reads the profiles directly.
    const references = collectBrandLinkReferences({ uidoc: ctx.uiDocument });

    return collectBrokenBrandLinks(references, getActiveBrandPalette()).map(({ reference, reason }) => {
        const target: SearchJumpTarget | undefined = reference.location.surfaceId
            ? { kind: "uiSurface", surfaceId: reference.location.surfaceId }
            : undefined;

        return {
            ruleId: "brand/broken-link" as const,
            messageKey: messageKeyFor(reason),
            messageParams: {
                // The message names its own subject, as `assets/unused` does: this finding is filed
                // under the project (there is no finer `LintLocation` for a widget prop), so the
                // locator column would print nothing, and `where` is the only thing that tells forty
                // findings of one rule apart.
                where: reference.where,
                color: reference.id,
                ...(reason.kind === "chain" ? { missing: reason.missingId } : {}),
            },
            location: { kind: "project" as const },
            ...(target ? { target } : {}),
        };
    });
}

export const BRAND_LINT_RULES: readonly LintRule[] = [
    {
        id: "brand/broken-link",
        category: "brand",
        // Warning: the widget falls back to its own colour and the game runs. See the file header.
        defaultSeverity: "warning",
        slug: "brandBrokenLink",
        run: ctx => runBrokenLink(ctx),
    },
];
