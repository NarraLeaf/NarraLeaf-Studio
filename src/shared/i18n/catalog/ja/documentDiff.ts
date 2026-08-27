import type { LocaleNamespace } from "../types";

/**
 * ドキュメントの 2 つのバージョンを比べた結果を言葉にしたもの。
 *
 * `document.` / `opaque.` / `summary.` / `structural.` の下のキーは、**メインプロセス** の
 * 生成側（`vcs/diff/documentDiff.ts` と `shared/documents/jsonStructuralDiff.ts`）が出す。
 * 生成側が返すのは翻訳キーとパラメータで、文そのものではない。ここでキー名を変えると
 * ラベルは黙って壊れ、キー名そのものが表示される。
 *
 * **値はこれらのテンプレートに入らない。** 変更の `from` / `to` は作者自身のデータで、
 * 画面は 2 つを矢印で挟んだ組として描く。文に織り込まないので、320px のレールでも
 * 文ごと切らずに値だけを省略できる。名前を指すパラメータ、すなわち `{name}`、`{index}`、
 * `{bytes}` だけがテンプレートに入る。
 */
export const documentDiff = {
    /** ドキュメントそのものが現れた、あるいは消えた。中身に関わらず 1 行。 */
    document: {
        added: "追加（{bytes}）",
        removed: "削除（{bytes}）",
    },
    /** 第 4 段階。バイト数として読む。ここでは他に読みようがない。 */
    opaque: {
        changed: "変更（{fromBytes} → {toBytes}）",
        unread: "変更あり。中身は見ていない",
    },
    /**
     * アセット。中身ではなくファイルの見出しだけを読む。
     *
     * 出すのは `vcs/diff/contentDiff.ts`。どの行も条件付きで、長さをファイルの末尾に書く容器は
     * 長さを言えず、名前の表が前半に無いフォントは字族を言えない。
     *
     * `changed` / `notInspected` / `unrecognized` は別々の 3 つで、3 文のまま保つ。見出しは読めて
     * 数値が同じ、今回はそのバイト列に手を付けていない、この形式について Studio はこれ以上言えない。
     */
    content: {
        size: "大きさ（{fromBytes} → {toBytes}）",
        dimensions: "寸法（{fromWidth}×{fromHeight} → {toWidth}×{toHeight}）",
        duration: "長さ（{fromSeconds} 秒 → {toSeconds} 秒）",
        sampleRate: "サンプルレート（{fromHertz} Hz → {toHertz} Hz）",
        family: "字族（{from} → {to}）",
        changed: "中身が変わった",
        notInspected: "中身が変わった。見出しは読んでいない",
        unrecognized: "中身が変わった。Studio はこの形式を知らない",
        moved: "{from} から移動",
    },
    /** 第 2 段階。それぞれの版が自分について言っていること。 */
    summary: {
        title: "名前",
        /** `{name}` 自体がキー。下の `count` を参照。このテンプレートに届く前に解決される。 */
        count: "{name}",
        other: "合計に出ない変更",
    },
    /** 第 3 段階。JSON のパス。作りからして一般的で、一覧の上の見出しがそう断っている。 */
    structural: {
        property: "{name}",
        element: "{index} 番目の要素",
        root: "ドキュメントそのもの",
    },
    /**
     * スペックの要約が数えているもの。`DocumentSummaryCount.key` が持つ安定したキーで引く。
     *
     * ここに項目の無いキーは、キー不明の警告ではなく識別子そのものにフォールバックする。
     * スペックが誰かの翻訳より先に集計を足すことがあり、一覧に `audioTracks` と出るほうが
     * 空の行よりはるかにましだから。
     */
    count: {
        appTags: "ビルドバリアント",
        dlc: "DLC",

        assetSets: "アセットセット",
        assets: "アセット",
        folders: "アセットフォルダー",
        audioTracks: "オーディオトラック",
        brandColors: "ブランドの色",
        brandFonts: "既定のフォント",
        characterGroups: "キャラクターグループ",
        characters: "キャラクター",
        dictionaryTerms: "辞書の項目",
        localizationKeys: "ローカライズのキー",
        projectLanguages: "言語",
        projectPlugins: "プラグイン",
        saveFields: "セーブ項目",
        storyBlocks: "ストーリーの行",
        storyChapters: "チャプター",
        storyScenes: "シーン",
        translationUnits: "翻訳",
        uiBlueprints: "ブループリント",
        uiComponents: "コンポーネント",
        uiElements: "インターフェースの要素",
        uiGraphNodes: "ブループリントのノード",
        uiSurfaces: "サーフェス",
        variables: "変数",
        voiceUnits: "ボイスの行",
    },
    /**
     * 第 1 段階のストーリースペック。シーンと行、つまり作者が書いた単位。
     *
     * `subject` は作者自身の言葉（シーン名や行の文）を持ち、これらの *隣* に描かれるので、
     * ここではその対象を名乗り直さない。`{field}` を含むものが生のフィールド識別子を引くのは、
     * 生成側が持っているのがそれだけだから。`entrySceneId` に作者の言葉は無い。
     */
    story: {
        renamed: "ストーリー名を変更",
        /** チャプターの `meta` でも使う。その場合チャプター名は `subject` として届く。 */
        documentField: "{field} を変更",
        chapterAdded: "チャプターを追加",
        chapterRemoved: "チャプターを削除",
        chapterRenamed: "チャプター名を変更",
        /** 並べ替え、またはシーンの出入り。2 つの値はそれぞれの件数。 */
        chapterScenes: "シーンの一覧が変化",
        chapterOrder: "チャプターを並べ替え",
        sceneAdded: "シーンを追加（{blocks} 行）",
        sceneRemoved: "シーンを削除（{blocks} 行）",
        sceneChanged: "シーンを変更",
        sceneRenamed: "名前を変更",
        sceneField: "シーンの {field}",
        blockAdded: "行を追加",
        blockRemoved: "行を削除",
        blockChanged: "行を変更",
        /** 並べ替えではなく親の付け替え。一覧の並べ替えを言うのは `blockOrder`。 */
        blockMoved: "行を移動",
        blockKind: "行の種類を変更",
        blockDisabled: "行を無効化",
        blockEnabled: "行を有効化",
        blockField: "{field} を変更",
        blockOrder: "行を並べ替え",
    },
    /**
     * 第 1 段階のキャラクターストア。
     *
     * この段階がそもそも存在する理由の行が `poseAsset` / `layerOptionAsset`。
     * 「アリスの怒り差分が別の画像を指すようになった」で、`subject` はポーズかタグ。
     */
    characters: {
        castOrder: "キャストを並べ替え（{count}）",
        added: "キャラクターを追加",
        removed: "キャラクターを削除",
        changed: "キャラクターを変更",
        renamed: "名前を変更",
        profileField: "プロフィールの {field}",
        /** preset / layered / puppet。2 つの種別は値の組として描かれる。 */
        kindChanged: "見た目の種類を変更",
        poseAdded: "ポーズを追加",
        poseRemoved: "ポーズを削除",
        poseRenamed: "ポーズ名を変更",
        poseAsset: "別の画像を指すようになった",
        poseChanged: "ポーズを変更",
        poseOrder: "ポーズを並べ替え",
        defaultPose: "既定のポーズを変更",
        axisAdded: "軸を追加",
        axisRemoved: "軸を削除",
        axisChanged: "軸を変更",
        layerAdded: "レイヤーを追加",
        layerRemoved: "レイヤーを削除",
        layerChanged: "レイヤーを変更",
        layerAsset: "別の画像を指すようになった",
        /**
         * レイヤー内のあるタグの画像。増えたか、消えたか、入れ替わったかのいずれかなので、
         * 動詞ではなく名詞にしてある。どれなのかは行自身の印が言う。`{layer}` / `{tag}` の
         * パラメータをわざと持たない。生成側は作者の付けた名前が無いほうを省くので、
         * 埋まらないプレースホルダは作者の画面に `{layer}` のまま出てしまう。
         */
        layerOptionAsset: "レイヤーの画像",
        layerOrder: "レイヤーを並べ替え",
        appearanceField: "見た目の {field}",
        /** `{key}` はポーズ id かタグの組み合わせで、作者の言葉ではない。だから `subject` ではない。 */
        avatarChanged: "ダイアログのアバター {key}",
        groupAdded: "グループを追加",
        groupRemoved: "グループを削除",
        /**
         * キャラクターエディタが描いてはいるが、ラベルを持たない 6 つのフィールド。ほかの
         * フィールドは作者が編集する画面の言葉をそのまま使う（`CHARACTER_FIELD_NAME_KEY` を
         * 参照）が、この 6 つには借りられるキーが無い。キャストの一覧は別名を名前の下に
         * 説明なしで並べ、グループは行を移して決め、キャンバス・アバターの軸・取り込み元の
         * PSD・パペットの静止状態はそれぞれボタンかラベルの無い操作子の先にある。言葉は
         * その操作子自身の言い方（キャンバスを決める、この軸でアバターが変わる、
         * PSD を読み込む）から取り、ここで作らない。
         *
         * attributes と options はここに無い。Studio に編集画面が無く、どちらもプラグインや
         * 取り込みが書き込む入れ物なので、行は保存名のままにしてある。
         */
        fields: {
            nicknames: "別名",
            group: "グループ",
            canvas: "キャンバス",
            avatarAxes: "アバターの軸",
            psd: "PSD",
            puppetDefaultState: "既定の状態",
        },
        groupRenamed: "グループ名を変更",
    },
    /**
     * ある言語の翻訳ライブラリ。中身がまるごと作者の文章であるドキュメント。
     *
     * 最初の 3 つはバージョン比較と 3 方向マージの共通語彙。どれも単位を名指ししないし、できない。
     * 単位 id はストーリーのテキスト id か `key:`／`char:`／`scene:` のハンドルで、
     * 作者が打った言葉ではない。行を見分けさせるのは翻訳そのもので、ラベルの隣に
     * 値の対として描かれる。だから changed は訳し直したとだけ言い、前後の文は対に任せる。
     *
     * status の 4 行は、その単位が今どの状態なのかを翻訳テーブルと同じ 4 語で述べる。
     * ファイルに保存された識別子を 2 つ並べるのではない。
     */
    localization: {
        added: "翻訳を追加",
        removed: "翻訳を削除",
        changed: "翻訳を変更",
        note: "備考を変更",
        /** 訳文は変わっていないが、もとにした原文の行が別の行になった。 */
        source: "もとにした原文の行が変わった",
        statusUntranslated: "未翻訳になった",
        statusMachine: "機械翻訳になった",
        statusTranslated: "翻訳済みになった",
        statusReviewed: "確認済みになった",
    },
    /**
     * インターフェースのドキュメント。サーフェスと、その上の要素。
     *
     * 作者自身の言葉（サーフェス名、要素名）は `subject` が持ち、これらのラベルの隣に描かれるので、
     * ここでは名乗り直さない。`element*` は断片で、「要素を変更」の下にぶら下がり、
     * その要素のどの部分が変わったかだけを言う。
     */
    uiDocument: {
        renamed: "インターフェースの名前を変更",
        surfaceAdded: "サーフェスを追加（要素 {elements} 件）",
        surfaceRemoved: "サーフェスを削除（要素 {elements} 件）",
        surfaceChanged: "サーフェスを変更",
        surfaceRenamed: "名前を変更",
        /** サーフェスを組むための設計上の領域。描画の解像度ではない。 */
        surfaceDesignSize: "設計サイズ（{fromWidth}×{fromHeight} → {toWidth}×{toHeight}）",
        surfaceSettings: "背景かページアニメーションを変更",
        surfaceRoot: "ルート要素が変わった",
        surfaceField: "{field} を変更",
        componentAdded: "コンポーネントを追加（要素 {elements} 件）",
        componentRemoved: "コンポーネントを削除（要素 {elements} 件）",
        componentChanged: "コンポーネントを変更",
        componentRenamed: "名前を変更",
        componentField: "{field} を変更",
        elementAdded: "要素を追加",
        elementRemoved: "要素を削除",
        elementChanged: "要素を変更",
        elementRenamed: "名前を変更",
        /** ウィジェットの種類が変わった。テキストがボタンになるなど。2 つの種別は値の組として描かれる。 */
        elementType: "要素の種類が変わった",
        /** 親の付け替え。同じ親の中の並べ替えではない。それを言うのは `elementOrder`。 */
        elementMoved: "別の親の下へ移動",
        elementOrder: "子要素を並べ替え",
        elementLayout: "位置か大きさを変更",
        elementStyle: "スタイルを変更",
        elementProps: "中身を変更",
        elementBehavior: "ふるまいを変更",
        elementBinding: "結びつけを変更",
        elementAnimation: "アニメーションを変更",
        elementField: "{field} を変更",
    },
    /**
     * ブループリントのドキュメント。インターフェースの裏側のロジック。
     *
     * この段階の形が回っている中心は `nodeMoved`。ノードを動かしてもプレイヤーの見るものは変わらない。
     * それをパラメータの変更と同じ言葉で言うのは、「版面を整えた」を「ゲームのふるまいを変えた」と
     * 同じ高さに置くこと。だから 1 行を自分で持ち、自分の印を持つ。
     *
     * ノードに名前を付ける行はここに 1 つも無い。ノードの種別は `blueprint.event.head.appBoot` のような
     * 識別子で、人間向けの名前はエディタ側の表から来る。識別子をそのまま作者の前に置けば、
     * 作者自身が書いた言葉として読まれてしまう。
     */
    uiGraphs: {
        /** ホストのスロットで今どのブループリントが効いているか。 */
        ownerRecord: "効いているブループリントが変わった",
        blueprintAdded: "ブループリントを追加（ノード {nodes} 件）",
        blueprintRemoved: "ブループリントを削除（ノード {nodes} 件）",
        blueprintChanged: "ブループリントを変更",
        blueprintRenamed: "名前を変更",
        /** TypeScript のブループリント。プログラム全体が 1 つのソース。 */
        blueprintSource: "コードを変更",
        blueprintField: "{field} を変更",
        graphAdded: "グラフを追加（ノード {nodes} 件）",
        graphRemoved: "グラフを削除（ノード {nodes} 件）",
        graphChanged: "グラフを変更",
        graphRenamed: "名前を変更",
        graphField: "{field} を変更",
        graphOrder: "グラフを並べ替え",
        nodeAdded: "ノードを追加",
        nodeRemoved: "ノードを削除",
        nodeChanged: "ノードを変更",
        nodeParams: "取る値を変更",
        /** キャンバス上で動かしただけ。同じくらい読み飛ばしやすいように、平らに言う。 */
        nodeMoved: "キャンバス上で移動",
        nodeType: "ノードの種類が変わった",
        nodeField: "{field} を変更",
        edgeAdded: "つながりを追加",
        edgeRemoved: "つながりを削除",
    },
    /** 第 1 段階、`assets.metadata.<type>.json` の 1 断片。アセットに付けた作者のメタデータ。 */
    assets: {
        added: "アセットを追加",
        removed: "アセットを削除",
        changed: "アセットを変更",
        renamed: "名前を変更",
        /** 内容のハッシュが動いた。記録の先にあるファイルのバイト列が別物になった。 */
        content: "ファイルの中身を差し替え",
        field: "{field} を変更",
        /** アセットの中身のファイルだが、この比較のどの記録もこれを指していない。名前は id の断片。 */
        orphanContent: "アセットの記録がないファイル",
    },
    /**
     * 第 1 段階のプロジェクトのパレット。
     *
     * `subject` は作者がその色に付けた名前。既定の色は名前を持たない。既定の色の名前はパネルが出す
     * 翻訳文字列なので、その行は 2 つの色だけを持ち、名前は出ない。下には `BrandChangeDetail` が
     * パレット全体を描く。
     */
    brand: {
        added: "色を追加",
        removed: "色を削除",
        renamed: "名前を変更",
        /** 値の組は 2 つの色そのもの。文字として読むのではなく、色見本として描かれる。 */
        value: "色を変更",
        /** 既定のフォントの積み重ね。1 行だけ出す。各段はアセット id として保存されている。 */
        fonts: "既定のフォントを変更",
    },
    /**
     * 第 1 段階のビルドバリアント。1 つのプロジェクトが出荷される複数のエディション。
     *
     * 最初の 3 つを除いて、以下はすべて「変更」と言わずフィールドの名前を出す。8 つ全部が
     * 取れる書き方はこれしかない。4 つはバリアントのパネルがすでに使っている長い名前
     * （「ストーリーが終わったときに出すページ」）で、別の 4 つはそれぞれ 2 か所で使う。
     * バリアントの下では `subject` が対象を名乗り、単独ではどのバリアントも受け継ぐ
     * プロジェクト自身の値を指す。何が起きたかは行がすでに持っている。印と、隣の値の組。
     *
     * `version` は誰のバージョンかを言う。この画面はそれ自身のバージョン番号（#3、#7）で
     * 埋まっていて、ただの「バージョン」はそのうちの 1 つに読める。
     */
    appTags: {
        added: "バリアントを追加",
        removed: "バリアントを削除",
        renamed: "名前を変更",
        /** 3 つの識別フィールド。片側に値が無いのは、そのバリアントが受け継いでいるということ。 */
        displayName: "アプリケーション名",
        identifier: "識別子",
        version: "プロジェクトのバージョン",
        plugins: "プラグインの設定",
        assetAxes: "ビルドが使うアセット",
        scenes: "開始できるシーン",
        ending: "ストーリーが終わったときに出すページ",
        order: "バリアントの並び",
    },
    /**
     * 第 1 段階のプロジェクトのミキサー。
     *
     * この段階がそもそも存在する理由の行が `rerouted`。バスがどこへ出力するかは、その音量が何と
     * 掛け合わさるか、プレイヤーのどのつまみが届くかを決める。そして件数はまったく動かない。
     * だから概要の段階では、出力先を変えたファイルは「変わった、ただし概要では言えない」だけだった。
     * 値の組は 2 本のバスの名前。マスターに直接ぶら下がった場合は名乗る親が無いので、
     * 半端な組にせず独立した 1 行にしてある。
     */
    audioTracks: {
        added: "トラックを追加",
        removed: "トラックを削除",
        renamed: "名前を変更",
        rerouted: "別のバスへ出力するようになった",
        reroutedToMaster: "マスター出力へ直接出すようになった",
        /** 値の組はつまみ自身の数（100 分率）。保存されている 0 から 1 ではない。 */
        volume: "音量を変更",
        /** いまの既定のふるまいを言う。`true` / `false` はファイルの言葉で、作者の言葉ではない。 */
        loopOn: "既定でループする",
        loopOff: "既定で 1 回だけ鳴る",
        order: "トラックを並べ替え",
    },
    /**
     * 第 1 段階のプロジェクトのセーブ変数とグローバル変数。
     *
     * この段階の理由の行が `defaultValue`。どの周回もそこから始まり、その変数ができる前に書かれた
     * セーブもその値として読まれる。つまり出荷されるゲームが変わるのに、件数は 1 つも動かない。
     * スコープの 2 行は、その変数がいま何なのかを言う。保存されている 2 語を組にはしない。
     * 片方の persistent は、パネルでのそのスコープの呼び名ですらない。
     */
    variables: {
        added: "変数を追加",
        removed: "変数を削除",
        renamed: "名前を変更",
        defaultValue: "既定値を変更",
        valueType: "型を変更",
        scopeSaved: "セーブ変数になった",
        scopeGlobal: "グローバル変数になった",
        /** 値を入れておくキー。名前の変更では決して動かさないように作ってある。 */
        storageKey: "すでに保存された値はもう読み出せない",
        description: "備考を変更",
    },
    /**
     * 第 1 段階の、セーブ 1 枠が持つ項目。
     *
     * 代償まで言うのは `removed` だけで、言う必要があるのもこれだけ。項目を足すのは作りとして
     * 安全で、値の無い枠は既定値として読まれる。取り除くほうは、それを読むピンごと消える。
     * プレイヤーのディスクにあるセーブは、プロジェクトの誰も二度と尋ねられない値を抱えたまま残る。
     */
    saveSchema: {
        added: "セーブ項目を追加",
        removed: "セーブ項目を削除。既存のセーブに値は残るが、読み出す口が無い",
        renamed: "名前を変更",
        valueType: "型を変更",
        defaultValue: "既定値を変更",
        /** セーブの中でのキー。作成時に決まる。名前を変えても書き込み済みの値が迷子にならないため。 */
        storageKey: "すでに保存された値はもう読み出せない",
        description: "備考を変更",
        /** セーブノードのピンの並びの中での位置。ゲームそのものは何も変わらない。 */
        reordered: "項目の並びの中で移動",
    },
    /**
     * 第 1 段階のプロジェクト自身の用語集。
     *
     * ここに `renamed` は無く、置くこともできない。辞書の項目に id は無く、綴りそのものが identity
     * なので、書き方を変えれば 1 つ消えて 1 つ増えたことになる。2 つのオプションの行は、
     * 辞書がいま何をするかを言う。プロジェクトのすべての台本で、ストーリーエディターが何に印を
     * 付けるかが変わるから。
     */
    dictionary: {
        added: "用語を追加",
        removed: "用語を削除",
        reading: "読みを変更",
        /** 一覧なので値の組にしない。2 つの別表記の並びを 1 行に引くと、どの幅でも読めない。 */
        variants: "別表記を変更",
        note: "備考を変更",
        readingsOn: "読みを提案する",
        readingsOff: "読みを提案しない",
        variantsOn: "別表記を検査する",
        variantsOff: "別表記を検査しない",
    },
    /**
     * 第 1 段階、プロジェクト自身の設定。ゲームの名前と、ビルド・セーブ・プレイヤーの初回起動が
     * ここから読み取るもの全部。
     *
     * プロジェクトの領域ごとに 1 行、その中の設定ごとに子の行を 1 つ。作者がそう辿るから。これらの値は
     * 14 のパネルに分かれていて、作者が覚えているのはパネルの言い方であって、ファイルの中のフィールド名
     * ではない。値の組は行の横に並ぶので、方針やモードはファイルの言葉のまま引かれる。
     *
     * `field` は最後の手段で、5 つの領域はこれだけで成り立つ。署名の資格情報、配布キー、そして
     * ビルド・パッチ・検査の 3 つのダイアログが覚えている前回の選択。4 つはダイアログの記憶、1 つは
     * 誰も手で打たないキーで、そのフィールドに作者向けの言葉を当てると、無いパネルがあることになる。
     */
    project: {
        name: "アプリケーション名",
        identifier: "識別子",
        /** このビルドに言い方が無い設定。ファイルの中の名前のまま出す。 */
        field: "{field} を変更",
        metadata: "詳細",
        metaVersion: "プロジェクトのバージョン",
        metaDescription: "説明",
        metaAuthor: "作者",
        metaEmail: "連絡先のメールアドレス",
        metaWebsite: "ウェブサイト",
        /** 1 行だけ。書き出した実行ファイルのプロパティに入る。 */
        metaCopyright: "著作権表示",
        /** 全文。ゲームと一緒に配られる。 */
        metaCopyrightText: "著作権表記",
        metaResolution: "ウィンドウサイズ",
        metaIcons: "アイコン",
        network: "ネットワークアクセス",
        networkPolicy: "ネットワークの方針",
        networkAllowlist: "ネットワーク要求の許可一覧",
        networkHttp: "平文 HTTP の通信",
        networkRemoteResource: "リモートのリソース",
        networkRemoteScript: "リモートのスクリプト",
        localization: "言語",
        sourceLocale: "元の言語",
        locales: "言語の一覧",
        voice: "ボイス",
        voicedLocales: "ボイスのある言語",
        voiceNaming: "ボイスファイルの命名",
        voiceCast: "ボイスの割り当て",
        voiceChoices: "選択肢のボイス",
        dialogue: "ダイアログ",
        dialogueAutoForwardPause: "自動送り中の間の長さ",
        preferences: "プレイヤー設定の初期値",
        prefTextSpeed: "文字表示の速さ",
        prefGameSpeed: "ゲームの速さ",
        prefAutoForward: "自動送り",
        prefAutoForwardDelay: "自動送りの待ち時間",
        prefShowDialog: "ダイアログボックスを表示",
        prefSkip: "スキップを許可",
        prefSkipReadText: "既読のみスキップ",
        prefSkipDelay: "スキップ開始までの時間",
        prefSkipInterval: "スキップの間隔",
        prefGlobalVolume: "全体の音量",
        prefBgmVolume: "音楽の音量",
        prefSoundVolume: "効果音の音量",
        prefVoiceVolume: "ボイスの音量",
        prefVoiceEndMode: "ボイス付きの行が終わったとき",
        prefVoiceFadeDuration: "ボイスのフェード",
        autoSave: "セーブ",
        autoSaveEnabled: "自動セーブ",
        autoSaveInterval: "保存の間隔",
        autoSaveSlots: "残す自動セーブの数",
        saveCompatibility: "以前のセーブ",
        saveCompatible: "他のプロジェクトバージョンのセーブ",
        saveIncompatible: "ストーリー変更前のセーブ",
        saveLocation: "プレイヤーのファイル",
        saveLocationWindowsLinux: "Windows と Linux",
        saveLocationMacos: "macOS",
        languageChange: "言語の切り替え",
        languageChangeInGame: "ゲーム中の言語切り替え",
        security: "セキュリティ",
        encryptAssets: "アセットを暗号化",
        crash: "クラッシュ",
        crashPolicy: "ゲームが停止したとき",
        assetOptimization: "最適化",
        lossyImages: "画像を再圧縮",
        lossyQuality: "画像の品質",
        vfx: "画面エフェクト",
        vfxFrameRate: "天候のフレームレート",
        mobile: "モバイル",
        mobileOrientation: "画面の向き",
        mobileFit: "画面への合わせ方",
        mobileCropX: "横に残す位置",
        mobileCropY: "縦に残す位置",
        distribution: "配布キー",
        signing: "署名",
        build: "ビルドの設定",
        patch: "パッチ書き出しの設定",
        linting: "プロジェクトチェック",
        dependencies: "依存関係",
        dependencyPlugins: "プラグインの一覧",
    },
    /**
     * 4 つの段階のどれが答えたか。構造の一覧が意味的な一覧に見えてしまうのを止める見出し。
     * `semantic` にこれが無いのは、断り書きの要らない主張だから。
     */
    tier: {
        summary: "要約のみ",
        summaryHint: "比べたのは合計だけで、中身そのものは比べていない",
        structural: "構造",
        structuralHint: "この一覧には、変更ではない差分も混じることがある",
        content: "形式の情報のみ",
        contentHint: "比べたのはファイルが自分について言っている情報で、中身そのものは比べていない",
        opaque: "未読",
        opaqueHint: "比べたのはファイルの大きさだけ",
    },
    rows: {
        loading: "比較結果を読んでいる…",
        empty: "このファイルの中に違いはない",
        // 「何も無い」に 3 通りある。「変更あり」と「違いはない」が並ぶと矛盾に読め、
        // 段階ごとに言えることも違う。documentDiffEmptyKey を参照。
        emptyFormatting: "書式だけが変わった",
        emptyUntracked: "エディタ上に見える変化はない",
        emptyCounts: "合計は変わっていない",
        moreInGroup: "この中にあと {count} 件",
        showing: "{total} 件中 {shown} 件を表示",
    },
    rail: {
        compareWithPrevious: "前のバージョンと比べる",
    },
    /** その形式のための詳細が書かれている場合に、そこが足す言葉（`renderer/lib/vcs/presenters`）。変更が何を言うかは上の段階のキーのまま。 */
    presenter: {
        /** 2 つのバージョンの呼び名。どの形式でも 1 組だけ持ち、同じ比較の中で言い方が割れないようにする。 */
        before: "変更前",
        after: "変更後",
        image: {
            modeLabel: "比べ方",
            sideBySide: "並べる",
            swipe: "スライドで分ける",
            difference: "差分",
            splitPosition: "分ける位置",
            /** 差分は画素どうしが 1 対 1 で対応していないと引き算できない。 */
            sizeDiffers: "2 つのバージョンで寸法が違うので、画素ごとには比べられない",
            /** 絵の場所に出うる 4 つの状態。それぞれ別の事実なので、1 文にまとめない。 */
            tooLarge: "このファイルは大きすぎて、ここには出せない",
            unsupported: "この画像形式はここには出せない",
            unreadable: "この画像を読めない",
        },
        audio: {
            play: "再生",
            pause: "一時停止",
            /** デコードして分かるチャンネル数。 */
            mono: "モノラル",
            stereo: "ステレオ",
            channels: "{count} チャンネル",
            /**
             * 波形の場所に出うる 4 つの状態。
             *
             * `tooLarge` はファイルの話で、そもそも読んでいない。`tooLong` は音そのものの話で、
             * バイト列は手元にあるが、デコードに要るメモリがプレビューの枠を超える。だから下の数値は
             * いつもどおり出し、波形だけを描かない。
             */
            tooLarge: "このファイルは大きすぎて、ここでは再生できない",
            tooLong: "この音声は長すぎて、ここではプレビューできない",
            unreadable: "この音声を読めない",
        },
        font: {
            sizeLabel: "文字の大きさ",
            /** 見本には日本語も混ぜる。ラテン文字だけでは、日本語の字形が一緒に入っているか分からない。 */
            sample: "The quick brown fox 0123 日本語の組版見本",
            unreadable: "このフォントを読み込めない",
            tooLarge: "このファイルは大きすぎて、ここには出せない",
        },
        brand: {
            added: "追加",
            removed: "削除",
            unreadable: "この配色を読めない",
            tooLarge: "このファイルは大きすぎて、ここには出せない",
            unchangedOne: "変わっていない色があと 1 件",
            unchangedMany: "変わっていない色があと {count} 件",
            /** 同じ配色の別の項目を指しているのに、最後まで色に行き着かない値。名前が無いか、環になっている。 */
            unresolved: "色なし",
        },
    },
    /** 変更されたファイルの見出し。ディスク上のフォルダ名ではなく、作者がそれを編集するパネルの名前で呼ぶ。 */
    /**
     * What the author calls each kind of document.
     *
     * The fallback for a thing with no name of its own. Never a file name: the author did not
     * make a file, they made a project, a story, a set of pages.
     */
    name: {
        project: "プロジェクト設定",
        storyIndex: "ストーリーの一覧",
        story: "ストーリー",
        animationIndex: "モーションの一覧",
        animation: "モーション",
        uiDocument: "インターフェースのページ",
        uiGraphs: "インターフェースのブループリント",
        blueprint: "ブループリント",
        variables: "変数",
        audioTracks: "オーディオトラック",
        brand: "ブランドの配色",
        appTags: "ビルドバリアント",
        dlc: "追加コンテンツ",
        dictionary: "辞書",
        saveSchema: "セーブ項目",
        assetSets: "アセットセット",
        localization: "翻訳",
        localizationKeys: "翻訳キー",
        voice: "ボイス",
        assetsMetadata: "アセットライブラリ",
        assetsGroups: "アセットのフォルダー",
        assetsOrder: "アセットの並び",
        characters: "キャラクター一覧",
        assetContent: "アセットのファイル",
        qualified: "{name}（{qualifier}）",
    },
    category: {
        story: "ストーリー",
        characters: "キャラクター",
        interface: "インターフェース",
        assets: "アセット",
        localization: "ローカライズ",
        audio: "オーディオ",
        settings: "プロジェクト",
        other: "その他",
    },
    /** 比較の 2 列。左が変更されたファイルの索引、右がそのうち 1 件の中の変更。 */
    shell: {
        fileList: "変更されたファイル",
        resize: "ファイル一覧の幅を変える",
        selectPrompt: "見出しを開いてファイルを選ぶと、その中の変更が出る",
        changes: {
            other: "{count} 件の変更",
        },
        fileAdded: "追加",
        fileRemoved: "削除",
        fileMoved: "移動",
        /** 複数ファイルで 1 つのドキュメントになっている場合に、行のヒントで言う。 */
        setFiles: {
            other: "このドキュメントのうち {count} ファイルが変わった",
        },
        /** 見出しの下で一度だけ言い、行ごとには繰り返さない。どれに当たったかは、そのファイルの詳細が言う。 */
        partial: {
            other: "変更が載りきっていない可能性のあるファイルが {count} 件ある",
        },
    },
    tab: {
        workingTree: "変更",
        between: "{from} → {to}",
        comparingWorkingTree: "このプロジェクトと {version}",
        comparingWorkingTreeUnknown: "このプロジェクトと直前のバージョン",
        comparingRevisions: "{from} と {to}",
        refresh: "読み直す",
        empty: "この 2 つのバージョンに違いはない",
        emptyWorkingTree: "直前のバージョンから変わっていない",
        readFailure: "この比較を読めなかった：{error}",
        incomplete: "変化した {total} 件のドキュメントのうち {shown} 件を比べた",
        documentsOmitted: "ここに載っていないドキュメントがあと {count} 件ある",
        unavailable: "このプロジェクトではバージョン管理を使えない",
    },
    /** 1 つのファイルの 2 つのバージョンを、専用のタブで並べて見る。ここには並べ方そのものの語だけを置く。 */
    split: {
        open: "並べて開く",
        thisProject: "このプロジェクト",
        notInVersion: "このバージョンには無い",
        resize: "左右の幅を変える",
        previous: "前の変更",
        next: "次の変更",
        position: "{index} / {total}",
        gone: "このファイルは今回の比較に含まれていない",
        inspect: "{name} のプロパティを見る",
    },
    /**
     * 片側の要素を選んでいるときの右側のプロパティ欄。
     *
     * 描くのは UI エディタと同じインスペクタで、対象がその半分の見せているバージョンに変わるだけ。
     * だからここにフィールドの説明は一つも無い。フィールドはいつもどおりのことを言う。ここが足すのは
     * フィールドには言えない一点、どのバージョンなのか、そしてそれはキャンバスではなくその版の画である
     * ということだけ。
     */
    inspector: {
        version: "{version} の内容",
        onlyHere: "{version} には無い",
        readOnly: "比較は読むためのもので、これらのプロパティを変えるには UI エディタを開く",
        differs: "{version}：{value}",
        noValue: "空",
    },
    /**
     * ファイルごとにどちらかの側を採ってマージを終える画面。
     *
     * 語彙はバックエンドの `mine`／`theirs` ではなく「自分のものを残す／相手のものを残す」にし、
     * リビジョンのハッシュではなく「取ってきたバージョン」と呼ぶ。「サーバーから取得」を押した
     * 作者がしているのは、同僚の作業と自分の作業のすり合わせであって、3 方向マージの解決ではない。
     *
     * `notSaved` はこの画面が正直でいられる理由の一文。どの衝突を決めたかを残す読める記録は
     * どこにも無いので、その記録はリポジトリのものではなく Studio のものだ。それを言うほうが、
     * プロジェクト自身が知っているかのような進捗を見せるよりよい。
     *
     * 以前は「このウィンドウを開いている間だけ」とも書いていた。当時は本当だったが今は違う。
     * 選択はプロジェクトの隣の下書きに残る（`mergeDecisionDraft`）。変わっていないのは肝心な
     * 半分 —— 完了を押すまでファイルは一つも動かない —— なので今はそれだけを言う。
     */
    resolve: {
        tab: "マージ",
        merging: "このプロジェクトの 2 つのバージョンをマージしている",
        none: "このプロジェクトはマージの途中ではない",
        automerged: "すべて自動でマージできた。完了するとバージョンとして記録される",
        count: {
            other: "両側で変わったファイルが {count} 件ある。どちらを残すか選ぶ",
        },
        takeMine: "自分のものを残す",
        takeTheirs: "相手のものを残す",
        takeAllMine: "すべて自分のものを残す",
        takeAllTheirs: "すべて相手のものを残す",
        rowsOmitted: "ここに載っていないファイルがあと {count} 件ある。上の 2 つのリンクでまとめて選ぶ",
        /** 2 列。左が衝突しているファイル、右が選んだファイルの中の変更。 */
        fileList: "衝突しているファイル",
        decision: "どちらを残すか",
        /** 3 つの状態のうち、印を持つ唯一の状態。マージの完了を止めているのはこれなので、一目で見つかる必要がある。 */
        pending: "未選択",
        selectPrompt: "ファイルを選ぶと、その中の変更が出る",
        finish: "マージを完了する",
        finishUndecided: {
            other: "どちらを残すか決まっていないファイルが {count} 件ある",
        },
        notSaved: "マージを完了するまでファイルには何も書き込まれない",
        abandon: "取りやめる",
        abandonConfirm: "このマージを取りやめるか",
        abandonConfirmDetail:
            "サーバーからこれらのバージョンを取ってくる前の状態に、すべてのファイルが戻る。自動でマージできたファイルも含む。失われるものはない。バージョンは取り直せる",
        /**
         * 第 2 段階。1 つのファイルの中を変更ごとに選ぶ。
         *
         * 2 つの語が違いのすべてを担っていて、どちらも落とせない。`auto` は作者ではなく
         * **マージが** すでに決めた行で、決着済みとして描き、ホバーすると反対側にも手が届く。
         * ほとんどの場合、何も押さないのが正しい答えだから。`conflict` の行にはその既定が無い。
         * `blocked` の下の理由は、変更ごとの一覧が空なのではなく、そもそも無いことの説明。
         */
        change: {
            expand: "中の変更を表示",
            collapse: "中の変更を隠す",
            loading: "両方のバージョンを読んでいる…",
            /** 一覧の上に一度だけ出す。どの行も繰り返さなくて済むように。 */
            heading: "印の無い行は自動でマージ済み。マージ済みの行にカーソルを合わせると反対側を採れる",
            none: "このファイルの 2 つのバージョンは中身が同一",
            auto: "マージ済み",
            /** マージ済みの行で作者がひっくり返せるほう。2 つのうち片方しか出ない。 */
            useMine: "自分のものを使う",
            useTheirs: "相手のものを使う",
            /** その側にこの項目自体が無い。採るとはそれを採ること。 */
            absent: "存在しない",
            /** 行が描く数個より先のフィールド。選択の根拠になるものは隠さない。 */
            moreFields: "+{count} 件",
            undecided: {
                other: "どちらを残すか決まっていない変更が {count} 件ある",
            },
            /** 第 1 段階に戻る。それぞれ、どの壁に当たったのかを言う。 */
            blocked: {
                title: "このファイルはどちらか一方から丸ごと採るしかない",
                noSpec: "Studio はこのファイルの形式を知らないので、一部だけをマージできない",
                noMerge3: "Studio はこの形式を読めるが、2 つのバージョンを変更ごとにマージできない",
                readOnly: "Studio はこの形式をマージできるが、結果を書き戻せないので、ファイル全体をどちらか一方から採る",
                tooLarge: "このファイルは大きすぎて、変更ごとのマージができない",
                tooMany: "このファイルは変更が多すぎて、1 件ずつ決められない",
                unreadable: "2 つのバージョンのうち一方を読めなかったので、ファイル全体を採るしかない",
            },
        },
    },
    /** 1 つのページ、1 つのグラフの 2 つのバージョンを並べて描き、変更をその場に重ねる。2 つのキャンバスで同じ言葉を使う。 */
    canvas: {
        before: "変更前",
        after: "変更後",
        surfaceLabel: "ページ",
        graphLabel: "ブループリント",
        unnamed: "名前なし",
        /** `moved` がいちばん薄く描かれる理由をそのまま書く。ゲームのふるまいは変わらない。 */
        legend: {
            added: "追加",
            removed: "削除",
            changed: "変更",
            moved: "位置だけ",
        },
        markLabel: "この変更を見る",
        /** ブループリントエディタと同じ語。同じ図で同じ結果になるので、言い換えると別のふるまいに読まれる。 */
        fitView: "全体を表示",
        oneChange: "1 件だけ表示",
        showAll: "すべての変更を表示",
        /** キャンバスに印が付いていない変更を 1 行で言う。9 件に印を付けて残り 3 件を黙るのは、全部で 9 件だと言うのと同じ。 */
        notMarked: {
            other: "ここに印の付いていない変更があと {count} 件ある：",
        },
        onOtherPages: "他のページに {count} 件",
        onOtherGraphs: "他のブループリントに {count} 件",
        offCanvas: "どのページにもないものが {count} 件",
        /** コンポーネントの中の要素はもともと id を持たない。同じコンポーネントのどの実体も内側の id を共有するので、付ければどの配置か分からなくなる。 */
        unplaced: "ページ上に位置を持たないものが {count} 件",
        /** このバージョンのものとして表示できないアセットも、印と同じ行で言う。空の枠のままにはしない。 */
        assetsNotShown: {
            other: "表示していないアセットが {count} 件ある：",
        },
        assetsAbsent: "このバージョンにないものが {count} 件",
        assetsFailed: "読めなかったものが {count} 件",
        notDrawn: "このバージョンのページは描けない",
        emptyGraph: "このグラフにノードがない",
        tooLarge: "このファイルは大きすぎて、ここには描けない",
        unreadable: "このファイルをインターフェースのドキュメントとして読めない：{error}",
        readFailed: "このバージョンを読めない：{error}",
    },
} satisfies LocaleNamespace<"documentDiff">;
