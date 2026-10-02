/**
 * The plugin's own message bundle: every word the Gallery panel, editor tab and store put on screen,
 * in the three languages Studio speaks.
 *
 * Kept out of the entry files because the panel, the editor tab and the store all read it, and a
 * second copy would drift the moment either changed.
 *
 * Two kinds of word are deliberately not here:
 *
 *  - The blueprint nodes' own words live with the nodes in `GALLERY_NODE_TRANSLATIONS`, because
 *    Studio draws the node cards from that table. Some of them are this interface's words too: the
 *    `Gallery` category is the panel's title ({@link galleryTitle}), the `Kind` values are the
 *    column names ({@link galleryKindLabel}), and the idle inspector names `Get Gallery`, `Kind`
 *    and `Unlock Gallery`. All of them are read from that table through {@link galleryNodeWord},
 *    so they read exactly as the card does.
 *  - Row field names (`name`, `image`, `unlocked`, ...) are JSON keys an author types into
 *    `Get JSON Field`, and stay as written in every language.
 *
 * The `core*` entries name Studio's own nodes and pins in the idle inspector. A plugin cannot read
 * Studio's catalogue, so they repeat its wording here; the test beside this file compares them with
 * the catalogue in every language.
 *
 * The plugin translator has no plural forms, so a count that reads differently at one is two keys,
 * `...One` and `...Many`, and {@link galleryCount} picks; zh and ja write both the same.
 *
 * Default names (`default*`) are written into the project when an entry, track or group is created,
 * so they are in the language the author is working in, the way Studio's own new pages are.
 */

import { useEffect, useMemo, useState } from "react";
import type { PluginApp, PluginMessageBundle } from "narraleaf-studio/plugin";
import type { GalleryEntryKind } from "./catalog";
import { GALLERY_CATEGORY, GALLERY_KIND_LABELS, GALLERY_NODE_TRANSLATIONS } from "./nodes";

const en = {
    entryCountOne: "{count} entry",
    entryCountMany: "{count} entries",
    itemCountOne: "{count} item",
    itemCountMany: "{count} items",
    selectedCount: "{count} selected",
    openEditor: "Open gallery editor",
    openEditorButton: "Open editor",
    searchGallery: "Search gallery…",
    search: "Search",
    panelEmptyTitle: "Nothing yet",
    panelEmptyDetail: "Open the editor to add CGs, recollections, music or voice.",
    noMatches: "No matches",
    noMatchesDetail: "Try another search.",

    createCg: "Import CGs",
    createScene: "Add Recollection",
    createMusic: "Import Tracks",
    createVoice: "Add Voice Lines",
    emptyCg: "No CG entries yet",
    emptyScene: "No recollections yet",
    emptyMusic: "No tracks or albums yet",
    emptyVoice: "No voice sets yet",

    lockedLook: "Locked look",
    lockedLookTitle: "How locked entries look in game",
    defaultPlaceholder: "Default placeholder",
    clearPlaceholder: "Clear placeholder",
    lockedTitle: "Locked title",
    lockedTitleHint: "Empty shows the real title while locked.",
    done: "Done",

    groupAll: "All",
    groupUngrouped: "Ungrouped",
    groupNew: "New group",
    groupDelete: "Delete group {name}",

    hiddenUntilUnlocked: "Hidden until unlocked",
    shownAsLockedSlot: "Shown as a locked slot",
    sceneSet: "Scene set",
    noScenePicked: "No scene picked",
    play: "Play",
    stop: "Stop",

    closeInspector: "Close inspector",
    fieldName: "Name",
    fieldDescription: "Description",
    descriptionPlaceholder: "Shown in the viewer once unlocked",
    fieldGroup: "Group",
    fieldStory: "Story",
    fieldScene: "Scene",
    fieldLockedPlaceholder: "Locked placeholder",
    pickStory: "Pick a story",
    pickScene: "Pick a scene",
    pickStoryFirst: "Pick a story first",
    pickGroup: "Pick a group",
    pickImage: "Pick an image",
    pick: "Pick",
    useCatalogDefault: "Use the catalog default",
    deleteEntry: "Delete entry",
    moveToGroup: "Move to group",
    clearSelection: "Clear selection",
    deleteSelected: "Delete {count}",
    listScenesFailed: "Could not list scenes: {error}",
    playFailed: "Could not play the clip: {error}",

    membersTrack: "Track",
    membersTracks: "Tracks ({count})",
    membersLine: "Line",
    membersLines: "Lines ({count})",
    membersImage: "Image",
    membersDifferentials: "Differentials ({count})",
    add: "Add",
    noLines: "No lines picked yet.",
    noTracks: "No tracks yet.",
    noImage: "No image yet.",
    changeImage: "Change image",
    useAsCover: "Use as cover",
    clearCover: "Clear cover",
    defaultCover: "Default cover (first)",
    delete: "Delete",

    voicePickerTitle: "Add voice lines",
    searchLines: "Search lines…",
    loading: "Loading…",
    noRecordedVoice: "No recorded voice yet. Import takes in the Voice panel first.",
    narration: "Narration",
    alreadyAdded: "added",
    cancel: "Cancel",
    addCount: "Add {count}",

    pickerImportTracks: "Import tracks",
    pickerAddDifferentials: "Add differentials",
    pickerAddTracks: "Add tracks",
    pickerCover: "Select cover",
    pickerImage: "Select image",
    pickerLockedPlaceholder: "Select locked placeholder",
    pickerDefaultPlaceholder: "Select default placeholder",
    pickerAsset: "Select asset",

    idleEmpty: "Nothing selected",
    idleHeading: "To put this on a Page",
    idleSeparator: ", ",
    idleItemTemplate: "In the item template,",
    idleRowFields: "Row fields:",
    idleUnlockedBy: "Unlocked by:",
    unlockCg: "an {node} node",
    unlockScene: "reaching the scene",
    unlockMusic: "playing the track",
    unlockVoice: "hearing the line",
    coreSetListContent: "Set List Content",
    coreGetListItemProps: "Get List Item Props",
    coreGetJsonField: "Get JSON Field",
    corePinEntries: "Entries",

    defaultCg: "Artwork {n}",
    defaultScene: "Recollection {n}",
    defaultMusic: "Album {n}",
    defaultVoice: "Voice Set {n}",
    defaultVariant: "Variant {n}",
    defaultTrack: "Track {n}",
    defaultGroup: "Group {n}",
};

