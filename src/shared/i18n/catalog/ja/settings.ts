import type { LocaleNamespace } from "../types";

/** `settings` 日本語。設定ウィンドウ（レジストリ駆動、appSettings.ts を参照）。 */
export const settings = {
    title: "設定",
    searchPlaceholder: "設定を検索…",
    loading: "設定を読み込んでいる…",
    noResults: "検索に一致する設定がない",
    empty: "使える設定がない",
    noneExposed: "この節に出している設定はない",
    invalidValue: "有効な値を入力してください",
    persistFailed: "設定を保存できなかった",
    resetToDefault: "既定に戻す",
    customColor: "カスタムカラー…",
    // フォントの選択（SettingFontPicker）。プリセットと、この端末に入っているフォント。
    fontPicker: {
        searchPlaceholder: "フォントを検索…",
        presets: "プリセット",
        installed: "この端末のフォント",
        // 各行はそのフォント自身で描かれる。名前からは字面が分からないファミリー向けの見本で、
        // 日本語や中国語のファミリーはたいていラテン文字で名付けられている。
        sample: "AaBb 字体",
        noMatches: "検索に一致するフォントがない",
        loading: "この端末に入っているフォントを読んでいる…",
        unavailable: "このビルドでは端末のフォントを列挙できない。上のプリセットは使える",
        denied: "端末のフォントを読めなかった。このウィンドウを前面に出してから一覧を開き直す",
        failed: "端末のフォントを読めなかった：{message}",
        notInstalled: "未インストール",
    },
    // カテゴリの見出し。キーは appSettings.ts のカテゴリ `key` と対応する。
    categories: {
        general: {
            label: "一般",
            description: "アプリの既定、言語、通知",
        },
        appearance: {
            label: "外観",
            description: "画面のテーマ、アクセントカラー、動きの設定",
        },
        editor: {
            label: "エディタ",
            description: "文字の表示、行、折り返し、レイアウトの既定",
        },
        workspace: {
            label: "ワークスペース",
            description: "起動時の動き、ワークスペースの履歴、自動保存の補助",
        },
        shortcuts: {
            label: "ショートカット",
            description: "Studio 全体で各コマンドに割り当てたキー",
        },
        versionControl: {
            label: "バージョン管理",
            description: "チェックポイントと、そこに記録される作者の情報",
        },
        network: {
            label: "ネットワーク",
            description: "プラグイン、テンプレート、ビルド用の道具をどこから取ってくるか",
        },
        data: {
            label: "データ",
            description: "キャッシュしたファイル、設定のリセット、端末間の移行",
        },
    },
    // 個々の設定。ローカライズ対象の設定をキーにする。
    items: {
        language: {
            label: "言語",
            description: "Studio の画面表示に使う言語",
        },
        developerMode: {
            label: "開発者オプション",
            description: "右クリックのメニューに、クリックした項目の ID をコピーする節が加わる",
        },
        confirmQuit: {
            label: "⌘Q で終了するときに確認する",
            description: "⌘Q を続けて 2 回押すと終了する。1 回だけでは終了しない",
            unsupportedPlatform: "この項目はこのオペレーティングシステムでは使用できない",
        },
        themeMode: {
            label: "テーマ",
            description: "Studio の画面の配色",
            options: {
                auto: "システムに合わせる",
                light: "ライト",
                dark: "ダーク",
            },
        },
        accentColor: {
            label: "アクセントカラー",
            description: "選択、フォーカスの枠、主要なボタンに使う色",
            options: {
                teal: "リーフティール",
                sky: "スカイ",
                indigo: "インディゴ",
                rose: "ローズ",
                slate: "スレート",
            },
        },
        tooltipDelay: {
            label: "ヒントの遅延",
            description: "ポインターがコントロールに止まってからヒントが出るまでの時間。同じツールバー内では最初の一つだけが待つ",
        },
        reduceMotion: {
            label: "動きを減らす",
            description: "Studio の画面のアニメーションを止める。ゲーム側のアニメーションには影響しない",
        },
        zoomPercent: {
            label: "画面の拡大率",
            description: "Studio の画面の拡大率（{min}%〜{max}%）",
        },
        editorFontSize: {
            label: "ストーリーエディタの文字サイズ",
            description: "シーンエディタのストーリー文の文字サイズ（px、{min}〜{max}）",
        },
        editorFontFamily: {
            label: "ストーリーエディタのフォント",
            description: "シーンエディタのストーリー文に使う書体。この端末に入っているフォントならどれでも選べる",
            // キーは camelCase。対応する保存値は editorFontOptions.ts の表示名で、
            // 古い global.json にはすでにそちらが入っている。
            options: {
                default: "既定",
                sansSerif: "サンセリフ",
                serif: "セリフ",
                monospace: "等幅",
            },
        },
        editorSurfaceOpacity: {
            label: "エディタの面の不透明度",
            description: "ストーリー文とインスペクタの項目の背後にある面の不透明度",
        },
        maxActiveEditors: {
            label: "同時に保持するエディタの数",
            description:
                "スクロール位置とフォーカスを保ったまま読み込んでおくエディタタブの数（{min}〜{max}）。それ以外は開き直したときに読み込み直される",
        },
        blueprintDragConnectExecOutput: {
            label: "実行出力ピンからドラッグしてノードを作る",
            description: "空のキャンバスで放すとノードを選べる。選んだノードはそのピンの後ろにつながる",
        },
        blueprintDragConnectDataOutput: {
            label: "データ出力ピンからドラッグしてノードを作る",
            description: "空のキャンバスで放すとノードを選べる。その値の型を受け取れるノードだけが並ぶ",
        },
        blueprintDragConnectInput: {
            label: "入力ピンからドラッグしてノードを作る",
            description: "空のキャンバスで放すとノードを選べる。選んだノードの出力がそのピンにつながる",
        },
        slashAtAlias: {
            label: "「@」でアクションの作成を開く",
            description: "中国語の入力方式で / と 、 がぶつかるのを避ける",
        },
        localizedCommands: {
            label: "ストーリーのコマンドを画面の言語で表示",
            description:
                "オフにすると、アクション作成のコマンド名、パラメータ名、値を英語のままにする。英語の綴りはどちらでも通る",
        },
        hideParamNames: {
            label: "コマンドはパラメータの値だけを表示",
            description: "行の中のコマンドをより短く読ませる",
        },
        storyRowHighlight: {
            label: "ストーリーの行を強調",
            description: "ある種類の行に背景色を付け、ほかから浮き立たせる",
            options: {
                none: "強調しない",
                script: "台詞の行を強調",
                command: "コマンドを強調",
            },
        },
        detachedEditorOnClose: {
            label: "切り離したエディタのウィンドウを閉じたとき",
            description: "独立したウィンドウで開いたエディタを、ワークスペースに戻すか、ウィンドウごと閉じるか",
            options: {
                restoreTab: "ワークスペースに戻す",
                close: "エディタを閉じる",
            },
        },
        editorLineNumbers: {
            label: "行番号を表示",
            description: "アセットライブラリから開いたファイルを、組み込みのテキストエディタで見るとき",
        },
        editorSoftWrap: {
            label: "長い行を折り返す",
            description: "組み込みのテキストエディタで、横スクロールの代わりに折り返す",
        },
        recentProjectsLimit: {
            label: "覚えておく最近のプロジェクトの数",
            description: "ホーム画面と「最近使った項目を開く」が保つ件数",
        },
        electronMirror: {
            label: "Electron のダウンロードミラー",
            description: "Electron を取ってくるミラー。空のままなら公式の配布元を使う",
        },
        electronBuilderBinariesMirror: {
            label: "ビルド用の道具のミラー",
            description:
                "ビルドがダウンロードするインストーラ関連の道具（NSIS、AppImage、コード署名の補助）のミラー。空のままなら公式の配布元を使う",
        },
        downloadRewrites: {
            label: "ダウンロード先の書き換え",
        },
        pluginRegistryUrl: {
            label: "プラグインレジストリの URL",
            description: "プラグインストアの参照先。空のままなら NarraLeaf の公式レジストリを使う",
        },
        uiTemplateRegistryUrl: {
            label: "UI テンプレートレジストリの URL",
            description: "テンプレートストアの参照先。空のままなら NarraLeaf の公式レジストリを使う",
        },
        checkpointInterval: {
            label: "自動チェックポイントの間隔",
            description:
                "チェックポイントを記録するまでの待ち時間。変化があったときだけ記録する。0 にすると記録しない",
        },
        checkpointOnClose: {
            label: "ワークスペースを閉じるときにチェックポイントを記録",
            description: "上の間隔とは別に、ウィンドウを閉じる時点で記録する",
        },
        versionControlAuthor: {
            label: "作者名",
            description: "コミットとチェックポイントに記録される。空のままなら NarraLeaf Studio と記録する",
            fromServer: "このインストールがサインインしているサーバーから取得されます。自分の名前を記録するにはサインアウトしてください。",
        },
        versionControlAuthorEmail: {
            label: "作者のメールアドレス",
            description: "作者名の隣に「Name <email>」の形で記録される。空のままならアドレスを記録しない",
        },
        confirmBeforeClose: {
            label: "ワークスペースを閉じる前に確認",
            description: "ワークスペースのウィンドウを閉じるときに確認する",
        },
        returnToLauncherOnClose: {
            label: "ワークスペースを閉じたらホーム画面に戻る",
            description: "オフにすると、ほかにウィンドウが無いとき NarraLeaf Studio を終了する",
        },
        dashboardOnOpen: {
            label: "既定でプロジェクトのダッシュボードを表示",
            description: "個別の設定を持たないプロジェクトに効く。プロジェクトごとに上書きできる",
        },
        clearAllStats: {
            label: "統計データをすべて消去",
            description:
                "すべてのプロジェクトの執筆の記録、作業時間、ビルドの履歴を消す。プロジェクト自体から数えている値は変わらない",
            action: "消去",
            confirm: "すべて消去",
        },
        statusBarVisible: {
            label: "ステータスバーを表示",
            description: "ワークスペースの下端に並ぶ帯",
        },
        titleBarSearchVisible: {
            label: "タイトルバーの検索欄を表示",
            description: "タイトルバー中央の検索欄",
        },
        backgroundImage: {
            label: "背景画像",
            description: "ワークスペースの背後に画像を表示する",
            action: "設定…",
            needsWorkspace: "背景画像を設定するにはワークスペースを開く",
        },
        keybindings: {
            label: "キーボードショートカット",
        },
        cacheInventory: {
            label: "キャッシュしたファイル",
        },
        settingsTransfer: {
            label: "設定を端末間で移す",
        },
        resetWorkspaceLayout: {
            label: "ワークスペースのレイアウトをリセット",
            description:
                "パネル、サイドバー、開いているエディタタブを初期状態に戻す。プロジェクトには手を付けない",
            action: "リセット",
            confirm: "レイアウトをリセット",
        },
        resetAllPreferences: {
            label: "すべての設定をリセット",
            description:
                "すべての設定を既定に戻す。プロジェクト、その履歴、統計には手を付けない",
            action: "リセット",
            confirm: "すべてリセット",
        },
    },
    // データのパネル自身の文言。
    data: {
        cache: {
            measuring: "測っている…",
            unavailable: "取得できない",
            clear: "消去",
            clearAll: "すべて消去",
            refresh: "測り直す",
            freed: "{size} を空けた",
            buckets: {
                electronBuilder: {
                    label: "ゲームビルド用の道具",
                    description: "ビルドのために取ってきた Electron とインストーラ関連の道具",
                },
                buildDependencies: {
                    label: "プラグインのビルド用ファイル",
                    description: "ビルドしたゲームに含めるためプラグインが取ってくるアーカイブ",
                },
                browser: {
                    label: "画面のキャッシュ",
                    description: "起動を速くするため、実行のあいだ保たれる画面の状態",
                },
                pluginIcons: {
                    label: "プラグインストアのサムネイル",
                    description: "次にストアを開いたときに取り直される",
                },
                uiTemplatePosters: {
                    label: "テンプレートストアのポスター",
                    description: "次にストアを開いたときに取り直される",
                },
                psdImports: {
                    label: "PSD 読み込みの残り物",
                    description: "PSD を読み込むときに書き出したレイヤーの画像",
                },
                logs: {
                    label: "ログ",
                    description: "診断ファイルを書き出すときの元になるもの",
                },
            },
        },
    },
    transfer: {
        export: "書き出す…",
        import: "読み込む…",
        apply: "適用",
        exportHint: "設定をそのままの JSON ファイルとして書き出す。ワークスペースの背景、コミットに記録する名前、最近のプロジェクト、統計、ウィンドウのレイアウトはこの端末に残る",
        exported: "{path} に保存した",
        imported: "設定 {count} 件を適用した",
        exportFailed: "設定を保存できなかった",
        importFailed: "ファイルを読めなかった",
        planSummary: "変更 {change} 件、すでに同じ {same} 件、対象外 {skipped} 件",
        skippedUnknown: "{key}：このバージョンの Studio にその設定はない",
        skippedInvalid: "{key}：{reason}",
    },
    // ネットワークのパネル自身の文言。上の設定ごとのラベルとは別。
    network: {
        test: "確認",
        probing: "確認している…",
        probeAnswered: "そのアドレスは {status} を返した",
        probeNoAnswer: "応答なし：{error}",
        probeFailed: "確認を実行できなかった",
        rewrites: {
            hint: "ダウンロードの中には、上の設定ではなくカタログから来たアドレスを使うものがある。プラグインのパッケージファイルなど。ここのルールは、そうしたアドレスの先頭を置き換える",
            empty: "書き換えのルールがない。ダウンロードは元のアドレスをそのまま使う",
            add: "ルールを追加",
            remove: "このルールを取り除く",
            enabled: "このルールを使う",
            fromPlaceholder: "https://github.com/",
            toPlaceholder: "https://your-mirror.example/gh/",
        },
    },
} satisfies LocaleNamespace<"settings">;
