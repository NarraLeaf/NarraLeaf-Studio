type DevModeDesignSize = {
    width: number;
    height: number;
};

type DevModeGameViewport = DevModeDesignSize | null | undefined;

function isUsableSize(size: DevModeGameViewport): size is DevModeDesignSize {
    return Boolean(
        size &&
        Number.isFinite(size.width) &&
        Number.isFinite(size.height) &&
        size.width > 0 &&
        size.height > 0,
    );
}

export function resolveDevModeViewportSize(input: {
    activeSurfaceDesignSize: DevModeDesignSize;
    gameViewport?: DevModeGameViewport;
}): DevModeDesignSize {
    return isUsableSize(input.gameViewport) ? input.gameViewport : input.activeSurfaceDesignSize;
}
