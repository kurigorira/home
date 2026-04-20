# 家族のアルバム

家族の大切な瞬間を集めた、ミニマル美術館風の観賞用フォト＆動画ギャラリー。

- **観賞用ページ** `index.html` — 1 ページにメイソンリーで全写真を表示
- **管理者モード** `admin.html` — ブラウザから写真をアップし、ZIP で必要ファイルを出力

依存なし・ビルド不要の素の HTML/CSS/JS。GitHub Pages でそのまま公開できます。

---

## ローカルで見る

```sh
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開くとギャラリー、`http://localhost:8000/admin.html` で管理者モード。

> `file://` で開くと `fetch` がブロックされるため、必ず HTTP サーバ経由で確認してください。

---

## 対応しているメディア

- **写真**: JPG / PNG / WebP / GIF
- **HEIC / HEIF**（iPhone・Google フォトからのダウンロード形式）
  - 管理者画面が**ブラウザ内で自動的に JPG に変換**してアップします
- **動画（ファイル直接）**: MP4 / WebM / MOV
  - **480p 推奨・2 分以内・1 ファイル 100MB 以下**
  - iPhone は「設定 → カメラ → フォーマット → 互換性優先」で MP4 保存にしておくと安心
- **動画（YouTube URL）**: 長尺動画や容量が大きいものは YouTube（限定公開可）にアップして URL を貼るだけで埋め込み再生

---

## 写真・動画を追加する（管理者モード）

### 方法 A：GitHub に直接アップロード（推奨・ボタン一発）

初回のみ GitHub Personal Access Token (PAT) を登録すれば、以降はブラウザから直接公開できます。

1. `admin.html` を開き、パスワード（デフォルトは `family`）で解除
2. **【初回のみ】** Personal Access Token を登録
   - [GitHub のトークン発行ページ](https://github.com/settings/personal-access-tokens/new) を開く
   - Token name: `Family Album` などお好みで
   - Expiration: 1 年など長め推奨
   - Repository access: `Only select repositories` → `kurigorira/home` を選択
   - Repository permissions → **Contents** を **Read and write**
   - **Generate token** → 表示された `github_pat_...` をコピー
   - 管理者画面の欄に貼り付けて「トークンを保存」
3. イベント名・日付・ひとこと（任意）を入力
4. 写真をドラッグ＆ドロップ、キャプション編集・並び替え
5. **「GitHub に直接アップロード」** をクリック
6. 1〜2 分で GitHub Pages に反映 → ギャラリーに表示されます

> トークンはブラウザの `localStorage` に保存されます（このブラウザ・このドメインに限定）。他の端末から使う場合は再登録が必要です。
> 「トークンを再設定」リンクから削除できます。

### 方法 B：ZIP をダウンロードして手動アップ（トークンを使いたくない場合）

1. `admin.html` でイベント情報と写真を入力
2. **「ZIP をダウンロード」** をクリック
3. ZIP を解凍
4. GitHub のリポジトリ [kurigorira/home](https://github.com/kurigorira/home) を開き、**リポジトリ直下**で「Add file → Upload files」
5. 解凍した `photos` と `data` フォルダを**まとめて**ドラッグ&ドロップ
6. Commit → 1〜2 分で反映

> ⚠ GitHub 上ですでに `photos/` に入った状態で `photos/` フォルダをドロップすると、入れ子（`photos/photos/`）になって画像が表示されません。必ずリポジトリ直下で行ってください。

---

## パスワードを変更する

`assets/admin.js` 冒頭の `PASSWORD_HASH` に、新しいパスワードの SHA-256 を設定します。

```sh
# macOS / Linux
echo -n "new-password" | shasum -a 256
```

出力された 64 文字の 16 進文字列を `PASSWORD_HASH` に貼り付けてコミット。

> クライアントサイドのパスワードはあくまで「カジュアルな目隠し」です。本物の認証ではないため、本当に秘密にしたい写真は公開リポジトリに置かないでください。

---

## GitHub Pages で公開する

1. GitHub のリポジトリ **Settings → Pages**
2. **Source**: `Deploy from a branch`
3. **Branch**: 公開したいブランチ（例：`main`）、フォルダ `/ (root)`
4. 保存 → 数十秒後に `https://<ユーザー名>.github.io/home/` で公開

---

## ディレクトリ構成

```
/
├── index.html              # ギャラリー
├── admin.html              # 管理者モード
├── assets/
│   ├── style.css
│   ├── gallery.js
│   └── admin.js
├── data/
│   └── events.json         # サイトタイトル + イベント一覧
├── photos/
│   └── <slug>/             # イベントごとの写真
└── .nojekyll
```

### `data/events.json` の形

```json
{
  "site": { "title": "家族のアルバム", "subtitle": "Our Family Memories" },
  "events": [
    {
      "slug": "2026-03-wedding",
      "title": "春の結婚式",
      "date": "2026-03-15",
      "description": "桜の咲く日に",
      "photos": [
        { "src": "photos/2026-03-wedding/01.jpg", "w": 3000, "h": 2000, "caption": "" }
      ]
    }
  ]
}
```

サイト名を変えたいときは `site.title` / `site.subtitle` を編集してコミット。

---

## よくある調整

| やりたいこと | 場所 |
| --- | --- |
| 配色やフォントを変える | `assets/style.css` の `:root` |
| 段組みの数を変える | `assets/style.css` の `.masonry` メディアクエリ |
| 写真を手動で削除 | `data/events.json` の該当エントリ + `photos/<slug>/` を削除してコミット |
| 初期サンプルを消す | `photos/2026-03-sample/` と `data/events.json` の該当イベントを削除 |
