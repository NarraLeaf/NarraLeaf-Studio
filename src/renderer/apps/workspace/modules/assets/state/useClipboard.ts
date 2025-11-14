import { useState, useCallback } from 'react';
import { Asset } from '@/lib/workspace/services/assets/types';

export interface ClipboardState {
    type: "copy" | "cut";
    assets: Asset[];
}

export function useClipboard() {
    const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

    return {
        clipboard,
        setClipboard,
    };
}
