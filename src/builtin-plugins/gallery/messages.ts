/**
 * The plugin's own message bundle.
 *
 * Kept out of both entry files because the studio entry names the panel and the editor tab uses
 * the same bundle for the idle inspector, and a second copy would drift the moment either changed.
 *
 * Deliberately narrow: node names, row field names and the Kind values are what the blueprint
 * inspector shows and are not translated here, so a step that names one reads the same in the
 * editor as it does on the node.
 *
 * `title` is translated because "Gallery" here is the VN feature (the unlockable CG wall) and not
 * a brand, and left in English it read as a stray sitting between 本地化 and 配音 in the rail's
 * overflow menu.
 */

import { useEffect, useMemo, useState } from "react";
import type { PluginApp, PluginTranslator } from "narraleaf-studio/plugin";

export const GALLERY_MESSAGES = {
    messages: {
        en: {
            title: "Gallery",
            idleEmpty: "Nothing selected",
            idleHeading: "To put this on a Page",
            idleItemTemplate: "In the item template,",
            idleRowFields: "Row fields:",
            idleUnlockedBy: "Unlocked by:",
            unlockCg: "an Unlock Gallery node",
            unlockScene: "reaching the scene",
            unlockMusic: "playing the track",
            unlockVoice: "hearing the line",
        },
        ja: {
            title: "ギャラリー",
            idleEmpty: "未選択",
            idleHeading: "ページに配置する手順",
            idleItemTemplate: "アイテムテンプレートで",
            idleRowFields: "行のフィールド：",
            idleUnlockedBy: "解除条件：",
            unlockCg: "Unlock Gallery ノード",
            unlockScene: "該当シーンへの到達",
            unlockMusic: "該当トラックの再生",
            unlockVoice: "該当セリフの再生",
        },
        zh: {
            title: "画廊",
            idleEmpty: "未选择",
            idleHeading: "放到页面上的步骤",
            idleItemTemplate: "在条目模板中",
            idleRowFields: "行字段：",
            idleUnlockedBy: "解锁条件：",
            unlockCg: "Unlock Gallery 节点",
            unlockScene: "进入该场景",
            unlockMusic: "播放该曲目",
            unlockVoice: "听到该台词",
        },
    },
    fallbackLocale: "en",
};

/**
 * A translator that follows the editor's language while a component is mounted.
 *
 * `createTranslator` resolves against the live locale on every `.t()`, so the subscription here is
 * only what makes React ask again; the translator instance itself never has to be replaced.
 */
export function useGalleryTranslator(app: PluginApp): PluginTranslator {
    const translator = useMemo(() => app.services.i18n.createTranslator(GALLERY_MESSAGES), [app]);
    const [, setLocale] = useState(app.services.i18n.locale);
    useEffect(() => {
        const cleanup = app.services.i18n.onLocaleChange(next => setLocale(next));
        return () => {
            void cleanup();
        };
    }, [app]);
    return translator;
}
