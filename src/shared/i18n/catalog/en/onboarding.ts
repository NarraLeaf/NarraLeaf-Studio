/**
 * `onboarding` - first-run setup, shown in the launcher window before the home screen.
 *
 * Only the words this flow owns. The theme and accent names are read from the `settings`
 * namespace instead of restated here: they name the same two preferences, and a second spelling
 * of "Follow system" is how the setup screen and the Settings window end up disagreeing about
 * what the author chose.
 *
 * Each screen carries one line under its title. That line is the "expectation" layer of
 * docs/help-system.md §1 - what happens if you touch this - and is the whole reason setup needs
 * no help topics of its own: this is the surface that has to explain itself.
 */
export const onboarding = {
    /**
     * The title bar, for the whole flow rather than per screen.
     *
     * The one place setup says what it is a setup OF. Each screen's heading is the question it
     * asks, which leaves nothing naming the product - and this is the first window anyone sees.
     * `{name}` is `APP_DISPLAY_NAME`, so the two cannot drift apart.
     */
    windowTitle: "Welcome to {name}",
    language: {
        title: "Language",
        expectation: "The language of Studio's interface. It can be changed in Settings.",
        matchedToDevice: "matched to this device",
    },
    appearance: {
        title: "Appearance",
        expectation: "The appearance of Studio's interface. Both settings apply immediately.",
    },
    done: {
        title: "Studio is set up",
        expectation: "Language and appearance are in Settings. Press F1 anywhere for help on what is under the cursor.",
    },
    nav: {
        skip: "Skip setup",
        finish: "Open Studio",
    },
} as const;
