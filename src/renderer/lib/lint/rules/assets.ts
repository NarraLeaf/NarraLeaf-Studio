import { RELEASE_APP_TAG } from "@shared/types/appTag";
import {
    resolveAssetSetContents,
    validateAssetSet,
    type AssetSet,
    type AssetSetCandidate,
    type AssetSetProblem,
} from "@shared/types/assetSet";
import { formatBytes } from "@shared/utils/formatBytes";
import { solveReleaseContent } from "../../build/releaseContent";
import { AssetType, isBundleAssetType } from "../../workspace/services/assets/assetTypes";
import type { AssetReference, ReferenceGapReason } from "../../workspace/services/references/referenceModel";
import { referenceCoverageGapsFor } from "../../workspace/services/assets/assetDeleteGuard";
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
        case "blueprintProgramNotWalked":
            return "lint.rule.assetsUnused.messageIndexUnreadable";
        case "hashUrlUnresolved":
        case "computedAssetPin":
        case "unknownNodeType":
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
         * **This rule is exactly as complete as the index is, and it withholds the answers the
         * index cannot support.** An incomplete index under-reports references, and every reference
         * it misses turns into an asset this rule calls unused - the one wrong answer that costs an
         * author their work.
         *
         * So each gap produces a finding naming where coverage stopped, and the unused rows are
         * filtered to the assets no gap could be hiding a use of. Withholding *everything* was the
         * first shape and it was too blunt: one widget with an unreadable picture would silence the
         * report for the sounds and the typefaces too, which are not in doubt at all.
         *
         * This also replaces the old "no referenced ids at all" heuristic, which stood in for the
         * same signal and got it wrong in both directions - it hid the findings of a genuinely tidy
         * project, and it passed an index that failed on one story out of thirty.
         */
        run(ctx) {
            const findings: LintFinding[] = ctx.assetIndex.gaps.map(gap => ({
                ruleId: "assets/unused" as const,
                messageKey: incompleteIndexMessageKey(gap.reason),
                ...(gap.location ? { messageParams: { location: gap.location } } : {}),
                location: { kind: "project" } as const,
                ...(gap.target ? { target: gap.target } : {}),
            }));
            // Per asset rather than all-or-nothing: a gap that can only be hiding a picture must not
            // cost the author the answer about their sounds. `referenceCoverageGapsFor` is the same
            // judgement the delete guard makes, so the report and the guard cannot disagree.
            findings.push(
                ...ctx.assets
                    .filter(asset => !ctx.referencedAssetIds.has(asset.id))
                    .filter(asset => referenceCoverageGapsFor(ctx.assetIndex, [asset.type]).length === 0)
                    .map(asset => assetFinding("assets/unused", "lint.rule.assetsUnused.message", asset)),
            );
            return findings;
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
    {
        /**
         * A file every build carries that is larger than this project says a build should carry.
         *
         * ## Why the solver decides which assets count
         *
         * `solveReleaseContent` answers which assets the retained content of a package references,
         * and that is the set worth reporting: an asset nothing points at is `assets/unused`'s
         * business, and saying it twice in two vocabularies would make the bigger list the one an
         * author stops reading.
         *
         * ## Why one solve answers for every variant
         *
         * **Nothing trims assets.** A variant drops scenes; the asset copy walks the library, so an
         * oversized file ships in every edition whichever one references it. The release variant's
         * set is also the superset by construction - it sweeps no scene - so solving it once names
         * every asset any variant could carry. Solving per variant would cost a fold of every story
         * per variant to produce a subset of this answer.
         *
         * ## Why the threshold is declared rather than chosen here
         *
         * There is no number that is right for a phone build and for a desktop release, so this
         * follows `text/overlong`: a declared option the settings panel renders an editor for, with
         * a default that only reports files large enough that nobody meant them.
         */
        id: "assets/oversized",
        category: "assets",
        defaultSeverity: "info",
        slug: "assetsOversized",
        options: {
            maxMegabytes: { kind: "number", default: 64, min: 1, max: 4096 },
        },
        run(ctx, options) {
            const megabytes = Number(options.maxMegabytes);
            if (!Number.isFinite(megabytes) || megabytes <= 0) {
                return [];
            }
            const limit = megabytes * 1024 * 1024;
            const carried = shippedAssetIds(ctx);
            const findings: LintFinding[] = [];
            for (const asset of ctx.assets) {
                const size = assetByteSize(asset);
                // A record with no size has never been measured - a remote asset that has not been
                // fetched is the case - and a rule that read that as zero would say nothing while a
                // rule that read it as huge would report a file it has never seen.
                if (size === null || size <= limit || !carried.has(asset.id)) {
                    continue;
                }
                findings.push({
                    ruleId: "assets/oversized",
                    messageKey: "lint.rule.assetsOversized.message",
                    messageParams: { asset: assetLabel(asset), size: formatBytes(size), limit: formatBytes(limit) },
                    location: { kind: "asset", assetId: asset.id, assetName: assetLabel(asset) },
                    target: { kind: "asset", assetId: asset.id, assetType: asset.type },
                });
            }
            return findings;
        },
    },
    {
        /**
         * A set that does not resolve to exactly one file for everything it promises.
         *
         * ## Why this is a project check and not only a colour in the panel
         *
         * A set is broken by people who are not looking at the asset panel. Whoever adds a language
         * is doing localization; whoever adds a variant is doing release work. Neither has a reason
         * to open the library, and the hole they leave shows up nowhere until something reaches for
         * the file that was never imported. The panel's warning colour is for the author who is
         * already standing in front of the library; this is for everyone who is not.
         *
         * ## Two failures, one rule
         *
         * A coordinate with **no** file and a coordinate with **more than one** are both "this set
         * does not name a file", which is the single thing a reference to it depends on. They are
         * separate sentences because the fix is the opposite one - import or tag a file, or stop
         * two files claiming the same coordinate - but splitting them into two rules would let a
         * project silence one severity and keep the other while both mean the same thing at a
         * reference site.
         *
         * A set whose own declaration is incoherent (no axes, an axis promising no values, a build
         * axis nested inside a runtime one) is reported here too, and instead of its contents: a set
         * in that state has no coordinates to have holes in, so every cell would be silent and the
         * author would be told nothing at all.
         *
         * ## What is deliberately not named
         *
         * The message names the set and the coordinate, never a file. A coordinate is what the
         * author writes on a file; the file it would resolve to does not exist yet. And for a build
         * axis, the variants a package leaves out must not be named anywhere a log can reach - see
         * `@shared/types/assetSet` on why that residency is a safety property.
         */
        id: "assets/group-incomplete",
        category: "assets",
        defaultSeverity: "warning",
        slug: "assetsGroupIncomplete",
        run(ctx) {
            if (ctx.assetSets.length === 0) {
                return [];
            }
            const candidates: AssetSetCandidate[] = ctx.assets.map(asset => ({
                id: asset.id,
                type: asset.type,
                tags: asset.tags,
            }));
            const findings: LintFinding[] = [];
            for (const set of ctx.assetSets) {
                const problems = validateAssetSet(set);
                if (problems.length > 0) {
                    findings.push(...problems.map(problem => assetSetFinding(set, problem)));
                    continue;
                }
                const contents = resolveAssetSetContents(set, candidates);
                for (const cell of contents.missing) {
                    findings.push({
                        ruleId: "assets/group-incomplete",
                        messageKey: "lint.rule.assetsGroupIncomplete.message",
                        messageParams: { set: assetSetLabel(set), variant: cell.label },
                        location: { kind: "project" },
                    });
                }
                for (const cell of contents.ambiguous) {
                    findings.push({
                        ruleId: "assets/group-incomplete",
                        messageKey: "lint.rule.assetsGroupIncomplete.messageAmbiguous",
                        messageParams: {
                            set: assetSetLabel(set),
                            variant: cell.label,
                            count: String(cell.assetIds.length),
                        },
                        location: { kind: "project" },
                    });
                }
            }
            return findings;
        },
    },
];

