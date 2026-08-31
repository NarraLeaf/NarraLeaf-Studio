/**
 * Whether the NarraLang integration is reachable from the interface.
 *
 * The lexer, parser, printer and the script view they feed are complete and covered by their own
 * tests, but nothing in the story editor offers them while this is off: the two export rows in the
 * story panel's context menus, the palette command that exports a whole story, and the scene tab's
 * script toggle all read it. With them gone the row editor is the only way a scene is written, and
 * the story document the only shape an author sees.
 *
 * Bringing it back is this one line - none of the surfaces behind it were removed.
 */
export const NARRALANG_UI_ENABLED: boolean = false;
