import { AssetType, isBundleAssetType } from "../../workspace/services/assets/assetTypes";
import type { AssetReference, ReferenceGapReason } from "../../workspace/services/references/referenceModel";
import type { LintAssetEntry, LintContext } from "../context";
import type { LintFinding, LintLocation, LintRule } from "../types";

/**
 * `assets` - is every asset in the library actually used, present, and readable.
 *
 * Two shapes of answer live here and they are not symmetric. "Unused" is read off the reference
 * index and is therefore only ever as good as that index (see the blind spots on `assets/unused`);
 * "missing" and "unreadable" are read off the library and the filesystem, where a negative answer is
 * a fact rather than an inference. That is why the first is a warning and the other two are errors.
 */

/**
 * Which sentence a coverage gap earns.
 *
 * Split by reason because the two families are different news: a document that would not open is a
 * failure the author can retry, while a picture the index cannot identify is a thing they authored
 * and can change. Exhaustive, so a reason added later has to be given words rather than inheriting
 * whichever of these happened to be the fallback.
 */
function incompleteIndexMessageKey(reason: ReferenceGapReason): LintFinding["messageKey"] {
    switch (reason) {
        case "indexNotBuilt":
            return "lint.rule.assetsUnused.messageIndexNotBuilt";
        case "sliceFailed":
        case "documentUnreadable":
            return "lint.rule.assetsUnused.messageIndexUnreadable";
        case "hashUrlUnresolved":
        case "computedAssetPin":
            return "lint.rule.assetsUnused.messageIndexUnresolved";
    }
}

/** What `{asset}` renders as. `name` already carries the extension (renaming re-derives `ext` from
 * it), so it is the file name an author recognises; the id is only a fallback for a nameless row. */
function assetLabel(asset: LintAssetEntry): string {
    return asset.name.trim() || asset.id;
}

function assetFinding(
    ruleId: LintFinding["ruleId"],
    messageKey: LintFinding["messageKey"],
    asset: LintAssetEntry,
): LintFinding {
    return {
        ruleId,
        messageKey,
        messageParams: { asset: assetLabel(asset) },
        location: { kind: "asset", assetId: asset.id, assetName: assetLabel(asset) },
        target: { kind: "asset", assetId: asset.id, assetType: asset.type },
    };
}

/**
 * A readable "where" for a reference, for the `{location}` param of `assets/missing`.
 *
 * `label` is the containing entity and `detail` its context line, and for story references the
 * detail already ends with the label (`Chapter 1 > Kitchen` / `Kitchen`) - so they are joined only
 * when that would not repeat the same word twice. The field is appended because two references from
 * one block (a background and a mask) would otherwise render as the same sentence.
 */
export function formatReferenceLocation(reference: AssetReference): string {
    const parts: string[] = [];
    if (reference.detail) {
        parts.push(reference.detail);
    }
    if (reference.label && !reference.detail?.endsWith(reference.label)) {
        parts.push(reference.label);
    }
    const where = parts.join(" › ") || reference.kind;
    return reference.field ? `${where} (${reference.field})` : where;
}

/**
 * The referencing site as a {@link LintLocation}, so the report groups a dangling id under the
 * document that holds it rather than under a library row that no longer exists.
 *
 * Derived from the reference's jump target where there is one: the target already carries the ids
 * and the display names, and re-deriving them from the reference's free-text label would be a second
 * source of truth for the same fact. `uiElement` and `voice` references have no `LintLocation` kind
 * of their own and fall back to the project - their "where" still reaches the reader through
 * `{location}` in the message.
 */
function referenceLocation(ctx: LintContext, reference: AssetReference, assetId: string): LintLocation {
    const target = reference.target;
    if (target?.kind === "storyBlock") {
        return {
            kind: "story",
            storyId: target.storyId,
            storyName: target.storyName,
            sceneId: target.sceneId,
            sceneName: target.sceneName,
            blockId: target.blockId,
        };
    }
    if (target?.kind === "storyScene") {
        return {
            kind: "story",
            storyId: target.storyId,
            storyName: target.storyName,
            sceneId: target.sceneId,
            sceneName: target.sceneName,
        };
    }
    if (target?.kind === "blueprint") {
        return {
            kind: "blueprint",
            blueprintId: target.blueprintId,
            blueprintName: reference.detail,
            graphId: target.focusEventId ?? target.focusFunctionId,
            nodeId: target.focusNodeId,
        };
    }
    if (reference.kind === "character") {
        // Character references carry no target (the panel has no deep link yet), so the character is
        // recovered from the context: by the name the reference was labelled with, and failing that
        // by the id itself - `LintCharacterEntry.assetIds` is the stored ids, dangling ones included,
        // which is exactly the case this rule is about.
        const character =
            ctx.characters.find(entry => entry.name === reference.label)
            ?? ctx.characters.find(entry => entry.assetIds.includes(assetId));
        if (character) {
            return { kind: "character", characterId: character.id, characterName: character.name };
        }
    }
    return { kind: "project" };
}

