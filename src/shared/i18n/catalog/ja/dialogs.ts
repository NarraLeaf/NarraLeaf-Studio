import type { LocaleNamespace } from "../types";

export const dialogs = {
    window: {
        minimize: "最小化",
        maximize: "最大化",
        restore: "元のサイズに戻す",
        appIcon: "アプリアイコン",
    },
    modal: {
        close: "モーダルを閉じる",
        confirmTitle: "操作の確認",
        alertTitle: "お知らせ",
    },
    select: {
        placeholder: "選択してください…",
        searchPlaceholder: "検索または選択…",
    },
    input: {
        required: "この項目は必須",
        maxLength: "最大 {max} 文字まで",
        editValue: "値を編集",
    },
    // 命令的に呼び出す InputDialog サービス（フックではなく translate() を使う）
    createGroup: {
        title: "グループを作成",
        prompt: "{type}グループの名前を入力してください",
        placeholder: "グループ名を入力…",
        empty: "グループ名は空にできない",
    },
    rename: {
        title: "{type}の名前を変更",
        prompt: "新しい{type}名を入力してください",
        placeholder: "新しい名前を入力…",
        empty: "{type}名は空にできない",
        sameName: "新しい名前が現在の名前と同じ",
    },
    password: {
        placeholder: "パスワードを入力…",
    },
    email: {
        placeholder: "メールアドレスを入力…",
        invalid: "有効なメールアドレスを入力してください",
    },
    // 命令的に呼び出す DialogService の既定タイトル（confirm／alert／quick-pick／input）
    service: {
        alertTitle: "アラート",
        selectTitle: "項目を選択",
        inputTitle: "入力",
    },
    // 名前変更や作成のタイトルに差し込む名詞。未知の種別は呼び出し側が渡した文字列のまま出る。
    noun: {
        item: "アイテム",
        layer: "レイヤー",
        pose: "ポーズ",
        axis: "軸",
        tag: "タグ",
        character: "キャラクター",
        group: "グループ",
        story: "ストーリー",
        scene: "シーン",
        chapter: "チャプター",
        component: "コンポーネント",
        asset: "アセット",
        page: "ページ",
        gameUi: "ゲーム UI",
        image: "画像",
        audio: "音声",
        video: "動画",
        json: "JSON",
        blueprint: "ブループリント",
        font: "フォント",
        model: "モデル",
        other: "その他",
        // サイドバーでまとめた区分。`image` / `font` / `model` / `other` は区分名も兼ねる。
        // その 4 つの区分に入る種別がちょうど 1 つずつしかないため。
        media: "メディア",
        data: "データ",
    },
} satisfies LocaleNamespace<"dialogs">;
