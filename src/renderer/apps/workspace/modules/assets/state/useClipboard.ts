import { useState } from 'react';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';

export interface ClipboardState {
    type: "copy" | "cut";
    assets: Asset[];
    groups: AssetGroup[];
}

export function useClipboard() {
    const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

    return {
        clipboard,
        setClipboard,
    };
}
