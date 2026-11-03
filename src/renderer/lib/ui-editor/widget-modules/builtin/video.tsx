import type { UIWidgetModule, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import { VideoRenderer } from "./video/renderer";
import { createVideoInspector } from "./video/inspector";
import { createVideoDockerBarItems, createVideoMultiSelectDockerBarItems } from "./video/dockerBar";
import { defineWidgetModule } from "../declaration";
import { VideoWidgetDeclaration } from "./video.declaration";

export const VideoWidgetModule: UIWidgetModule = defineWidgetModule(VideoWidgetDeclaration, {
    render: (props: WidgetRendererProps) => <VideoRenderer {...props}/>,
    createInspector: createVideoInspector,
    createDockerBarItems: createVideoDockerBarItems,
    createMultiSelectDockerBarItems: createVideoMultiSelectDockerBarItems
});
