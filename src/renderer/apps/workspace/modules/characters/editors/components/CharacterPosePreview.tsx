import { useEffect, useState, type ComponentProps } from "react";
import type { CharacterFrameSequence } from "@shared/types/character/frameSequence";
import { LayerStackPreview } from "./LayerStackPreview";

export function CharacterPosePreview({
    sequence,
    ...props
}: ComponentProps<typeof LayerStackPreview> & { sequence?: CharacterFrameSequence }) {
    const [index, setIndex] = useState(0);
    useEffect(() => {
        setIndex(0);
        if (!sequence) return;
        const start = performance.now();
        let request: number;
        const tick = (now: number) => {
            const frame = Math.floor(((now - start) * sequence.fps) / 1000);
            setIndex(
                sequence.loop
                    ? frame % sequence.frameAssetIds.length
                    : Math.min(frame, sequence.frameAssetIds.length - 1),
            );
            request = requestAnimationFrame(tick);
        };
        request = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(request);
    }, [sequence]);
    const assetId = sequence?.frameAssetIds[index] ?? sequence?.frameAssetIds[0];
    return (
        <LayerStackPreview
            {...props}
            layers={assetId && props.layers[0] ? [{ ...props.layers[0], assetId }] : props.layers}
        />
    );
}
