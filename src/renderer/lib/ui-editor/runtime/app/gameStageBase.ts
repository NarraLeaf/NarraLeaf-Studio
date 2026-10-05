/**
 * The ground a running game is drawn on: black behind the stage, and white as the colour every word
 * on it inherits unless it states one of its own.
 *
 * Set by each of the three places a game is shown - the shipped game's window, Dev Mode's stage
 * frame and the story editor's live preview - so that whatever on the stage leaves its colour to the
 * page comes out the same in all of them. Inside Studio the stage used to inherit Studio's own theme
 * instead: the light theme's near-black in the preview, which made a dialogue line vanish into its
 * dark box, and the dark theme's off-white in Dev Mode, which only looked right by accident. Studio's
 * theme belongs to the editor around the stage and never reaches into it.
 */
export const GAME_STAGE_BASE_CLASS_NAME = "bg-black text-white";
