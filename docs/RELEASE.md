# リリース手順

## 公開前

1. `npm ci && npm run check && npm run test:performance` を実行する。
2. `npm run test:e2e:install` の後、`npm run test:e2e` を実行する。
3. アプリの「プロジェクト一覧」から全曲バックアップを保存し、別ブラウザの空のプロファイルへ一括復元する。
4. v1 / v2 のプロジェクト移行フィクスチャが CI で通ることを確認する。
5. `package.json`、`package-lock.json`、画面、ユーザーガイド、パラメーターリファレンス、TODOのバージョンを一致させる。
6. リリースノートへ主な変更、互換性上の注意、直前タグからのFull Changelogリンクを記載する。

## 公開

1. `v1.2.0` のように `package.json` と一致する注釈付きタグを作る。
2. リリースコミットを `main` へpushし、CIの成功を確認する。
3. タグをpushする。`Deploy release to GitHub Pages` が、そのタグ名とコミットSHAをビルドIDへ埋め込んで公開する。
4. 同じタグからGitHub Releaseを作成し、Latestにする。
5. Actionsの成功後、公開URLで画面のバージョン、生成、候補比較、再生、オフライン再起動を確認する。

GitHub の Settings → Pages では Source を GitHub Actions にする。

## ロールバック

1. 最後に正常だったタグを GitHub 上で開く。
2. Actions の `Deploy release to GitHub Pages` を、そのタグを ref に指定して手動実行する。
3. 公開URLで画面のバージョン、オフライン再起動、生成、保存済みプロジェクトの読込を確認する。

Service Worker の更新に失敗した利用者は、更新通知の「アプリキャッシュだけ修復」を使う。この操作は localStorage のプロジェクトや IndexedDB / OPFS のユーザー音源を削除しない。ブラウザのサイトデータ削除はすべてを消すため、先に全曲バックアップを保存する。
