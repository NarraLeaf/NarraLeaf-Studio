import * as React from "react";
import { ErrorFallbackProps } from "./errorHandling";

export type ErrorBoundaryProps = {
    children: React.ReactNode;
    fallback?: React.ComponentType<ErrorFallbackProps> | null;
    /**
     * Told about every error this boundary catches, before the fallback renders.
     *
     * For reporting only. A boundary that swallows a failure without recording it is how a bug
     * becomes "it went blank sometimes", so every boundary should pass one.
     */
    onError?: (error: Error, info: { componentStack: string }) => void;
};

export type ErrorBoundaryState = {
    hasError: boolean;
    /** Handed to the fallback: a screen that cannot name the failure cannot pass it on. */
    error: Error | null;
};

export class ErrorBoundary<TProps extends ErrorBoundaryProps = ErrorBoundaryProps>
    extends React.Component<TProps, ErrorBoundaryState> {
    constructor(props: TProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(
        error: Error,
    ): ErrorBoundaryState {
        return { hasError: true, error };
    }

    /**
     * Handle error behavior. Can be overridden by subclasses to customize error handling.
     * @param error - The error that was caught
     * @param info - React error boundary info containing component stack
     * @protected
     */
    protected handleError(
        error: Error,
        info: {
            componentStack: string;
        }
    ): void {
        this.props.onError?.(error, info);
    }

    componentDidCatch(
        error: Error,
        info: {
            componentStack: string;
        }
    ) {
        this.handleError(error, info);
    }

    render() {
        if (this.state.hasError) {
            const FallbackComponent = this.props.fallback as React.ComponentType<ErrorFallbackProps>;
            if (!FallbackComponent) {
                return null;
            }

            return <FallbackComponent error={this.state.error ?? undefined} />;
        }

        return this.props.children;
    }
}
