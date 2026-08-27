import {
    LOCALIZATION_DOCUMENT_SCHEMA_VERSION,
    LocalizationDocument,
    LocalizationUnit,
    LocalizationUnitStatus,
    normalizeLocalizationDocument,
} from "../../types/localization";
import {
    buildDocumentDiff,
    DocumentChange,
    DocumentChangeKind,
    DocumentDiff,
    DocumentMerge3,
    DocumentMergeDecision,
} from "../diff";
import {compileDocumentPathPattern} from "../documentPath";
import {defineDocumentSpec} from "../registry";
import {change, diffKeyed, fromToParams, previewValue, sameJsonValue} from "./diffHelpers";
import {countConflicts, decision, keyedRowLabel, mergeKeyed} from "./mergeHelpers";
import {parameterFromPath, rejectNewerSchema, requireDocumentObject, requireOptionalMap} from "./parseHelpers";

/**
 * `editor/localization/<locale>.json` - one translation library per language.
 *
 * Owned by `LocalizationService`. `editor/localization/keys.json` sits inside this pattern's space
 * and is a different format; it is a separate kind (see `localizationKeys.ts`) and the registry
 * resolves the overlap by taking the more specific pattern. That split is forced rather than
 * stylistic: `pathFor` refuses two paths of one spec that take the same parameters, and it would
 * have no way to tell `pathFor({locale: "keys"})` from the keys document.
 */
export const LOCALIZATION_DOCUMENT_PATH = "editor/localization/<locale>.json";

const LOCALIZATION_DOCUMENT_PATTERN = compileDocumentPathPattern(LOCALIZATION_DOCUMENT_PATH);

/**
 * What a row about one translation unit says.
 *
 * The first three are the comparison's and the merge's shared vocabulary, and the two reach them
 * from opposite ends. A comparison has a base and a head, so which word applies is read straight
 * off which side holds the unit. A three-way merge cannot do that: "theirs does not have this
 * unit" is an addition by me when the base did not have it either, and a removal by them when it
 * did, and only the base tells the two apart - the same rule the asset shard's rows follow, for the
 * same reason.
 *
 * The last two are the comparison's alone, for the parts of a unit that are not its text.
 */
const LABEL = {
    added: "documentDiff.localization.added",
    removed: "documentDiff.localization.removed",
    changed: "documentDiff.localization.changed",
    note: "documentDiff.localization.note",
    source: "documentDiff.localization.source",
} as const;

/**
 * What a unit's status now is, in the four words the translation table already uses for them.
 *
 * Stated as the state that holds rather than drawn as a pair of values, because the pair would be
 * the file's own two words - `machine`, `reviewed` - which are stored identifiers and not what a
 * translator is shown anywhere else.
 */
const STATUS_LABEL: Record<LocalizationUnitStatus, string> = {
    untranslated: "documentDiff.localization.statusUntranslated",
    machine: "documentDiff.localization.statusMachine",
    translated: "documentDiff.localization.statusTranslated",
    reviewed: "documentDiff.localization.statusReviewed",
};

export const localizationDocumentSpec = defineDocumentSpec<LocalizationDocument>({
    kind: "localization",
    version: LOCALIZATION_DOCUMENT_SCHEMA_VERSION,
    paths: [LOCALIZATION_DOCUMENT_PATH],
    parse: (raw, context) => {
        const locale = parameterFromPath(LOCALIZATION_DOCUMENT_PATTERN, "locale", context);
        const record = requireDocumentObject(raw, context, "a translation library");
        rejectNewerSchema(record, context, LOCALIZATION_DOCUMENT_SCHEMA_VERSION);
        requireOptionalMap(record, "units", context);
        return normalizeLocalizationDocument(record, locale);
    },
    summarize: document => ({
        title: document.locale,
        counts: [{key: "translationUnits", value: Object.keys(document.units).length}],
    }),
    diff: diffLocalization,
    merge3: merge3Localization,
});

/**
 * Three-way merge of one translation library - the format per-change resolution pays for itself on.
 *
 * A translation library is the one document where two people working at once is the normal case
 * rather than the awkward one: translators do not partition a file, they take the keys they can
 * do. Almost every unit is touched by exactly one side and merges with nothing to decide, and the
 * handful that both sides translated is precisely what the author has to see. Resolving the whole
 * file from one side - the only thing the first tier can do - throws away a day of somebody's
 * work to settle three strings.
 *
 * **A conflict carries both translations, verbatim.** {@link DocumentMergeSide.value} holds each
 * side's whole unit, so the surface can put the two `target` strings side by side; that is the
 * entire question the author is being asked, and a preview or a hash would not be answerable.
 *
 * The document's own two fields are taken from mine without a row. `locale` comes from the file
 * name, so all three sides have the same one by construction, and `schemaVersion` is a constant
 * `parse` already refuses to read a newer value of - neither can differ between two sides of one
 * merge, and a decision row for something that cannot differ is noise the author has to read.
 */
export function merge3Localization(
    base: LocalizationDocument | undefined,
    mine: LocalizationDocument,
    theirs: LocalizationDocument,
): DocumentMerge3<LocalizationDocument> {
    const units = mergeKeyed(base?.units, mine.units, theirs.units);
    const decisions: DocumentMergeDecision[] = units.rows.map(row =>
        // Labelled but with no `subject`, and the omission is the deliberate half: the unit id is a
        // story text id or a `key:`/`char:` handle, none of which the author typed, and `subject` is
        // defined as the author's own word. What they recognise a row by is the two translations
        // beside it, which is what {@link DocumentMergeSide.value} carries.
        decision(["units", row.key], row, {label: keyedRowLabel(row, LABEL)}));

    return {
        document: {
            schemaVersion: mine.schemaVersion,
            locale: mine.locale,
            units: units.merged,
        },
        decisions,
        conflicts: countConflicts(decisions),
    };
}

