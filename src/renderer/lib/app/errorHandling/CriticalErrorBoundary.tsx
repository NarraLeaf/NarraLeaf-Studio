import { PlatformInfo } from "@shared/types/os";
import { ErrorBoundary, ErrorBoundaryProps } from "./ErrorBoundary";
import { getInterface } from "../bridge";

export interface CriticalErrorBoundaryProps extends ErrorBoundaryProps {
    children: React.ReactNode;
    initialTimestamp?: number;
    platformInfo: PlatformInfo;
};

export class CriticalErrorBoundary<T extends CriticalErrorBoundaryProps> extends ErrorBoundary<T> {
    constructor(props: T) {
        super(props);
    }

    protected handleError(error: Error): void {
        getInterface().terminate(error.message + "\n" + (error.stack ?? ""));
    }
}
