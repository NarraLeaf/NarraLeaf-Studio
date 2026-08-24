import type { LocaleNamespace } from "../types";

/**
 * `onboarding` 日本語。初回起動のセットアップで、ランチャーのホーム画面より先に出る。
 *
 * 訊いているのはどれも設定にある項目なので、ラベルと選択肢の名前は `settings` 名前空間から読む。
 * 同じ設定に二通りの訳を置くと、セットアップ画面と設定ウィンドウで「システムに合わせる」の
 * 言い方が食い違う。サンプル内の文言も同じ理由で、ストーリー行は `story.rows.*`、
 * バージョン列の見出しは `workspace.shell` から取る。
 *
 * 文体は常体。`title` は文ではなく名詞句にする。
 */
export const onboarding = {
    windowTitle: "{name} へようこそ",
    progress: "進捗 {current}/{total}",
    steps: {
        welcome: "ようこそ",
        language: "言語",
        appearance: "外観",
        zoom: "拡大率",
        identity: "署名",
        team: "チーム",
        story: "ストーリーエディター",
        done: "完了",
    },
    welcome: {
        title: "ようこそ",
        expectation: "インターフェースとストーリーエディターの設定、全 6 画面。選んだ時点で反映され、あとから設定でも変更できる",
        haveSettings: "ほかのインストールの設定",
    },
    language: {
        title: "言語",
        expectation: "Studio の画面表示に使う言語",
        matchedToDevice: "この端末の言語と一致",
    },
    appearance: {
        title: "外観",
        expectation: "インターフェースのテーマとアクセント",
    },
    zoom: {
        title: "画面の拡大率",
        expectation: "Studio の画面を描く大きさ。このウィンドウもこの設定に従う",
        custom: "カスタム",
        surface: "プレビューの画面",
    },
    identity: {
        title: "署名",
        expectation: "各バージョンに記録される名前と、新規プロジェクトの既定の作者",
        unsigned: "空のままなら、バージョンは {name} として記録される",
    },
    team: {
        title: "チームサーバー",
        expectation: "共有プロジェクトの置き場所。サーバーは必須ではない",
        connect: "サーバーに接続",
        connected: "サインイン済み",
        none: "サーバー未接続。プロジェクトはこの端末に保存される",
    },
    story: {
        title: "ストーリーエディター",
        expectation: "シーンエディターの表示と入力の方式",
    },
    import: {
        action: "設定ファイルを読み込む…",
        leaves: "適用するとセットアップを終了して Studio が開く",
    },
    done: {
        title: "セットアップ完了",
        expectation: "ここで設定した項目はすべて設定にある。F1 でカーソル位置のヘルプが開く",
        docs: "ドキュメントを開く",
    },
    skipConfirm: {
        title: "セットアップをスキップしますか？",
        message: "Studio は既定の設定で開きます。セットアップは再表示されませんが、ここで尋ねる項目はすべて設定にあります。",
    },
    nav: {
        skip: "セットアップをスキップ",
        finish: "Studio を開く",
    },
    sample: {
        projectName: "Afterlight",
        storyName: "第 1 章",
        scene: "屋上、夕方",
        speaker: "Narra",
        line: "チャイムが鳴ったのは十分前。",
        lineContinued: "屋上にはほかに誰もいない。",
        narration: "背後の階段室の扉は開いたままだった。",
        background: "屋上",
        placement: "中央",
        transition: "フェード",
        versions: {
            latest: "屋上のシーン、初稿",
            checkpoint: "チェックポイント",
            earlier: "章の始まり",
        },
        dashboard: {
            lastActive: "たった今",
            trackedSince: "今週",
        },
        console: {
            start: "プレビューをビルド中…",
            assets: "アセット 86 個、シーン 12 個",
            warning: "シーン「屋上、夕方」に立ち絵のないキャラクターがいる",
            done: "プレビュー完了、3.4 秒",
        },
    },
} satisfies LocaleNamespace<"onboarding">;
