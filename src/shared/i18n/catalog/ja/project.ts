import type { LocaleNamespace } from "../types";

/** `project` 日本語。プロジェクト設定のサイドバー。ハブの一覧と、5 つのスライドインするページ。 */
export const project = {
    // 各行は中に何があるかを言う。以前はページの目的を述べた文だったが、それは中身ではなく
    // 主張に読める。3 つの部分を持つページは主張ではまとめられないが、持ち物なら並べられる。
    nav: {
        app: {
            title: "アプリ",
            description: "名前、バージョン、アイコン、プラグイン",
        },
        game: {
            title: "ゲーム",
            description: "セーブ、プレイヤーの初期値、オーディオトラック",
        },
        // 今そこにある 1 つの部分ではなく、ページの名前を付ける。今日あるのは配色だが、
        // 文字組みなどプロジェクトの見た目はここに合流していく。
        design: {
            title: "デザイン",
            description: "色と、その色で塗られるコントロール",
        },
        project: {
            title: "プロジェクト",
            description: "検査のルールと、ビルドを止める条件",
        },
        runtimes: {
            title: "ランタイム",
            description: "Live2D と Spine の描画ランタイム",
        },
        settings: {
            title: "設定",
            description: "セキュリティ、署名、最適化、モバイル",
        },
    },
    // ページの中で部分どうしを分ける見出し。見出しは名詞で、文にはしない。何をするかは
    // その下の行が言う。
    group: {
        details: "詳細",
        appTags: "ビルドバリアント",
        userData: "プレイヤーのファイル",
        icons: "アイコン",
        dependencies: "依存関係",
        saving: "セーブ",
        playerDefaults: "プレイヤーの初期値",
        audioTracks: "オーディオトラック",
        // ブランドのサブページの 2 つの部分。作者が決める色と、それに従うスロット。
        // このページの残りの言葉は、id の元になるモデルの隣、`brand` 名前空間にある。
        brandColors: "色",
        brandControls: "コントロール",
        security: "セキュリティ",
        signing: "署名",
        optimization: "最適化",
        crash: "クラッシュ",
        mobile: "モバイル",
    },
    home: {
        untitledProject: "無題のプロジェクト",
    },
    subPage: {
        backAria: "プロジェクトの一覧に戻る",
    },
    details: {
        nameLabel: "アプリケーション名",
        namePlaceholder: "アプリケーション名",
        nameRequired: "アプリケーション名は必須",
        identifierLabel: "識別子",
        identifierHelper: "プロジェクトを作ったときに決まり、パッケージ化に使う",
        versionLabel: "バージョン",
        authorLabel: "作者",
        authorPlaceholder: "作者、組織、またはメールアドレス",
        websiteLabel: "ウェブサイト",
        // パッケージしたアプリのファイル情報と「このアプリについて」に出る。ビルドのダイアログは
        // これを読むだけになったので、編集はここで行う。
        copyrightLabel: "著作権表示",
        copyrightPlaceholder: "© Your Studio",
        // 長いほうの表記。上の 1 行とは読み手が違うので分けてある。1 行のほうはバイナリの
        // ファイル情報に入り、こちらはプレイヤーが開けるファイルに入る。
        copyrightTextLabel: "著作権表記",
        copyrightTextPlaceholder: "使ったフォント、音楽、アセットと、その権利者…",
        copyrightTextHelper: "ゲームと並べて COPYRIGHT.txt として配布する。空のままならファイルは作られない",
        descriptionPlaceholder: "プロジェクトの説明…",
        required: "必須",
    },
    userData: {
        description: "配布したゲームがプレイヤーのセーブと進行を置く場所。フォルダの名前は識別子から決まるので、"
            + "アプリケーション名を変えても場所は動かない",
        copy: "場所をコピー",
        copied: "場所をコピーした",
        copyFailed: "場所をコピーできなかった",
        platform: {
            windows: "Windows",
            macos: "macOS",
            linux: "Linux",
        },
        content: {
            saves: "セーブのスロット",
            persistence: "永続変数、解放された中身、プラグインのデータ",
        },
    },
    // ビルドバリアント。同じプロジェクトが名乗る版のこと。バリアントとは何か、継承が何を意味するかは
    // 見出しの `?` から開く `appTags` のヘルプトピックにある。ここの言葉はコントロールの名前と、
    // 押したときに何が起きるかだけ。
    appTags: {
        add: "バリアントを追加",
        history: {
            add: "バリアント {name} を追加",
            rename: "バリアントの名前を {name} に変更",
            delete: "バリアント {name} を削除",
            edit: "ビルドバリアントの編集",
        },
        newTagName: "新しいバリアント",
        nameTitle: "名前",
        fields: {
            displayName: "アプリケーション名",
            identifier: "識別子",
            version: "バージョン",
        },
        // フィールドが自分の値を持っている間だけ隣に出る。上書きの印であり、そこから戻る道でもある。
        restore: "継承に戻す",
        // シーンの一覧の見出し。ビルドが読めないシーンを開始しうるものがプロジェクトにあるときだけ出る。
        // 下のそれぞれの一覧には、そのもの自身の名前が付く。
        reachableTitle: "ここから始められるシーン",
        // このバリアントのビルドがプレイヤーのブラウザに渡してよいアドレス。仕組みではなく、
        // 一覧が何を決めるかで名前を付ける。バリアントは自分の一覧を持つか、プロジェクトのものを読む。
        // このバリアントのビルドで、ストーリーの行が尽きたときに出すページ。裏側のエンジンのイベントではなく、
        // 作者から見て何が起きるかで名前を付ける。
        ending: {
            // 空の状態ではなく 1 つの選択。最後のフレームが画面に残る。このフィールドができる前は
            // どのビルドもそうしていた。
            title: "ストーリーが終わったときに出すページ",
            none: "何も出さない",
        },
        // 開いているバリアントの削除の隣。これから確認する対象の件数。
        usedBy: {
            other: "{count} 箇所から使われている",
        },
        delete: "削除",
        deleteConfirm: "「{name}」を削除する？",
        // 起きることをそのまま書く。このバリアントを指すものは書き換えられないので、以後はリリースの値を読む。
        // `{name}` はリリースのバリアントの名前。名前が変わってもこの文が付いていくように、ここには書かず埋め込む。
        deleteDetail: {
            other: "{count} 箇所の参照が {name} に戻る",
        },
        // その帰結のもう半分。スクリプトの行になっている参照について。カットポイントは残り、
        // どのバリアントも名指さないカットポイントは何も終わらせない。
        deleteDetailCuts: {
            other: "スクリプトの {count} 箇所のカットポイントは残り、効かなくなる",
        },
    },
    assets: {
        master: "アプリのアイコンを選ぶ",
        override: "個別指定",
        chooseOverride: "このプラットフォーム用の画像を選ぶ",
        clearOverride: "ここでもアプリのアイコンを使う",
        inset: "余白",
        background: "背景",
        clearBackground: "透過のままにする",
        transparent: "なし",
        icnsPreview: "ICNS のプレビュー",
        target: {
            macos: "macOS",
            windows: "Windows",
            linux: "Linux",
            android: "Android",
            ios: "iOS",
            web: "Web",
        },
    },
    game: {
        autoSaveTitle: "自動セーブ",
        autoSaveDescription: "一定の間隔でプレイを保存する。クラッシュで失うのは最大でも 1 間隔分",
        autoSaveIntervalTitle: "保存の間隔",
        autoSaveIntervalDescription: "確認する間隔。ストーリーが進んでいなければ何も書かない",
        autoSaveIntervalUnit: "秒",
        autoSaveSlotsTitle: "残す自動セーブの数",
        autoSaveSlotsDescription: "自動セーブはこの数のスロットを古いものから順に使い回す。プレイヤー自身のセーブスロットとは別",
    },
    // 「プレイヤーの初期値」の群。各設定がどの値から始まるか。どれもプレイ中にプレイヤーが
    // 変えられ、変えた内容は保たれる。だから文言は「初期値」に徹し、設定画面が守らない約束はしない。
    preferences: {
        // 群の見出しに 1 行だけ。ページの中の段落にはしない。残りは行を見れば分かるか、
        // 読んでいる作者の役に立たない。
        intro: "何も変えていないプレイヤーにとっての各設定の初期値。プレイヤーはすべて変えられ、変えた内容は保たれる",
        group: {
            dialogue: "ダイアログ",
            skipping: "スキップ",
            // 「オーディオ」とは呼ばない。ミキサーが同じページに来たので、スクロール 1 つ分
            // 離れて同じ見出しが 2 つ並ぶのは、統合で消そうとした混乱そのもの。
            audio: "サウンド",
        },
        unit: {
            percent: "%",
            ms: "ms",
            cps: "字/秒",
        },
        cps: {
            title: "文字表示の速さ",
            description: "1 秒あたりに表示する文字数",
        },
        gameSpeed: {
            title: "ゲームの速さ",
            description: "文字表示の速さと自動送りの待ち時間の両方に掛かる",
        },
        autoForward: {
            title: "自動送り",
            description: "行の表示が終わると自分で次へ進む",
        },
        showDialog: {
            title: "ダイアログボックスを表示",
            description: "オフにすると、プレイヤーが UI を隠したときと同じ状態でゲームが始まる",
        },
        skip: {
            title: "スキップを許可",
            description: "オフにするとスキップキーそのものが効かなくなる",
        },
        skipReadText: {
            title: "既読のみスキップ",
            description: "まだ読んでいない行に来るとスキップが止まる",
        },
        skipDelay: {
            title: "スキップ開始までの時間",
            description: "スキップキーを押し続けてから、連続スキップが始まるまでの時間",
        },
        skipInterval: {
            title: "スキップの間隔",
            description: "スキップ中の行と行の間の時間。大きいほど遅い",
        },
        globalVolume: {
            title: "全体の音量",
            description: "ゲームが鳴らすすべての音",
        },
        bgmVolume: {
            title: "音楽の音量",
            description: "音楽のバス",
        },
        soundVolume: {
            title: "効果音の音量",
            description: "効果音のバス",
        },
        voiceVolume: {
            title: "ボイスの音量",
            description: "ボイスのバス",
        },
        voiceEndMode: {
            title: "ボイス付きの行が終わったとき",
            description: "行が終わったときクリップをどうするか。どれを選んでも、2 つのボイスが同時に鳴ることはない",
            option: {
                stop: "クリップを止める",
                fade: "クリップをフェードアウトする",
                none: "そのまま鳴らし続ける",
            },
        },
        voiceFadeDuration: {
            title: "ボイスのフェード",
            description: "フェードにかける時間。クリップをフェードアウトするときだけ使う",
        },
    },
    // オーディオのページ。プロジェクトのミキサーを、バスの木として並べたもの。バス 1 本につき
    // 畳んだ行が 1 つで、各項目はその中にある。だから下のラベルは見出しではなくラベル。
    // かつて項目ごとに繰り返していた説明は `intro` に一度だけ書く。
    audio: {
        // バスとは何か、音量がどう掛け合わさるかは `audio` のヘルプトピックにある。
        // この節の見出しの `?` から開く。
        add: "トラックを追加",
        history: {
            add: "トラック {name} を追加",
            delete: "トラック {name} を削除",
            edit: "オーディオトラックの編集",
        },
        newTrackName: "新規トラック",
        nameTitle: "名前",
        parentTitle: "出力先",
        parentMaster: "マスター出力",
        volumeTitle: "音量",
        volumeUnit: "%",
        loopTitle: "既定でループ",
        loopDescription: "このトラックで鳴らすクリップは、鳴らす側が別に指定しない限り繰り返す",
        duplicate: "複製",
        delete: "削除",
        // 開いたバスの中で削除の隣に出る。確認ダイアログがこれから話題にする件数。
        usedBy: {
            other: "{count} 件から使われている",
        },
        deleteConfirm: "「{name}」を削除するか",
        // 正直に書いた結果。このトラックを指しているものは書き換えられないので、それらの参照は
        // 以後それぞれの形に応じた既定のバスへ解決される。どれになるかは何を鳴らすかで変わるので、
        // ここで 1 本のトラック名を挙げれば当て推量になる。
        deleteDetail: {
            other: "{count} 件の参照が既定のバスに落ちる",
        },
        // 下にあるトラックは削除されず繰り上がる。どこへ行くかを作者に伝える。
        deleteChildren: {
            other: "その下の {count} 本のトラックが {parent} に移る",
        },
        // プレイヤー側の音量スライダー。3 本の既定バスに割り当たっている。
        slider: {
            bgm: "BGM の音量",
            sound: "効果音の音量",
            voice: "ボイスの音量",
            // 3 本のどれも通らずマスターにぶら下がるバスには専用の割り当てが無いので、
            // プレイヤーが動かせるのは全体を司るものだけになる。
            global: "全体の音量",
        },
    },
    settings: {
        crashPolicyTitle: "ゲームが停止したとき",
        crashPolicyDescription: "いずれの場合もエラーはゲームのログに記録される",
        crashPolicy: {
            details: "エラーを表示する",
            log: "停止したことだけを伝える",
            restart: "ゲームを再起動する",
        },
        allowHttpTitle: "HTTP を許可",
        allowHttpDescription: "オフにすると、ゲームはアプリのプロトコルの中に閉じ、HTTP と HTTPS の要求はすべて遮断される",
        allowHttpWebHint: "Web 書き出しには効かない。書き出したもの自体が HTTP で配信される。ネットワークノードはそこでも動く",
        networkAllowlistTitle: "一覧のアドレスだけ許可",
        networkAllowlistDescription: "ゲームを下のアドレスに限る。ほかへの要求はすべて拒否される",
        networkAllowlistWebHint: "Web 書き出しを含むすべてのビルドで、ページのポリシーによって効く",
        networkAllowlist: {
            title: "許可するアドレス",
            description: "1 行に 1 つ、アドレスかホストのパターンを書く",
            placeholder: "https://api.example.com/*",
            invalid: "http:// か https:// のアドレスを入れる。* は先頭のホストラベルか末尾のパスにだけ使える",
            add: "アドレスを追加",
            remove: "アドレスを削除",
            fromPlugins: "インストール済みプラグインの宣言",
            sidecarNote: "プラグインの sidecar は別プロセスで、この一覧の対象ではない",
        },
        encryptAssetsTitle: "アセットを暗号化",
        encryptAssetsDescription: "パッケージとプレビューのビルドで、アセット、プラグインのコード、ストーリーのバンドルを暗号化する。開発モードには影響しない",
        encryptAssetsWebHint: "Web 書き出しには当てはまらない。Web ビルドは常にアセットの保護なしで配布される",
        // 署名の群をまとめた 1 行。署名できるプラットフォームには、この端末でビルドできるかに
        // 関わらず行が並ぶ。証明書はそれを使うビルドの何日も前に用意するもので、その準備こそが
        // これがビルドのダイアログではなくパネルにある理由。
        signingDescription: "どの資格情報でどのプラットフォームに署名するか。証明書とパスワードはこの端末に留まり、プロジェクトはどれを使うかだけを持つ",
        webLosslessImagesTitle: "画像を WebP に変換",
        webLosslessImagesDescription: "書き出す画像を、そのほうが小さくなる場合に可逆 WebP へ再エンコードする",
        webLosslessImagesHint: "変換のたびに元の画像とピクセル単位で比べ、まったく同じにデコードされない限り捨てる。Android と iOS のビルドは同じ書き出しを配信するので、そちらにも効く",
        webPrecompressTitle: "テキストを事前圧縮",
        webPrecompressDescription: "サイトのスクリプト、スタイル、ストーリーのデータについて Brotli と Gzip の版も書き出す",
        webPrecompressHint: "使うのは、事前圧縮したファイルを配信するよう設定したサーバーだけ。それ以外のホストは元のファイルを配信し、これらを無視する",
        webLossyImagesTitle: "画像を再圧縮",
        webLossyImagesDescription: "書き出す画像を非可逆 WebP へ再エンコードする。かなり小さくなるが、失われた情報は戻らない",
        webLossyQualityTitle: "画像の品質",
        webLossyQualityDescription: "再圧縮に使う WebP の品質。1 から 100 まで",
        webSharedWithMobileHint: "Android と iOS のビルドは同じ書き出しを配信するので、そちらにも効く",
        // 「モバイルの向き」とはしない。モバイルの見出しの下にあり、語を重ねると 318px のパネルで
        // ラベルが 2 行になる。
        orientationTitle: "画面の向き",
        orientationDescription: "モバイル向けのビルドが起動時に固定する向き",
        orientation: {
            landscape: "横向き",
            portrait: "縦向き",
            auto: "端末に合わせる",
        },
        stageFitTitle: "画面への合わせ方",
        /**
         * 何をするかではなく、どこに効くかを書く。何をするかは見出しと 2 つの選択肢が既に言っており、
         * この列は約 200px しかないので、長い文は 1 行 1 語で折り返す。
         */
        stageFitDescription: "モバイル向けのビルドと開発モードに効く。デスクトップと Web は常に黒帯で収める",
        stageFit: {
            contain: "黒帯で収める",
            cover: "埋めて切り取る",
        },
        /** 消えるものではなく残るもので名前を付ける。作者が決めるのは何を残すか。 */
        cropAnchorYTitle: "縦に残す位置",
        cropAnchorYDescription: "画面が舞台より横に広いときに残る",
        cropAnchorY: {
            top: "上",
            center: "中央",
            bottom: "下",
        },
        cropAnchorXTitle: "横に残す位置",
        cropAnchorXDescription: "画面が舞台より横に狭いときに残る",
        cropAnchorX: {
            left: "左",
            center: "中央",
            right: "右",
        },
    },
    dependencies: {
        rescan: "調べ直す",
        scanning: "プロジェクトを調べている…",
        empty: "プラグインへの依存はない。このプロジェクトは Studio の組み込み機能だけを使っている",
        banner: {
            blocked: "ここで無効になっているプラグインがある。入っているバージョンが合わない。更新するか入れ直す",
            warnings: "確認が要る依存がある。プラグインが古いか、任意の依存が見つからない",
        },
        status: {
            ready: "利用可能",
            outdated: "古い",
            missing: "未インストール",
            incompatible: "非対応",
            disabled: "無効",
        },
        meta: {
            requires: "{version} が必要",
            installed: "{version} が入っている",
            notInstalled: "未インストール",
            builtIn: "組み込み",
            dataOnly: "データのみ",
        },
        usage: {
            blueprintNode: {
                other: "ノード {count} 個",
            },
            widget: {
                other: "ウィジェット {count} 個",
            },
            storage: {
                other: "ストア {count} 個",
            },
            storyAction: {
                other: "アクション {count} 個",
            },
        },
    },
} satisfies LocaleNamespace<"project">;