/**
 * Semantic diff of one translation library - the document whose entire content is the author's text.
 *
 * Keyed by translation unit, on the same path the merge takes its decisions on (`units/<id>`), so a
 * comparison and a merge of the same pair of files cannot disagree about what a row is about.
 * Everything else follows from one fact: a unit id is a story text id or a `key:` / `char:` /
 * `scene:` handle, never a word anybody typed, so an id on a row would identify nothing. What
 * identifies a row is the translation itself, which is carried BOTH as `subject` and as the value
 * pair - the surface prints it once, because `resolveDocumentChangeLabel` drops a subject the label
 * already carries (`renderer/lib/vcs/documentChangeView.ts`).
 *
 * **Both sides of a changed string, quoted at the ceiling every other value on this surface obeys.**
 * {@link previewValue} caps a quoted value at 80 characters and a translation goes through it like
 * any other: a row exists so a change can be read without opening anything, not so that every line
 * of a translated script crosses IPC. The rest of a long line is in the row's own tooltip, and the
 * whole document at authoring width is what the split comparison tab is for.
 *
 * **A translation that was cleared keeps both sides.** The pair is built here rather than through
 * {@link fromToParams}, which leaves out a side it has nothing quotable for - and an emptied
 * translation is exactly the case where the empty side is the news. It draws as an arrow with
 * nothing after it, which is what happened.
 *
 * **The document's own two fields earn no rows.** `locale` is read off the file name, so two
 * versions of one path carry the same one by construction, and `schemaVersion` is a constant
 * `parse` refuses to read a newer value of. Neither can differ between two versions of one file,
 * and a row for something that cannot differ is a line the author has to read and dismiss. Unit
 * ORDER earns none either: the map's key order is the order units were first written in, and the
 * translation table offers no way to arrange it, so there is no authored order to compare.
 *
 * Rows come out in unit-id order, which is what {@link diffKeyed} sorts by, and are not re-sorted:
 * ids keep the `char:`, `key:` and `scene:` families together, and the only other candidate - the
 * translated text - is the thing that is changing.
 */
export function diffLocalization(
    base: LocalizationDocument,
    head: LocalizationDocument,
    options: {limit: number},
): DocumentDiff {
    const rows: DocumentChange[] = [];

    for (const entry of diffKeyed(base.units, head.units)) {
        const path = ["units", entry.key];
        // The newer translation where there is one, so a row is recognised by the text as it now
        // reads; the older one only where the unit is gone. Never an id, and never a stand-in.
        const subject = previewValue(entry.head?.target) ?? previewValue(entry.base?.target);

        if (!entry.base || !entry.head) {
            // A unit only one version holds is an addition or a removal and never a change. Which
            // of the two is not a judgement made here - diffKeyed reports the side it is missing
            // from, and this row carries that side's text so the author reads what arrived or what
            // went away rather than an id.
            const present = (entry.head ?? entry.base) as LocalizationUnit;
            rows.push(change(path, entry.kind, entry.head ? LABEL.added : LABEL.removed, {
                params: entry.head ? {to: quoted(present.target)} : {from: quoted(present.target)},
                subject,
            }));
            continue;
        }

        const retranslated = entry.base.target !== entry.head.target;
        if (retranslated) {
            rows.push(change(path, "changed", LABEL.changed, {
                params: {from: quoted(entry.base.target), to: quoted(entry.head.target)},
                subject,
            }));
        }

        const statusLabel = STATUS_LABEL[entry.head.status];
        // Guarded rather than assumed: `parse` normalises a status to one of four, but `diff` is
        // handed whatever a repository holds, and a row whose label key names nothing renders the
        // dotted key at the author.
        if (statusLabel && entry.base.status !== entry.head.status) {
            rows.push(change([...path, "status"], "changed", statusLabel, {subject}));
        }

        if (!sameJsonValue(entry.base.note, entry.head.note)) {
            rows.push(change([...path, "note"], presence(entry.base.note, entry.head.note), LABEL.note, {
                params: fromToParams(entry.base.note, entry.head.note),
                subject,
            }));
        }

        // The source text this translation was written against is a different one now. Reported
        // only where the translation itself is unchanged, which is the case it is the sole evidence
        // of: a translator re-confirmed a line the writer had edited under them, and nothing else
        // in the file records that. Beside a retranslated line it would say nothing the row above
        // does not already say.
        if (!retranslated && entry.base.sourceHash !== entry.head.sourceHash) {
            rows.push(change([...path, "source"], "changed", LABEL.source, {subject}));
        }
    }

    return buildDocumentDiff(rows, {tier: "semantic", limit: options.limit});
}

/**
 * One translation, as much of it as a row may carry.
 *
 * Empty comes back as an empty string rather than as nothing, which is the difference between the
 * two sides of a cleared translation being drawn and one of them being dropped. Everything else is
 * {@link previewValue}: whitespace collapsed onto one line, and cut at the same 80 characters every
 * quoted value on this surface is cut at.
 */
function quoted(target: string): string {
    return previewValue(target) ?? "";
}

function presence(base: unknown, head: unknown): DocumentChangeKind {
    if (base === undefined) {
        return "added";
    }
    return head === undefined ? "removed" : "changed";
}
