/**
 * The link a stored colour uses to point at the project's brand palette.
 *
 * ```
 * nlbrand:<id>            the palette entry as it stands, whatever opacity it carries
 * nlbrand:<id>/<alpha>    the palette entry at exactly `alpha`, 0..1
 * ```
 *
 * **Why this shape is safe to store in fields nothing has been taught about yet.** Studio has three
 * colour parsers, and every one of them already rejects it, so a field that has not been wired up
 * falls through to the branch it would have taken for any unrecognised string - its own fallback -
 * rather than painting a wrong colour:
 *
 * - `normalizeHex` (`renderer/.../properties/framework/utils/colorUtils.ts`) tests the body against
 *   `^[0-9a-fA-F]+$`, and `nlbrand:` is not hex;
 * - `RGBA_REGEX` in the same file is anchored on `rgb(`/`rgba(`;
 * - `normalizeOpaqueBackgroundColor` (`@shared/utils/gameRuntimeEntrySurface.ts`) ends at a bare
 *   colour name, which it requires to match `^[a-z]+$` - the colon puts a link out.
 *
 * That is the safety net the feature is rolled out behind, so it is pinned by assertions rather
 * than left as a claim: see `brandLink.test.ts` here and the brand-link block in
 * `colorUtils.test.ts`. Weaken any of those three and a half-adopted project starts painting
 * black rectangles where a button used to be.
 *
 * Comments in English per project convention.
 */

export const BRAND_LINK_SCHEME = "nlbrand:";

/**
 * `<id>` and the optional `/<alpha>` that can follow it.
 *
 * The id grammar covers both spellings that exist: a seeded slot (`primary`, `button.border`) and
 * the short generated id an author's own colour gets (`c7f3a1b2`). They deliberately live in one
 * character set - each segment starting with a lower-case letter, at most one dot - so nothing
 * downstream has to know which kind of id it is holding, and so a generator's only obligation is to
 * stay inside it.
 *
 * Interior capitals are allowed because a seeded slot is named after the widget it dresses, and one
 * of those widgets is `textInput`. Spelling `textInput.background` any other way here would mean the
 * palette and the widget registry disagreeing about what that widget is called - and a seeded id is
 * permanent once published, so this is the side that gives.
 */
const BRAND_LINK_BODY = /^([a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)?)(?:\/(\d+(?:\.\d+)?|\.\d+))?$/;

export type BrandLink = {
    id: string;
    /** 0..1. A link with no alpha segment means 1, i.e. the palette colour as it is. */
    alpha: number;
    /**
     * Whether a `/<alpha>` segment was actually written.
     *
     * `alpha` on its own cannot say so - `nlbrand:primary` and `nlbrand:primary/1` both read as 1 -
     * and the resolver has to tell the two apart, because a written segment *replaces* the opacity
     * of the literal the chain ends at while an absent one leaves it standing. See
     * `BrandPalette.resolveValueCss` for why that is the rule.
     */
    alphaExplicit: boolean;
};

/**
 * The link, or `null` for anything that is not one - including a string that starts with the scheme
 * but does not parse.
 *
 * **An out-of-range or malformed alpha is refused, not repaired.** Studio never writes one, so the
 * only way to see `nlbrand:primary/05` is a hand-edit or a mangled merge, and clamping it to 1 would
 * silently paint an opaque colour where the author had a translucent one. Refusing sends the value
 * down the unresolvable-link path, where the fallback colour is drawn and lint says so - a state
 * the author can see and fix.
 */
export function parseBrandLink(raw: string | null | undefined): BrandLink | null {
    if (typeof raw !== "string") {
        return null;
    }
    const trimmed = raw.trim();
    if (!trimmed.startsWith(BRAND_LINK_SCHEME)) {
        return null;
    }
    const match = BRAND_LINK_BODY.exec(trimmed.slice(BRAND_LINK_SCHEME.length));
    if (!match) {
        return null;
    }
    const [, id, rawAlpha] = match;
    if (rawAlpha === undefined) {
        return {id, alpha: 1, alphaExplicit: false};
    }
    const alpha = Number(rawAlpha);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
        return null;
    }
    return {id, alpha, alphaExplicit: true};
}

export function isBrandLink(raw: string | null | undefined): boolean {
    return parseBrandLink(raw) !== null;
}

/**
 * The stored spelling of a link.
 *
 * Opaque is written without an alpha segment rather than as `/1`, so that the ordinary case - which
 * is nearly every link - round-trips to the shortest form and two authors who picked the same
 * colour produce the same bytes.
 *
 * Two decimals, trailing zeros dropped. An alpha slider produces far more precision than a colour
 * can carry, and `0.5000000000000001` in a versioned document is a diff row about nothing.
 *
 * `writeOpaqueSegment` is the one case where the short form is wrong: a link to an entry that is
 * *itself* translucent, whose author has just dragged the opacity to 100%. Dropping the segment
 * there does not mean "opaque", it means "inherit", so the field would read back at the entry's own
 * opacity and the slider would refuse to stay where it was put. Only the serializer knows the
 * entry's alpha, so only the serializer can tell the two apart - hence a flag at the call site
 * rather than a rule in here.
 */
export function formatBrandLink(
    id: string,
    alpha?: number,
    options?: {writeOpaqueSegment?: boolean},
): string {
    if (alpha === undefined || !Number.isFinite(alpha)) {
        return `${BRAND_LINK_SCHEME}${id}`;
    }
    const rounded = Math.round(Math.min(1, Math.max(0, alpha)) * 100) / 100;
    if (rounded >= 1 && !options?.writeOpaqueSegment) {
        return `${BRAND_LINK_SCHEME}${id}`;
    }
    return `${BRAND_LINK_SCHEME}${id}/${rounded}`;
}