/** Every key of the bundle, so a key that is not in it fails to compile instead of printing itself. */
export type GalleryMessageKey = keyof typeof en;

const zh: Record<GalleryMessageKey, string> = {
    entryCountOne: "{count} 个条目",
    entryCountMany: "{count} 个条目",
    itemCountOne: "{count} 项",
    itemCountMany: "{count} 项",
    selectedCount: "已选择 {count} 项",
    openEditor: "打开画廊编辑器",
    openEditorButton: "打开编辑器",
    searchGallery: "搜索画廊…",
    search: "搜索",
    panelEmptyTitle: "暂无条目",
    panelEmptyDetail: "在编辑器中添加 CG、回想、音乐或配音",
    noMatches: "未找到匹配项",
    noMatchesDetail: "请尝试其他搜索词",

    createCg: "导入 CG",
    createScene: "添加回想",
    createMusic: "导入曲目",
    createVoice: "添加配音",
    emptyCg: "暂无 CG 条目",
    emptyScene: "暂无回想",
    emptyMusic: "暂无曲目或专辑",
    emptyVoice: "暂无配音集",

    lockedLook: "未解锁外观",
    lockedLookTitle: "未解锁条目在游戏中的外观",
    defaultPlaceholder: "默认占位图",
    clearPlaceholder: "清除占位图",
    lockedTitle: "未解锁时的标题",
    lockedTitleHint: "留空时，未解锁状态下显示实际标题",
    done: "完成",

    groupAll: "全部",
    groupUngrouped: "未分组",
    groupNew: "新建分组",
    groupDelete: "删除分组“{name}”",

    hiddenUntilUnlocked: "解锁前隐藏",
    shownAsLockedSlot: "显示为锁定格位",
    sceneSet: "已选择场景",
    noScenePicked: "未选择场景",
    play: "播放",
    stop: "停止",

    closeInspector: "关闭检查器",
    fieldName: "名称",
    fieldDescription: "描述",
    descriptionPlaceholder: "解锁后在查看器中显示",
    fieldGroup: "分组",
    fieldStory: "故事",
    fieldScene: "场景",
    fieldLockedPlaceholder: "未解锁占位图",
    pickStory: "选择故事",
    pickScene: "选择场景",
    pickStoryFirst: "请先选择故事",
    pickGroup: "选择分组",
    pickImage: "选择图片",
    pick: "选择",
    useCatalogDefault: "使用默认占位图",
    deleteEntry: "删除条目",
    moveToGroup: "移至分组",
    clearSelection: "清除选择",
    deleteSelected: "删除 {count} 项",
    listScenesFailed: "无法列出场景：{error}",
    playFailed: "无法播放该音频：{error}",

    membersTrack: "曲目",
    membersTracks: "曲目（{count}）",
    membersLine: "对白",
    membersLines: "对白（{count}）",
    membersImage: "图片",
    membersDifferentials: "差分（{count}）",
    add: "添加",
    noLines: "尚未选择对白",
    noTracks: "暂无曲目",
    noImage: "暂无图片",
    changeImage: "更换图片",
    useAsCover: "设为封面",
    clearCover: "取消封面",
    defaultCover: "默认封面（第一项）",
    delete: "删除",

    voicePickerTitle: "添加配音",
    searchLines: "搜索对白…",
    loading: "加载中…",
    noRecordedVoice: "暂无录音，请先在配音面板中导入音频",
    narration: "旁白",
    alreadyAdded: "已添加",
    cancel: "取消",
    addCount: "添加 {count} 项",

    pickerImportTracks: "导入曲目",
    pickerAddDifferentials: "添加差分",
    pickerAddTracks: "添加曲目",
    pickerCover: "选择封面",
    pickerImage: "选择图片",
    pickerLockedPlaceholder: "选择未解锁占位图",
    pickerDefaultPlaceholder: "选择默认占位图",
    pickerAsset: "选择资产",

    idleEmpty: "未选择",
    idleHeading: "放到页面上的步骤",
    idleSeparator: "，",
    idleItemTemplate: "在项模板中",
    idleRowFields: "行字段：",
    idleUnlockedBy: "解锁条件：",
    unlockCg: "「{node}」节点",
    unlockScene: "进入该场景",
    unlockMusic: "播放该曲目",
    unlockVoice: "播放该对白",
    coreSetListContent: "设置列表内容",
    coreGetListItemProps: "获取列表项属性",
    coreGetJsonField: "获取 JSON 字段",
    corePinEntries: "条目",

    defaultCg: "CG {n}",
    defaultScene: "回想 {n}",
    defaultMusic: "专辑 {n}",
    defaultVoice: "配音集 {n}",
    defaultVariant: "差分 {n}",
    defaultTrack: "曲目 {n}",
    defaultGroup: "分组 {n}",
};

