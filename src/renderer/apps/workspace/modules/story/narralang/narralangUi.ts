import { hasExperimentalCondition } from "@shared/types/experimental";
import { experimentalState } from "@/lib/experimental";

/**
 * Whether the NarraLang integration is reachable from the interface.
 *
 * The lexer, parser, printer and the script view they feed are complete and covered by their own
 * tests, but nothing in the story editor offers them unless this says so: the two export rows in
 * the story panel's context menus, the palette command that exports a whole story, and the scene
 * tab's script toggle all read it. With them gone the row editor is the only way a scene is
 * written, and the story document the only shape an author sees.
 *
 * It is an experimental condition rather than a constant in the source, so that turning it on is a
 * launch and not a build:
 *
 *     yarn dev --experimental --x-narralang
 *
 * That keeps the shipped answer fixed - experimental mode is refused outright by a packaged
 * Studio, so no author can reach any of this - while leaving one command that puts every surface
 * back for someone driving a checkout. The value is decided by the command line and cannot change
 * while a window lives, so the surfaces below it may be mounted conditionally.
 *
 * The help topic on editing outside Studio does not mention the format. Experimental conditions are
 * not part of the product an author is reading about, and nothing in that area is translated.
 */
export function narralangUiEnabled(): boolean {
    return hasExperimentalCondition(experimentalState(), "narralang");
}
