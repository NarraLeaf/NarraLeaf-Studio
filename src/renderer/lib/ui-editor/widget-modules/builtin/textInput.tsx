import { TextCursorInput } from "lucide-react";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { translate } from "@/lib/i18n";
import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { createInitialButtonAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { TextInputRenderer } from "./textInput/renderer";
import { createTextInputInspector } from "./textInput/inspector";
import { defaultTextInputElementProps, textInputButtonBaselineProps } from "./textInput/helpers";
import { formatBrandLink } from "@shared/brand/brandLink";

/**
 * The colours a *newly created* text input starts with - links into the project palette.
 *
 * Kept out of `defaultTextInputElementProps` on purpose: that is the read-time fallback shared with
 * every text input already in every project, and a link there would restyle fields whose author
 * never picked a colour. See `button.tsx` for the argument in full.
 */
const BRANDED_TEXT_INPUT_COLORS = {
  backgroundColor: formatBrandLink("textInput.background"),
  borderColor: formatBrandLink("textInput.border"),
  color: formatBrandLink("textInput.text")
} as const;

export const TextInputWidgetModule: UIWidgetModule = {
  type: "nl.textInput",
  logicApi: getWidgetLogicApi("nl.textInput"),
  get displayName() {
    return translate("widgets.defaults.textInput.name");
  },
  icon: TextCursorInput,

  createDefaultElement: () => {
    const props = { ...defaultTextInputElementProps, ...BRANDED_TEXT_INPUT_COLORS };
    return {
      type: "nl.textInput",
      name: translate("widgets.defaults.textInput.name"),
      layout: {
        x: 0,
        y: 0,
        width: 220,
        height: 40,
        opacity: 1,
        visible: true
      },
      // No baked placeholder: it is player-facing text, so it stays empty until the author writes
      // one (and, if the game ships localized, attaches a localization key to it).
      props: {
        ...props,
        appearance: createInitialButtonAppearance(textInputButtonBaselineProps(props))
      }
    };
  },

  render: (props: WidgetRendererProps) => <TextInputRenderer {...props} />,

  createInspector: createTextInputInspector
};