const ja: Record<GalleryMessageKey, string> = {
    entryCountOne: "{count} 項目",
    entryCountMany: "{count} 項目",
    itemCountOne: "{count} 件",
    itemCountMany: "{count} 件",
    selectedCount: "{count} 件を選択中",
    openEditor: "ギャラリーエディターを開く",
    openEditorButton: "エディターを開く",
    searchGallery: "ギャラリーを検索…",
    search: "検索",
    panelEmptyTitle: "項目はまだない",
    panelEmptyDetail: "エディターで CG・回想・音楽・ボイスを追加する",
    noMatches: "一致するものがない",
    noMatchesDetail: "別の語で検索する",

    createCg: "CG を読み込む",
    createScene: "回想を追加",
    createMusic: "曲を読み込む",
    createVoice: "ボイスを追加",
    emptyCg: "CG の項目はまだない",
    emptyScene: "回想はまだない",
    emptyMusic: "曲やアルバムはまだない",
    emptyVoice: "ボイスセットはまだない",

    lockedLook: "ロック中の表示",
    lockedLookTitle: "未解放の項目のゲーム内での表示",
    defaultPlaceholder: "既定のプレースホルダー",
    clearPlaceholder: "プレースホルダーを外す",
    lockedTitle: "ロック中のタイトル",
    lockedTitleHint: "空欄ならロック中も実際のタイトルを表示する",
    done: "完了",

    groupAll: "すべて",
    groupUngrouped: "グループなし",
    groupNew: "新しいグループ",
    groupDelete: "グループ「{name}」を削除",

    hiddenUntilUnlocked: "解放まで非表示",
    shownAsLockedSlot: "ロック中の枠として表示",
    sceneSet: "シーン指定済み",
    noScenePicked: "シーン未指定",
    play: "再生",
    stop: "停止",

    closeInspector: "インスペクタを閉じる",
    fieldName: "名前",
    fieldDescription: "説明",
    descriptionPlaceholder: "解放後に鑑賞画面で表示する",
    fieldGroup: "グループ",
    fieldStory: "ストーリー",
    fieldScene: "シーン",
    fieldLockedPlaceholder: "ロック中のプレースホルダー",
    pickStory: "ストーリーを選ぶ",
    pickScene: "シーンを選ぶ",
    pickStoryFirst: "先にストーリーを選ぶ",
    pickGroup: "グループを選ぶ",
    pickImage: "画像を選ぶ",
    pick: "選ぶ",
    useCatalogDefault: "既定のプレースホルダーを使う",
    deleteEntry: "項目を削除",
    moveToGroup: "グループへ移動",
    clearSelection: "選択を解除",
    deleteSelected: "{count} 件を削除",
    listScenesFailed: "シーンを一覧できない：{error}",
    playFailed: "クリップを再生できない：{error}",

    membersTrack: "曲",
    membersTracks: "曲（{count}）",
    membersLine: "セリフ",
    membersLines: "セリフ（{count}）",
    membersImage: "画像",
    membersDifferentials: "差分（{count}）",
    add: "追加",
    noLines: "セリフはまだ選んでいない",
    noTracks: "曲はまだない",
    noImage: "画像はまだない",
    changeImage: "画像を変更",
    useAsCover: "カバーにする",
    clearCover: "カバーを解除",
    defaultCover: "既定のカバー（先頭）",
    delete: "削除",

    voicePickerTitle: "ボイスを追加",
    searchLines: "セリフを検索…",
    loading: "読み込み中…",
    noRecordedVoice: "収録済みのボイスはまだない。先にボイスパネルで音声を読み込む",
    narration: "地の文",
    alreadyAdded: "追加済み",
    cancel: "キャンセル",
    addCount: "{count} 件を追加",

    pickerImportTracks: "曲を読み込む",
    pickerAddDifferentials: "差分を追加",
    pickerAddTracks: "曲を追加",
    pickerCover: "カバーを選ぶ",
    pickerImage: "画像を選ぶ",
    pickerLockedPlaceholder: "ロック中のプレースホルダーを選ぶ",
    pickerDefaultPlaceholder: "既定のプレースホルダーを選ぶ",
    pickerAsset: "アセットを選ぶ",

    idleEmpty: "未選択",
    idleHeading: "ページに配置する手順",
    idleSeparator: "、",
    idleItemTemplate: "項目のテンプレートで",
    idleRowFields: "行のフィールド：",
    idleUnlockedBy: "解放条件：",
    unlockCg: "「{node}」ノード",
    unlockScene: "該当シーンへの到達",
    unlockMusic: "該当曲の再生",
    unlockVoice: "該当セリフの再生",
    coreSetListContent: "リストの中身を設定",
    coreGetListItemProps: "リストの項目のプロパティを取得",
    coreGetJsonField: "JSON のフィールドを取得",
    corePinEntries: "項目",

    defaultCg: "CG {n}",
    defaultScene: "回想 {n}",
    defaultMusic: "アルバム {n}",
    defaultVoice: "ボイスセット {n}",
    defaultVariant: "差分 {n}",
    defaultTrack: "曲 {n}",
    defaultGroup: "グループ {n}",
};

