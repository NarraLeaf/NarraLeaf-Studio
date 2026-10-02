/**
 * The plugin's own message bundle - every word the panel, the editor tab and the store show an
 * author, in the editor's language.
 *
 * Kept out of the entry files because the panel, the editor tab and the store all read it, and a
 * second copy would drift the moment either changed.
 *
 * Two kinds of word are deliberately not here:
 *
 *  - The blueprint nodes' own words (`Get Gallery`, `Kind`, the column names offered as Kind
 *    options) live with the nodes in `GALLERY_NODE_TRANSLATIONS`, because Studio draws the node
 *    cards from that table. The editor reads them from the same table through
 *    {@link galleryNodeWord}, so a step that names a node or an option reads exactly as the node
 *    does.
 *  - Row field names (`name`, `image`, `unlocked`, ...) are JSON keys an author types into
 *    `Get JSON Field`, and stay as written in every language.
 *
 * The `core*` entries name Studio's own nodes and pins in the idle inspector. A plugin has no way to
 * read Studio's catalogue, so they repeat its wording here; the test beside this file compares them
 * with the catalogue.
 *
 * The translator has no plural support, so a count that reads differently at one comes in a `One`
 * and a `Many` form and the caller picks.
 */

import { useEffect, useMemo, useState } from "react";
import type { PluginApp, PluginMessageBundle } from "narraleaf-studio/plugin";
import { GALLERY_NODE_TRANSLATIONS } from "./nodes";

const en = {
    title: "Gallery",
    entriesOne: "{count} entry",
    entriesMany: "{count} entries",
    itemsOne: "{count} item",
    itemsMany: "{count} items",

    openEditor: "Open gallery editor",
    openEditorShort: "Open editor",
    searchGallery: "Search gallery...",
    panelEmptyTitle: "Nothing yet",
    panelEmptyHint: "Open the editor to add CGs, recollections, music or voice.",
    noMatches: "No matches",
    noMatchesHint: "Try another search.",

    search: "Search",
    createCg: "Import CGs",
    createScene: "Add Recollection",
    createMusic: "Import Tracks",
    createVoice: "Add Voice Lines",
    lockedLook: "Locked look",
    lockedLookTitle: "How locked entries look in game",

    pickImportTracks: "Import tracks",
    pickAddDifferentials: "Add differentials",
    pickAddTracks: "Add tracks",
    pickCover: "Select cover",
    pickVariantImage: "Select image",
    pickLockedPlaceholder: "Select locked placeholder",
    pickDefaultPlaceholder: "Select default placeholder",
    pickAsset: "Select asset",

    nothingMatches: "Nothing matches",
    emptyCg: "No CG entries yet",
    emptyScene: "No recollection entries yet",
    emptyMusic: "No track or album entries yet",
    emptyVoice: "No voice set entries yet",

    groupAll: "All",
    ungrouped: "Ungrouped",
    newGroup: "New group",
    deleteGroup: "Delete group {name}",

    hiddenUntilUnlocked: "Hidden until unlocked",
    shownAsLockedSlot: "Shown as a locked slot",
    sceneSet: "Scene set",
    noScenePicked: "No scene picked",
    play: "Play",
    stop: "Stop",
    playFailed: "Could not play the clip: {error}",

    closeInspector: "Close inspector",
    pickImage: "Pick an image",
    fieldName: "Name",
    fieldDescription: "Description",
    descriptionPlaceholder: "Shown in the viewer once unlocked",
    fieldGroup: "Group",
    fieldLockedPlaceholder: "Locked placeholder",
    pick: "Pick",
    useCatalogDefault: "Use the catalog default",
    deleteEntry: "Delete entry",
    fieldStory: "Story",
    pickStory: "Pick a story",
    fieldScene: "Scene",
    pickScene: "Pick a scene",
    pickStoryFirst: "Pick a story first",
    listScenesFailed: "Could not list scenes: {error}",

    membersTracks: "Tracks ({count})",
    memberTrack: "Track",
    membersLines: "Lines ({count})",
    memberLine: "Line",
    membersDifferentials: "Differentials ({count})",
    memberImage: "Image",
    add: "Add",
    noLines: "No lines picked yet.",
    noTracks: "No tracks yet.",
    noImage: "No image yet.",
    changeImage: "Change image",
    clearCover: "Clear cover",
    useAsCover: "Use as cover",
    defaultCover: "Default cover (first)",
    delete: "Delete",

    selectedCount: "{count} selected",
    clearSelection: "Clear selection",
    moveToGroup: "Move to group",
    pickGroup: "Pick a group",
    deleteCount: "Delete {count}",

    addVoiceLinesTitle: "Add voice lines",
    searchLines: "Search lines...",
    loading: "Loading…",
    noVoice: "No recorded voice yet. Import takes in the Voice panel first.",
    narration: "Narration",
    added: "added",
    cancel: "Cancel",
    addCount: "Add {count}",

    defaultPlaceholder: "Default placeholder",
    clearPlaceholder: "Clear placeholder",
    lockedTitle: "Locked title",
    lockedTitleHint: "Empty shows the real title while locked.",
    done: "Done",

    defaultNameCg: "Artwork {index}",
    defaultNameScene: "Recollection {index}",
    defaultNameMusic: "Album {index}",
    defaultNameVoice: "Voice Set {index}",
    defaultNameVariant: "Variant {index}",
    defaultNameTrack: "Track {index}",
    defaultNameGroup: "Group {index}",

    idleEmpty: "Nothing selected",
    idleHeading: "To put this on a Page",
    idleSeparator: ", ",
    idleItemTemplate: "In the item template,",
    idleRowFields: "Row fields:",
    idleUnlockedBy: "Unlocked by:",
    unlockCg: "an Unlock Gallery node",
    unlockScene: "reaching the scene",
    unlockMusic: "playing the track",
    unlockVoice: "hearing the line",
    coreSetListContent: "Set List Content",
    coreGetListItemProps: "Get List Item Props",
    coreGetJsonField: "Get JSON Field",
    corePinEntries: "Entries",
};

