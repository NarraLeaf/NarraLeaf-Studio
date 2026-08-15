import * as React from "react";
import { PlatformInfo } from "@shared/types/os";
import { AppCrashScreen } from "./AppCrashScreen";
import { ErrorBoundary, ErrorBoundaryProps } from "./ErrorBoundary";
import { reportRendererError } from "./crashRecovery";
import { getInterface } from "../bridge";

export interface CriticalErrorBoundaryProps extends ErrorBoundaryProps {
    children: React.ReactNode;
    initialTimestamp?: number;
    platformInfo: PlatformInfo;
};

/**
 * The boundary at the root of every window.
 *
 * It used to end the application: any render error anywhere in any window asked the main process
 * to terminate, so one bad component closed every open project, unsaved work included. A render
 * error is a bug in one window's tree, not evidence that the process is unusable, so it now
 * reports the failure and shows {@link AppCrashScreen} instead, and the window is one reload away
 * from working again.
 *
 * Terminating is kept for the one case that still deserves it: the crash screen itself failing.
 * React does not route a fallback's own error back to the boundary that rendered it, so the screen
 * is wrapped in a plain boundary whose job is to notice that and take the old path - a window left
 * blank and silent would be strictly worse than the error box.
 */
export class CriticalErrorBoundary<T extends CriticalErrorBoundaryProps> extends ErrorBoundary<T> {
    constructor(props: T) {
        super(props);
        this.handleCrashScreenFailure = this.handleCrashScreenFailure.bind(this);
    }

    protected handleError(error: Error, info: { componentStack: string }): void {
        reportRendererError({
            source: "boundary",
            error,
            componentStack: info.componentStack,
        });
    }

    private handleCrashScreenFailure(error: Error, info: { componentStack: string }): void {
        const message = `${error.message}\n${error.stack ?? ""}\n${info.componentStack}`;
        console.error(message);
        getInterface().terminate(message);
    }

    render() {
        const { error, hasError } = this.state;
        if (!hasError) {
            return this.props.children;
        }

        return (
            <ErrorBoundary onError={this.handleCrashScreenFailure}>
                <AppCrashScreen error={error ?? new Error("Unknown rendering error")} />
            </ErrorBoundary>
        );
    }
}
