export type SurfaceTransitionHoldInput = {
    waitForExit: boolean;
    hasCurrentSurface: boolean;
    exitDurationMs: number;
    enterDurationMs: number;
    outgoingHidden?: boolean;
    incomingHidden?: boolean;
};

export function shouldHoldCurrentSurfaceUntilEnterComplete(input: SurfaceTransitionHoldInput): boolean {
    return (
        !input.waitForExit &&
        input.hasCurrentSurface &&
        input.outgoingHidden !== true &&
        input.incomingHidden !== true &&
        input.exitDurationMs <= 0 &&
        input.enterDurationMs > 0
    );
}