export const GALLERY_MESSAGES = {
    messages: { en, zh, ja },
    fallbackLocale: "en",
} satisfies PluginMessageBundle;

/** The plugin translator, narrowed to this bundle's keys. Every `PluginTranslator` is one. */
export type GalleryTranslator = {
    readonly locale: string;
    t(key: GalleryMessageKey, params?: Record<string, string | number>): string;
};

/** `one` or `many` by count - the bundle's stand-in for plural forms (see the module comment). */
export function galleryCount(
    tr: GalleryTranslator,
    one: GalleryMessageKey,
    many: GalleryMessageKey,
    count: number,
): string {
    return tr.t(count === 1 ? one : many, { count });
}

/**
 * One of the blueprint nodes' own words - a node title, the category, a pin or an option - as the
 * node card draws it in the editor's language. English in a language the table does not cover,
 * which is also what the card shows there.
 */
export function galleryNodeWord(tr: GalleryTranslator, english: string): string {
    return GALLERY_NODE_TRANSLATIONS[tr.locale]?.[english] ?? english;
}

/** The panel's and the editor tab's title: the name the node palette gives the nodes' category. */
export function galleryTitle(tr: GalleryTranslator): string {
    return galleryNodeWord(tr, GALLERY_CATEGORY);
}

/** A column's name, as the `Kind` option on the `Get Gallery` node reads it. */
export function galleryKindLabel(tr: GalleryTranslator, kind: GalleryEntryKind): string {
    return galleryNodeWord(tr, GALLERY_KIND_LABELS[kind]);
}

/** A translator over this bundle that is not tied to a component, for the store and the entry. */
export function createGalleryTranslator(app: PluginApp): GalleryTranslator {
    return app.services.i18n.createTranslator(GALLERY_MESSAGES);
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
