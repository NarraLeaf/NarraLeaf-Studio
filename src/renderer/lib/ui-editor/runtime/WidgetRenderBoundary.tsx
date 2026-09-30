import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { renderWidgetRenderFailureContent } from "./unknownWidgetTypeUi";

type WidgetRenderBoundaryProps = { type: string; children?: ReactNode };

/**
 * The blast radius of a plugin's widget renderer.
 *
 * A plugin's `render` runs inside the host's own React tree - the editor canvas in Studio, the
 * game's surface tree when it ships - so a throw in it is, by default, a throw in the surface
 * being drawn: React unmounts the tree up to the nearest boundary, and without one that is the
 * whole window. One widget written badly would take the page it sits on with it, and in the editor
 * the author would lose the canvas rather than the widget.
 *
 * So every plugin renderer is drawn behind this. What is caught is what React catches - a throw
 * during render, in a lifecycle method, or in a constructor - which is the failure mode that
 * actually costs the host the tree; an async failure inside the plugin's own effects is the
 * plugin's to handle, exactly as it is for the host's own widgets.
 *
 * The element keeps its place and its data. What the author sees is the same block a type with no
 * renderer at all draws, naming the widget type - the part that says which plugin is at fault -
 * and the error is written to the console, where a plugin author debugging their own widget is
 * already looking.
 *
 * Recovery is by remount: the boundary keys itself on nothing, so a fixed plugin comes back when
 * the registry change re-renders the surface. Retrying in place would loop on a renderer that
 * throws every time.
 */
export class WidgetRenderBoundary extends Component<WidgetRenderBoundaryProps, { failed: boolean }> {
    public constructor(props: WidgetRenderBoundaryProps) {
        super(props);
        this.state = { failed: false };
    }

    public static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    public componentDidCatch(error: Error, info: ErrorInfo): void {
        if (typeof console !== "undefined" && console.error) {
            console.error(
                `[UI Editor] Widget "${this.props.type}" failed to render:`,
                error,
                info.componentStack,
            );
        }
    }

    public render(): ReactNode {
        if (this.state.failed) {
            return renderWidgetRenderFailureContent(this.props.type);
        }
        return this.props.children;
    }
}
