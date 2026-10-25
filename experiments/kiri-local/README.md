# Kiri:Moto 内蔵化検証 — 技術設計メモ

> **状態:** 設計・調査完了、構築およびブラウザ動作は未検証。
>
> **重要:** main ブランチの v0.4.9（CAD→公式Kiri:Motoへの直接転送）はそのまま残す。内蔵版が iPad と Chromebook で通し動作するまで差し替えない。

## 決定事項

**第一候補: Kiri:Moto のフルUIを同一オリジンでセルフホストして既存アプリへ iframe 組み込み。**

- まなび3D Studio 側のCAD、STL生成、編集形式、独立プレビューは維持する。
- Kiri:Motoは公式のUIと機能をできるだけそのまま使う。スライス層表示やG-code出力UIを再発明しない。
- 現在の `https://grid.space/kiri/` iframe は安定版のフォールバックとして維持する。
- 将来は同一配信元の `./kiri/` または `./vendor/kiri/` を埋め込み、STLのArrayBufferを直接渡す（Blob URL／data URL依存の解消）。
- **同一オリジン化だけでは自動的に動作しない。** Kiri側のビルド成果物・CSS・Worker・WASM・プリンタープロファイル・初期化手順が必要。

## なぜ「エンジン単体」ではない？

公式 `src/kiri/run/engine.js` に `parse(data)`, `slice()`, `prepare()`, `export()` がある。スライス処理自体の組み込みは可能。しかしこの API だけでは Kiri:Moto のスライサーUI／積層プレビューが手に入らない。学校向けに画面を維持したい現状ではUIも一緒にホストする方が仕様に合う。

関連公式資料:
- https://github.com/GridSpace/grid-apps
- https://docs.grid.space/kiri-moto/apis/
- https://docs.grid.space/kiri-moto/engine-apis/
- https://grid.space/kiri/frame.html
- https://grid.space/kiri/engine.html

## 調査で確認した実装上の落とし穴

1. Kiriの現行ソース `src/kiri/app/frame.js` は `load.STL().parse(bin, callback)` と呼んでいるが、`src/load/stl.js` の `parse(data, scale)` は同期的に Float32Array を返す。第2引数はコールバックではない。**生STLを postMessage する経路は、独自ビルド内で検証・修正が必要**。
2. 同じ `frame.js` で返信の `postMessage` に送信先 origin が渡されていない。このため `parsed/loaded` の到達確認は信用しにくい。ローカルの frame API を `source.postMessage(message, origin)` へ調整する候補。
3. 本家UIの `web/kiri/index.html` には `/moto/...`, `/font/...`, `/lib/...`, `/boot/...` 等のルート絶対パスがある。GitHub Pages は `/manabi-3d-studio/` 配下なので、**パス調整が必要**。さらに service worker の scope とオフラインキャッシュも変更・検証が必要。
4. `bin/esbuild.config.mjs` ではUI用だけでなく `kiri-work.js` (worker), `kiri-pool.js` (pool), `kiri-eng.js` (engine) を別々にバンドルする。単独HTMLにJavaScriptの文字列を貼るだけでは完結しない。
5. 公式の実行手順はNode.js/専用アプリサーバーも案内しているため、**ビルドした成果物がGitHub Pagesの静的配信だけで完全動作するかは未検証**。動かなければGitHub Actionsでビルド＋静的配信に合わせて調整するか、配信方法を再検討する。
6. MITライセンスの表示、著作権表示、外部依存関係のライセンスも維持する（`https://github.com/GridSpace/grid-apps/blob/master/license.md`）。

## 実装ステップ

### Phase 1: 独立ビルド
- 公式コードの再現可能なコミットSHAを固定し、Node.js環境で本家Kiriをビルド。
- ビルド成果物の構成を記録。アップストリーム全体を手でコピーしない。
- 別画面 `experiments/kiri-local/` で同一配信元の起動・workerロード・WASMロードを検証。
- 失敗時には現在の公式Kiri iframeに即戻せるようにする。

### Phase 2: 通信ブリッジ
- 独立起動が確認できたら、フレームの受け側を修正。
- CADのSTLバイナリ `ArrayBuffer` を `postMessage` の transferable として渡す。
- パース終了時は `parsed` + モデル数と識別子を返信。受信した事実と**実際にモデルが画面に出たこと**を分けて扱う。
- 送信前にモデルの無い状態へ戻す処理とエラー時の巻き戻しを設ける。

### Phase 3: iPad / Chromebook 互換
- iPad Safari／Chrome、学校のChromebook、PC ChromeでCAD→Kiriを10回繰り返す。
- ブラウザのページ遷移、タブ再表示、Kiri再起動、ネット切断後の操作（オフラインは実装できた場合のみ）を検証。
- 穴あけしたモデル、日本語の文字の押し出し形状、複数体、STLサイズ上限をテスト。
- worker起動不可・メモリ不足・ブラウザ制限を区別してUI表示する。

### Phase 4: 印刷データ互換
- スライス後の積層プレビュー、G-code書き出し、再読み込みをチェック。
- **A1 mini向け `.gcode.3mf` 出力を保証しない。** プリンター固有の形式と印刷開始・終了コードは別途検証。
- 安全な検証が済むまで「そのまま印刷可能」と表示しない。

## 完了判定

- [ ] KiriフルUIが自前配信元で表示される
- [ ] 配布に必要なWorker/WASMがロードされる
- [ ] CAD→KiriのSTL直接転送成功をKiri本体で目視・イベント両方で確認
- [ ] 範囲選択・穴あけ・日本語文字入りモデルを読める
- [ ] Kiriで実際にSliceし積層表示される
- [ ] G-codeが端末へ保存できる（プリンター互換は別チェック）
- [ ] iPad Safari、Chromebook Chromeで複数回の成功を確認
- [ ] 従来版への即時復帰経路がある

## 本体の扱い

`main/index.html` は今の転送ができるバージョンを維持。実験ブランチでは最初はドキュメント・ビルド・調査成果のみ扱う。検証前のスライサー差し替えは main にコミットしない。
