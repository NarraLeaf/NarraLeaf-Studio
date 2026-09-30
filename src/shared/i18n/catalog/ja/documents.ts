/** `documents` - 読み込みを拒否したプロジェクトファイルについて、読み手が述べること。 */
export const documents = {
    tooNew: {
        message: "{subject} は新しいバージョンの NarraLeaf Studio が書き込んだもの（{kind}形式 v{version}）、このビルドが読めるのは v{supported} まで",
        kind: {
            story: "ストーリー",
            storyIndex: "ストーリーライブラリ",
            storyAnimation: "アニメーション",
            uiDocument: "ページ",
            uiGraphs: "ページブループリント",
            blueprints: "ブループリント",
            variables: "変数",
            saveSchema: "セーブ構造",
            localization: "翻訳",
            localizationKeys: "翻訳キー",
            voice: "ボイス",
            brand: "デザイン",
            appTags: "バリアント",
            dlc: "DLC",
            assetSets: "アセットセット",
            audioTracks: "オーディオトラック",
            characters: "キャラクター",
        },
    },
} as const;