export type GalleryMessageKey = keyof typeof en;

const zh: Record<GalleryMessageKey, string> = {
    title: "画廊",
    entriesOne: "{count} 个条目",
    entriesMany: "{count} 个条目",
    itemsOne: "{count} 项",
    itemsMany: "{count} 项",

    openEditor: "打开画廊编辑器",
    openEditorShort: "打开编辑器",
    searchGallery: "搜索画廊…",
    panelEmptyTitle: "暂无条目",
    panelEmptyHint: "在编辑器中添加 CG、回想、音乐或语音",
    noMatches: "无匹配结果",
    noMatchesHint: "请尝试其他搜索词",

    search: "搜索",
    createCg: "导入 CG",
    createScene: "添加回想",
    createMusic: "导入曲目",
    createVoice: "添加语音台词",
    lockedLook: "锁定外观",
    lockedLookTitle: "锁定条目在游戏中的外观",

    pickImportTracks: "导入曲目",
    pickAddDifferentials: "添加差分",
    pickAddTracks: "添加曲目",
    pickCover: "选择封面",
    pickVariantImage: "选择图片",
    pickLockedPlaceholder: "选择锁定占位图",
    pickDefaultPlaceholder: "选择默认占位图",
    pickAsset: "选择资产",

    nothingMatches: "无匹配条目",
    emptyCg: "暂无 CG 条目",
    emptyScene: "暂无回想条目",
    emptyMusic: "暂无曲目或专辑条目",
    emptyVoice: "暂无语音集条目",

    groupAll: "全部",
    ungrouped: "未分组",
    newGroup: "新建分组",
    deleteGroup: "删除分组“{name}”",

    hiddenUntilUnlocked: "解锁前隐藏",
    shownAsLockedSlot: "以锁定格位显示",
    sceneSet: "已指定场景",
    noScenePicked: "未指定场景",
    play: "播放",
    stop: "停止",
    playFailed: "无法播放该音频：{error}",

    closeInspector: "关闭检查器",
    pickImage: "选择图片",
    fieldName: "名称",
    fieldDescription: "描述",
    descriptionPlaceholder: "解锁后在查看器中显示",
    fieldGroup: "分组",
    fieldLockedPlaceholder: "锁定占位图",
    pick: "选择",
    useCatalogDefault: "使用默认占位图",
    deleteEntry: "删除条目",
    fieldStory: "故事",
    pickStory: "选择故事",
    fieldScene: "场景",
    pickScene: "选择场景",
    pickStoryFirst: "请先选择故事",
    listScenesFailed: "无法列出场景：{error}",

    membersTracks: "曲目（{count}）",
    memberTrack: "曲目",
    membersLines: "台词（{count}）",
    memberLine: "台词",
    membersDifferentials: "差分（{count}）",
    memberImage: "图片",
    add: "添加",
    noLines: "尚未选择台词",
    noTracks: "暂无曲目",
    noImage: "暂无图片",
    changeImage: "更换图片",
    clearCover: "取消封面",
    useAsCover: "设为封面",
    defaultCover: "默认封面（首项）",
    delete: "删除",

    selectedCount: "已选择 {count} 项",
    clearSelection: "清除选择",
    moveToGroup: "移至分组",
    pickGroup: "选择分组",
    deleteCount: "删除 {count} 项",

    addVoiceLinesTitle: "添加语音台词",
    searchLines: "搜索台词…",
    loading: "正在加载…",
    noVoice: "暂无已录制的语音，请先在配音面板中导入录音",
    narration: "旁白",
    added: "已添加",
    cancel: "取消",
    addCount: "添加 {count} 项",

    defaultPlaceholder: "默认占位图",
    clearPlaceholder: "清除占位图",
    lockedTitle: "锁定时的标题",
    lockedTitleHint: "留空时，锁定状态下显示真实标题",
    done: "完成",

    defaultNameCg: "CG {index}",
    defaultNameScene: "回想 {index}",
    defaultNameMusic: "专辑 {index}",
    defaultNameVoice: "语音集 {index}",
    defaultNameVariant: "差分 {index}",
    defaultNameTrack: "曲目 {index}",
    defaultNameGroup: "分组 {index}",

    idleEmpty: "未选择",
    idleHeading: "在页面中显示",
    idleSeparator: "，",
    idleItemTemplate: "在项模板中",
    idleRowFields: "行字段：",
    idleUnlockedBy: "解锁条件：",
    unlockCg: "「解锁画廊条目」节点",
    unlockScene: "进入该场景",
    unlockMusic: "播放该曲目",
    unlockVoice: "播放该台词",
    coreSetListContent: "设置列表内容",
    coreGetListItemProps: "获取列表项属性",
    coreGetJsonField: "获取 JSON 字段",
    corePinEntries: "条目",
};