export const ASSETS_LINT_RULES: readonly LintRule[] = [
    {
        id: "assets/unused",
        category: "assets",
        defaultSeverity: "warning",
        slug: "assetsUnused",
        /**
         * Library rows absent from the reference index.
         *
         * **This rule is exactly as complete as the index is, and it refuses to answer when the
         * index is not.** An incomplete index under-reports references, and every reference it
         * misses turns into an asset this rule calls unused - the one wrong answer that costs an
         * author their work. So a gap produces a finding naming where coverage stopped, and no
         * unused rows at all: a partial list here would be indistinguishable from a complete one.
         *
         * This also replaces the old "no referenced ids at all" heuristic, which stood in for the
         * same signal and got it wrong in both directions - it hid the findings of a genuinely tidy
         * project, and it passed an index that failed on one story out of thirty.
         */
        run(ctx) {
            if (!ctx.assetIndex.complete) {
                return ctx.assetIndex.gaps.map(gap => ({
                    ruleId: "assets/unused" as const,
                    messageKey: incompleteIndexMessageKey(gap.reason),
                    ...(gap.location ? { messageParams: { location: gap.location } } : {}),
                    location: { kind: "project" } as const,
                    ...(gap.target ? { target: gap.target } : {}),
                }));
            }
            return ctx.assets
                .filter(asset => !ctx.referencedAssetIds.has(asset.id))
                .map(asset => assetFinding("assets/unused", "lint.rule.assetsUnused.message", asset));
        },
    },
    {
        id: "assets/missing",
        category: "assets",
        defaultSeverity: "error",
        slug: "assetsMissing",
        /**
         * Referenced ids the library no longer has.
         *
         * One finding **per referencing site**, not per missing id: each site is separately broken
         * and separately fixable, and the finding carries that site's jump target so click-to-jump
         * lands on the document holding the dangling id rather than on an asset row that does not
         * exist to be opened.
         */
        run(ctx) {
            const known = new Set(ctx.assets.map(asset => asset.id));
            const findings: LintFinding[] = [];
            for (const [assetId, references] of ctx.assetReferences) {
                if (known.has(assetId)) {
                    continue;
                }
                if (references.length === 0) {
                    // A key with no sites cannot name a place; the id is the only "where" there is,
                    // and dropping it would be the one failure mode this rule cannot afford.
                    findings.push({
                        ruleId: "assets/missing",
                        messageKey: "lint.rule.assetsMissing.message",
                        messageParams: { location: assetId },
                        location: { kind: "project" },
                    });
                    continue;
                }
                for (const reference of references) {
                    findings.push({
                        ruleId: "assets/missing",
                        messageKey: "lint.rule.assetsMissing.message",
                        messageParams: { location: formatReferenceLocation(reference) },
                        location: referenceLocation(ctx, reference, assetId),
                        target: reference.target,
                    });
                }
            }
            return findings;
        },
    },
    {
        id: "assets/unreadable",
        category: "assets",
        defaultSeverity: "error",
        slug: "assetsUnreadable",
        /**
         * The only rule that touches the filesystem.
         *
         * Two distinct failures, and they are deliberately different messages: a file that is not
         * there at all (deleted, or a shard that never landed) is a different problem for the author
         * than bytes that arrive and will not decode (a `.png` that is really a text file, a
         * truncated write). Only image assets are probed - decoding is what `io` offers and images
         * are what it can decode.
         *
         * **Presence is asked with `io.exists`, never with a read.** This rule runs over the entire
         * library on every build, and it used to ask `readBytes` for every asset just to learn
         * whether the file was there, then discard the buffer: on a project with gigabytes of audio
         * and video that is the whole library across IPC, per build, to answer a yes/no question.
         * `readBytes` therefore no longer appears here at all - the images that need their contents
         * get them through `probeImage`, which reads once and decodes what it read.
         *
         * The one thing this loses: an image-less file that is present but whose bytes will not come
         * off the disk (an fd-level I/O error on a statable file) is no longer reported. A missing
         * file, a shard that never landed and a permission error all still are - `exists` answers
         * false for each - and paying a full library read on every build to catch the remainder is
         * not a trade this rule can make.
         *
         * Awaited one asset at a time. Not a limiter - `LintIo` already bounds the decode side - but
         * a `Promise.all` over the library would hold every probed image's bytes in memory at once.
         *
         * One carve-out, which would otherwise be a guaranteed false error on a healthy project (and
         * this rule defaults to `error`, which stops a build): **model bundles** are stored as a
         * *directory* at the shard path, so "is there a file here" is the wrong question about them.
         * "Is this bundle intact" is a real question and a different one; it needs a listing, which
         * `LintIo` does not offer.
         *
         * Remote assets used to be carved out too, back when they were a URL with no local bytes.
         * They are pinned now - a snapshot at the ordinary content shard - so this rule applies to
         * them unchanged, and that is what reports a record written before pinning: it has never been
         * fetched, so it genuinely has no bytes, and Refresh is what fixes it.
         */
        async run(ctx) {
            const findings: LintFinding[] = [];
            for (const asset of ctx.assets) {
                if (isBundleAssetType(asset.type)) {
                    continue;
                }
                if (!(await ctx.io.exists(asset.id))) {
                    findings.push(
                        assetFinding("assets/unreadable", "lint.rule.assetsUnreadable.messageMissingBytes", asset),
                    );
                    continue;
                }
                if (asset.type !== AssetType.Image) {
                    continue;
                }
                const probe = await ctx.io.probeImage(asset.id);
                if (!probe.ok) {
                    findings.push(assetFinding("assets/unreadable", "lint.rule.assetsUnreadable.message", asset));
                }
            }
            return findings;
        },
    },
];
