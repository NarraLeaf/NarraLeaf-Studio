/**
 * The translations of copied story rows, travelling with them.
 *
 * A translation unit is keyed by the `textId` of the line it translates, and a paste mints a fresh
 * `textId` for every row it writes - it has to, or two rows would share one unit and a language
 * would have no way to say different things about them. The consequence, until this existed, was
 * that copying a translated line produced an untranslated one, silently, and within a single
 * project as much as between two: duplicating a finished chapter threw away every language it had.
 *
 * So the units travel on the clipboard beside the rows, and the paste writes them back under the
 * ids it has just minted. Three decisions shape that:
 *
 *  - **Whole units, `sourceHash` and note included.** The line arrives character for character, so
 *    everything the unit said about itself over there is still true here - including a stale anchor,
 *    which says the translation was made against a source line that has since been rewritten. A
 *    paste that re-anchored it would turn a translation known to be out of date into a current one.
 *  - **A review is not inherited.** `reviewed` says a person signed off on that unit; nobody has
 *    signed off on the one the paste creates, so it lands as `translated`. `machine` is a statement
 *    about where the text came from rather than about who approved it, and stays. Understating what
 *    a translation has been through costs a second look; overstating it costs the review.
 *  - **Only languages the pasting project declares.** A unit for a language this project does not
 *    have has nowhere to go, and adding a language is a decision an author makes rather than
 *    something a paste does behind them - so those are counted and reported, never written.
 *
 * The units are not part of the paste's undo step and cannot be: the scene's history scope captures
 * the scene document, and translations live in per-locale documents another service owns. Undoing a
 * paste therefore leaves the carried units behind, keyed by `textId`s no row uses any more - which
 * is the same orphan state deleting a translated row already produces, and what
 * `localization/orphan` reports.
 *
 * The machinery is shared with the interface editor, whose copied widgets carry the translations of
 * their own words the same way, and lives in `@/lib/workspace/services/localization/carriedTranslations`.
 */

export {
    carryTranslationsWithinProject,
    collectClipboardTranslations,
    createCarriedTranslationPort,
    planCarriedTranslations,
    readProjectLocales,
    writeCarriedTranslations,
} from "@/lib/workspace/services/localization/carriedTranslations";
export type {
    CarriedTranslationOutcome,
    CarriedTranslationPlan,
    CarriedTranslationPort,
    CarriedTranslationWrite,
    TranslationDocuments,
} from "@/lib/workspace/services/localization/carriedTranslations";
