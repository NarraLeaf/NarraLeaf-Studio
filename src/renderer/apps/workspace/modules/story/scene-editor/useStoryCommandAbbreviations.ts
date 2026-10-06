import { useCallback, useMemo } from "react";
import { useCommandTranslation } from "@/lib/i18n";
import {
    ABBREVIATIONS_SETTING_KEY,
    foldAbbreviation,
    liveAbbreviations,
    resolveStoredAbbreviations,
    sameAbbreviations,
    serializeAbbreviations,
    type StoryCommandAbbreviations,
} from "./storyCommandAbbreviations";
import { useSharedStoryPreference, type SharedStoryPreferenceCodec } from "./useSharedStoryPreference";

export type StoryCommandAbbreviationList = {
    /** Every stored abbreviation, folded word → spec id, including any a built-in now shadows. */
    abbreviations: StoryCommandAbbreviations;
    /** The ones that still expand in the active command language (see `liveAbbreviations`). */
    live: StoryCommandAbbreviations;
    /** Point `word` at `commandId`. The caller has already checked it (`checkAbbreviation`). */
    addAbbreviation: (word: string, commandId: string) => void;
    removeAbbreviation: (word: string) => void;
};

const ABBREVIATIONS: SharedStoryPreferenceCodec<StoryCommandAbbreviations> = {
    key: ABBREVIATIONS_SETTING_KEY,
    resolve: resolveStoredAbbreviations,
    same: sameAbbreviations,
    serialize: serializeAbbreviations,
    label: "command abbreviations",
};

/**
 * The author's command abbreviations. Edited on a command's page in the manual; read by the line
 * being typed (which replaces them) and the `/` menu (which ranks and prints them).
 */
export function useStoryCommandAbbreviations(): StoryCommandAbbreviationList {
    const { value: abbreviations, update } = useSharedStoryPreference(ABBREVIATIONS);
    // The command language decides which words a built-in spells, so it decides which abbreviations
    // a built-in now shadows: the translator is the dependency that changes with it.
    const ct = useCommandTranslation();
    const live = useMemo(() => liveAbbreviations(abbreviations), [abbreviations, ct]);
    const addAbbreviation = useCallback((word: string, commandId: string) => {
        const folded = foldAbbreviation(word);
        if (!folded) {
            return;
        }
        update(previous => new Map(previous).set(folded, commandId));
    }, [update]);
    const removeAbbreviation = useCallback((word: string) => {
        const folded = foldAbbreviation(word);
        update(previous => {
            const next = new Map(previous);
            next.delete(folded);
            return next;
        });
    }, [update]);
    return { abbreviations, live, addAbbreviation, removeAbbreviation };
}
