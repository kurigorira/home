# 家族のアルバム

家族の大切な瞬間を集めた、ミニマル美術館風の観賞用フォトギャラリー。

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

## 写真を追加する（管理者モード）

1. `admin.html` を開き、パスワードを入力（デフォルトは `family`）
2. イベント名・日付・ひとこと（任意）を入力
3. 写真をドラッグ＆ドロップ、または選択
4. キャプションを編集・並び替え
5. **「ZIP を生成してダウンロード」** をクリック
6. ダウンロードした ZIP を解凍し、中身（`photos/` と `data/events.json`）をリポジトリ直下に配置（上書き）
7. コミット＆プッシュ
   ```sh
   git add photos data/events.json
   git commit -m "add event: 春の結婚式"
   git push
   ```
8. GitHub Pages に数十秒で反映されます

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
