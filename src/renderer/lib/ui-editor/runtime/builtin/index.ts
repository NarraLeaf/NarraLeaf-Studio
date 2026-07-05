import { createElement, Fragment } from "react";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import { ContainerRenderer } from "@/lib/ui-editor/widget-modules/builtin/container/renderer";
import { TextRenderer } from "@/lib/ui-editor/widget-modules/builtin/text/renderer";
import { ImageRenderer } from "@/lib/ui-editor/widget-modules/builtin/image/renderer";
import { ButtonRenderer } from "@/lib/ui-editor/widget-modules/builtin/button/renderer";
import { ListRenderer } from "@/lib/ui-editor/widget-modules/builtin/list/renderer";
import { FrameRenderer } from "@/lib/ui-editor/widget-modules/builtin/frame/renderer";
import { SliderRenderer } from "@/lib/ui-editor/widget-modules/builtin/slider/renderer";
import { DialogSentenceRenderer } from "@/lib/ui-editor/widget-modules/builtin/dialog/renderer";
import { NvlTextsRenderer } from "@/lib/ui-editor/widget-modules/builtin/nvl/renderer";
import type { ElementRendererDefinition } from "../ElementRendererRegistry";

/**
 * Runtime-only built-in renderers shared by Dev Mode and packaged Preview.
 *
 * Keep this registry away from full widget modules: those include inspector, docker bar,
 * insert-palette, and other authoring-only Studio UI.
 */
export const BuiltinElementRenderers: ElementRendererDefinition[] = [
    {
        type: "nl.root",
        render: ({ children }) => createElement(Fragment, null, children),
    },
    {
        type: "nl.container",
        render: props => createElement(ContainerRenderer, props),
    },
    {
        type: "nl.text",
        render: props => createElement(TextRenderer, props),
    },
    {
        type: "nl.image",
        render: props => createElement(ImageRenderer, props),
    },
    {
        type: "nl.button",
        render: props => createElement(ButtonRenderer, props),
    },
    {
        type: "nl.slider",
        render: props => createElement(SliderRenderer, props),
    },
    {
        type: "nl.list",
        render: props => createElement(ListRenderer, props),
    },
    {
        type: UI_FRAME_ELEMENT_TYPE,
        render: props => createElement(FrameRenderer, props),
    },
    {
        type: "nl.dialog.sentence",
        render: props => createElement(DialogSentenceRenderer, props),
    },
    {
        type: "nl.notification.list",
        render: props => createElement(ListRenderer, props),
    },
    {
        type: "nl.choice.list",
        render: props => createElement(ListRenderer, props),
    },
    {
        type: "nl.nvl.list",
        render: props => createElement(ListRenderer, props),
    },
    {
        type: "nl.nvl.texts",
        render: props => createElement(NvlTextsRenderer, props),
    },
];