/** Only the wording that predates the rest; every other key reads in English. */
const ja: Partial<Record<GalleryMessageKey, string>> = {
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
};

export const GALLERY_MESSAGES: PluginMessageBundle = {
    messages: { en, zh, ja: ja as Record<string, string> },
    fallbackLocale: "en",
};

/**
 * The plugin's translator, seen through the bundle's own keys so a misspelt key fails to compile.
 * Every `PluginTranslator` is one: it accepts any key.
 */
export type GalleryTranslator = {
    readonly locale: string;
    t(key: GalleryMessageKey, params?: Record<string, string | number>): string;
};

/** A translator for code outside React - the entry and the store. */
export function createGalleryTranslator(app: PluginApp): GalleryTranslator {
    return app.services.i18n.createTranslator(GALLERY_MESSAGES);
}

/**
 * One of the blueprint nodes' own words - a node title, a pin or an option - as the node card draws
 * it in the editor's language. English when the language has no table.
 */
export function galleryNodeWord(tr: GalleryTranslator, english: string): string {
    return GALLERY_NODE_TRANSLATIONS[tr.locale]?.[english] ?? english;
}

/**
 * A translator that follows the editor's language while a component is mounted.
 *
 * `createTranslator` resolves against the live locale on every `.t()`, so the subscription here is
 * only what makes React ask again; the translator instance itself never has to be replaced.
 */
export function useGalleryTranslator(app: PluginApp): GalleryTranslator {
    const translator = useMemo(() => createGalleryTranslator(app), [app]);
    const [, setLocale] = useState(app.services.i18n.locale);
    useEffect(() => {
        const cleanup = app.services.i18n.onLocaleChange(next => setLocale(next));
        return () => {
            void cleanup();
        };
    }, [app]);
    return translator;
}
