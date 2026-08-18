/**
 * `Get App Tag` - which edition of the project this package is.
 *
 * The one node in the catalogue whose value is decided before the game exists. A build produces one
 * variant, `@shared/blueprint/appTagGraphFold` substitutes that variant's name here, folds whatever
 * comparison consumes it, and deletes the branch this edition does not take - so the content behind
 * a variant check is *absent* from the package rather than merely unreachable in it. A graph whose
 * `Get App Tag` does not end up deciding a branch is refused at the build gate, in every build
 * including the release one: there is no play-time value to fall back on, so such a graph is not a
 * leak to tolerate, it is one that cannot be compiled.
 *
 * That is also why the node takes nothing and offers no inspector field. Anything it could be given
 * would be a second input to a question that already has one answer, and a parameter the fold would
 * then have to reason about.
 *
 * Comments in English per project convention.
 */

import { BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG } from "@shared/types/blueprint/graph";
import type { BlueprintNodeDef } from "../types";

/** The pin the variant name comes out of. Shared with the fold, which reads this exact id. */
export const BLUEPRINT_APP_TAG_OUTPUT_PIN_ID = "appTag";

export const appTagBlueprintNodes: BlueprintNodeDef[] = [
  {
    type: BLUEPRINT_NODE_TYPE_GAME_GET_APP_TAG,
    displayName: "Get Build Variant",
    category: "Game",
    keywords: ["app", "tag", "variant", "edition", "build", "demo", "release", "main"],
    graphKinds: ["event", "function", "macro"],
    // Pure and non-latent for the reason the visited readers are: a function graph refuses any
    // node that is either, and a variant check has to be available there too.
    isPure: true,
    isLatent: false,
    pins: [
      {
        id: BLUEPRINT_APP_TAG_OUTPUT_PIN_ID,
        kind: "output",
        semantic: "data",
        valueType: "string",
        label: "Build Variant"
      }
    ],
    // Never reached on the data path - a pure node's output is pulled through
    // `resolveDataPinValue`, not by running this. See `resolveAppTagNodeOutput`.
    execute: () => ({})
  }
];