/** What `{set}` renders as. Falls back to the id only for a set whose name never got typed. */
function assetSetLabel(set: AssetSet): string {
    return set.name.trim() || set.id;
}

/**
 * The sentence a declaration fault earns.
 *
 * Exhaustive over {@link AssetSetProblem}, so a fault added to the model has to be given words here
 * rather than inheriting whichever branch happened to be the fallback - the same bargain
 * `incompleteIndexMessageKey` makes above. The four shapes that are all "this set describes
 * nothing" share one sentence: the inspector is where an author sees which axis is at fault, and a
 * report that spelled out each of them would be four ways of saying the set is unfinished.
 */
function assetSetFinding(set: AssetSet, problem: AssetSetProblem): LintFinding {
    const base = {
        ruleId: "assets/group-incomplete" as const,
        location: { kind: "project" } as const,
    };
    switch (problem.kind) {
        case "residencyInversion":
            return {
                ...base,
                messageKey: "lint.rule.assetsGroupIncomplete.messageResidency",
                messageParams: {
                    set: assetSetLabel(set),
                    axis: problem.axisKey,
                    outerAxis: problem.outerAxisKey,
                },
            };
        case "noAxes":
        case "emptyAxisKey":
        case "emptyAxisValues":
        case "duplicateAxis":
        case "duplicateAxisValue":
            return {
                ...base,
                messageKey: "lint.rule.assetsGroupIncomplete.messageDeclaration",
                messageParams: { set: assetSetLabel(set) },
            };
    }
}

/** The bytes a record was measured at, or null when it has never been measured. */
function assetByteSize(asset: LintAssetEntry): number | null {
    const meta = asset.meta;
    if (!meta || typeof meta !== "object") {
        return null;
    }
    const size = (meta as { size?: unknown }).size;
    return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : null;
}

/**
 * Every asset a package's retained content references, from the solver.
 *
 * Asked of the release variant, which is the superset; see the rule's own note. Answers an empty set
 * on any failure, which withholds the rule rather than reporting the whole library - the same
 * bargain `assets/unused` makes with an index it cannot trust.
 */
function shippedAssetIds(ctx: LintContext): ReadonlySet<string> {
    try {
        const answer = solveReleaseContent({
            appTag: RELEASE_APP_TAG,
            // The release variant sweeps nothing, so no declaration and no plugin can change which
            // scenes are retained - and therefore none can change this answer.
            projectDeclaredScenes: {},
            plugins: [],
            stories: ctx.stories.map(entry => ({ id: entry.id, name: entry.name, document: entry.document })),
            blueprints: Object.values(ctx.blueprintDocument?.blueprints ?? {}),
            surfaces: [],
            localizationKeys: [],
            assets: ctx.assets.map(asset => ({ id: asset.id, name: asset.name })),
            assetReferences: ctx.assetReferences,
        });
        return new Set(answer.members.filter(member => member.kind === "asset").map(member => member.id));
    } catch (error) {
        console.warn("[lint] the release content solver failed, so no asset size is reported", error);
        return new Set<string>();
    }
}
