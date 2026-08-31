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
        inputAction: "入力アクション",
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
    // メインプロセスが開くシステムのファイル／フォルダー選択。
    // タイトルは何を選ぶのか、ボタンは選んだあと何が起きるのかを示す。
    file: {
        button: {
            select: "選択",
            open: "開く",
            save: "保存",
            export: "書き出し",
            exportHere: "ここに書き出す",
            import: "読み込み",
            install: "インストール",
        },
        title: {
            selectFile: "ファイルを選択",
            selectFolder: "フォルダーを選択",
            saveFile: "ファイルを保存",
            selectIcon: "アイコンを選択",
            chooseBackgroundImage: "背景画像を選択",
            exportLogs: "Studio のログを保存",
            exportSettings: "Studio の設定を保存",
            importSettings: "設定ファイルを選択",
            exportAssets: "書き出し先のフォルダーを選択",
            exportAsset: "ファイルを保存",
            selectProjectFolder: "プロジェクトフォルダーを選択",
            selectProjectLocation: "プロジェクトを作る場所を選択",
            exportProjectPackage: "プロジェクトパッケージの保存先フォルダーを選択",
            selectProjectPackage: "プロジェクトパッケージを選択",
            importPsd: "PSD ファイルを選択",
            installPlugin: "プラグインパッケージを選択",
            selectBuildOutput: "ビルドの出力フォルダーを選択",
            savePatch: "パッチを保存",
            selectPatchBaseline: "このパッチが更新するビルドを選択",
        },
        filter: {
            all: "すべてのファイル",
            supported: "対応するファイル",
            images: "画像",
            log: "ログ",
            text: "テキスト",
            json: "JSON",
            patch: "パッチ",
            projectPackage: "NarraLeaf Studio プロジェクトパッケージ",
            photoshop: "Photoshop ドキュメント",
        },
    },
} satisfies LocaleNamespace<"dialogs">;
