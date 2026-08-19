import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import type { StoryCommandLineRef } from "./storyCommandLine";
import { useStoryRefLink } from "./storyRefNavigation";
import { isJumpModifierEvent } from "./useJumpModifier";

/**
 * A word on a committed row that NAMES something else in the project, and nothing more.
 *
 * The other half of the pair: {@link StoryLineValueToken} draws the words a click can change, and
 * many of those are also references. This is for the ones that are only references — a stage object's
 * name, the label a `/goto` lands on, a variable, a mask no row can re-point — which the line prints
 * and no editor stands behind.
 *
 * **Not a `<button>`, deliberately.** A scene is hundreds of rows and these words are everywhere in
 * them; making each one a button would put every stage object name in the tab order, so walking the
 * editor with the keyboard would mean tabbing through the script word by word. It is also inert most
 * of the time: without the modifier there is nothing to activate, and a control that is a control
 * only sometimes is not a control.
 *
 * **Both `mouseDown` and `click` are stopped.** Modifier+click on a row already means "add this row
 * to the selection" (`selectRow`), and the row acts on the mouse DOWN — so stopping only the click
 * would follow the reference and change the author's row selection on the way, which is the state
 * they would find themselves in afterwards with no idea why.
 */

/** No decoration until the modifier is down: an inert word must not advertise itself as a control. */
const REF_TOKEN_CLASS = "rounded-md px-0.5 transition-colors";

/**
 * How a word says "there is somewhere to go" — the whole of the affordance.
 *
 * It has to be the underline and the cursor, because the two obvious alternatives are both closed to
 * this product: rows carry no explanatory text, and a native `title` tooltip covers the very pixels
 * the author is aiming at. The glyphs keep their own syntax colour on purpose — repainting the word
 * accent would make holding the modifier redraw the line rather than annotate it — so the accent
 * arrives as the underline, which `text-decoration` draws for the whole run from this one element.
 */
export const REF_TOKEN_ARMED_CLASS = "cursor-pointer underline decoration-primary decoration-solid underline-offset-2 hover:bg-fill";

export function StoryLineRefToken(props: { target: StoryCommandLineRef; children: ReactNode }) {
    const link = useStoryRefLink(props.target);
    if (!link) {
        // Nothing to go to: the word still prints, exactly as the line wrote it.
        return <>{props.children}</>;
    }
    return (
        <span
            className={cn(REF_TOKEN_CLASS, link.armed && REF_TOKEN_ARMED_CLASS)}
            // Both handlers ask the EVENT, never the `armed` flag beside them. `armed` is a keyboard
            // state and answers "should this word look like a link"; the gesture answers "was this
            // click a jump", and the two can disagree for one real gesture: hold the modifier in
            // another window, come back, and click — the `blur` reset has already cleared `armed` and
            // no `keydown` has arrived, yet the click genuinely carries the modifier.
            //
            // A plain press is deliberately NOT stopped, so the row underneath keeps its own
            // press-to-select and drag-select over these words.
            onMouseDown={event => {
                if (isJumpModifierEvent(event)) {
                    event.stopPropagation();
                }
            }}
            onClick={event => {
                if (!isJumpModifierEvent(event)) {
                    return;
                }
                event.stopPropagation();
                link.open();
            }}
        >
            {props.children}
        </span>
    );
}
