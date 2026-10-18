import {
    AppWindow,
    Box,
    Braces,
    Bug,
    Clock,
    Component,
    Database,
    Film,
    Frame,
    Gamepad2,
    Globe,
    History as HistoryIcon,
    Image as ImageIcon,
    Images,
    Keyboard,
    Languages,
    LayoutGrid,
    List,
    Map as MapIcon,
    Mic,
    MousePointer2,
    Puzzle,
    Route,
    Sigma,
    SlidersHorizontal,
    SquareDashed,
    SquareFunction,
    SquareMousePointer,
    TextCursorInput,
    ToggleRight,
    Type as TypeIcon,
    Variable,
    Volume2,
    Zap,
    type LucideIcon,
} from "lucide-react";
import { BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID, BLUEPRINT_ADD_NODE_FIELDS_CATEGORY_ID } from "./BlueprintAddNodeMenuModel";

export type BlueprintCategoryVisual = {
    icon: LucideIcon;
    color: string;
};

/** The colour every widget's own category is drawn in: the icon tells them apart, the colour says "a widget". */
const WIDGET_COLOR = "#7fb7c9";
/** The project accent, for the two categories about the author's own building blocks. */
const ACCENT_COLOR = "var(--narraleaf-accent, #40a8c4)";

/**
 * Each palette category's icon, which its chip and every row in it are drawn with.
 *
 * One icon per category, and a different one for each: the chips are how an author finds a kind
 * of node across a few hundred, and a row of identical icons said nothing. The table is keyed by
 * the catalogue's category ids; a category a plugin brings is not in it and is drawn with the
 * plugin icon, so a missing built-in entry is caught by the test rather than by that fallback.
 */
const CATEGORY_VISUALS: Readonly<Record<string, BlueprintCategoryVisual>> = {
    [BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID]: { icon: LayoutGrid, color: "#a8adb5" },
    [BLUEPRINT_ADD_NODE_FIELDS_CATEGORY_ID]: { icon: Braces, color: "#96b8a0" },
    Events: { icon: Zap, color: "#d9b36a" },
    Flow: { icon: Route, color: "#8fa9c7" },
    Functions: { icon: SquareFunction, color: "#a9b4d9" },
    Data: { icon: Database, color: "#96b8a0" },
    Math: { icon: Sigma, color: "#b2a6c9" },
    Variables: { icon: Variable, color: "#8fb3d9" },
    App: { icon: AppWindow, color: "#8fb8c7" },
    Game: { icon: Gamepad2, color: "#c7a98f" },
    Input: { icon: Keyboard, color: "#d9b36a" },
    Sound: { icon: Volume2, color: "#a3c4a0" },
    Voice: { icon: Mic, color: "#b7a6c9" },
    Time: { icon: Clock, color: "#9fb7c7" },
    Localization: { icon: Languages, color: "#8fc7b5" },
    Network: { icon: Globe, color: "#8fb8c7" },
    Gallery: { icon: Images, color: "#c7b38f" },
    Debug: { icon: Bug, color: "#bd97a3" },
    Element: { icon: MousePointer2, color: "#d9b36a" },
    Displayable: { icon: Box, color: "#b9c47a" },
    Component: { icon: Component, color: ACCENT_COLOR },
    Text: { icon: TypeIcon, color: "#8fc7b5" },
    Button: { icon: SquareMousePointer, color: WIDGET_COLOR },
    Container: { icon: SquareDashed, color: WIDGET_COLOR },
    Frame: { icon: Frame, color: WIDGET_COLOR },
    Image: { icon: ImageIcon, color: WIDGET_COLOR },
    List: { icon: List, color: WIDGET_COLOR },
    Slider: { icon: SlidersHorizontal, color: WIDGET_COLOR },
    Switch: { icon: ToggleRight, color: WIDGET_COLOR },
    "Text Input": { icon: TextCursorInput, color: WIDGET_COLOR },
    Video: { icon: Film, color: WIDGET_COLOR },
    // Categories no built-in node is filed under any more, kept so a plugin that still names one is
    // drawn as it was.
    Navigation: { icon: MapIcon, color: "#7ec7c1" },
    Backlog: { icon: HistoryIcon, color: "#c7a98f" },
    Widget: { icon: Box, color: ACCENT_COLOR },
};

const PLUGIN_CATEGORY_VISUAL: BlueprintCategoryVisual = { icon: Puzzle, color: "#9aa3ad" };

export function getBlueprintCategoryVisual(categoryId: string): BlueprintCategoryVisual {
    return CATEGORY_VISUALS[categoryId] ?? PLUGIN_CATEGORY_VISUAL;
}

/** Whether a category has an icon of its own, rather than the one every plugin category shares. */
export function hasOwnBlueprintCategoryVisual(categoryId: string): boolean {
    return Object.prototype.hasOwnProperty.call(CATEGORY_VISUALS, categoryId);
}
