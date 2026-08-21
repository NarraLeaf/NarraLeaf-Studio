/**
 * `dictionary` - the project's own vocabulary, edited in the dictionary panel.
 *
 * Titles are short noun phrases. What each field is for is stated by the field's own name and by
 * what the story editor does with it, not by a line of prose beside it.
 */
export const dictionary = {
    search: "Search terms",
    add: "Add term",
    /** The name a term added with nothing typed in the search box is created under. */
    newTerm: "New term",
    empty: "No terms",
    noMatches: "No matching terms",
    remove: "Remove term",
    /** The row a right click on a selected word adds to the editable-text menu. */
    addSelection: "Add “{term}” to dictionary",
    field: {
        term: "Term",
        reading: "Reading",
        variants: "Variant spellings",
        note: "Note",
    },
    options: {
        suggestReadings: "Suggest readings",
        checkVariants: "Check variant spellings",
    },
} as const;
