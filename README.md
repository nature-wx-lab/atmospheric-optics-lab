# 大気光学3Dラボ / Atmospheric Optics 3D Lab

虹やハロが「なぜその角度に見えるのか」を、観察者・太陽・水滴・氷晶の3D関係と粒子内部の光路から確かめる、Nature Wx Labの教育用Webツールです。

公開URL: `https://nature-wx-lab.github.io/atmospheric-optics-lab/`

## 現在の公開範囲

開発中のβ版です。現在の公開版は次を実装しています。

- ドラッグによる360°回転
- ホイール／ピンチによる拡大縮小
- 一次虹・二次虹の観察者中心の円錐
- 代表7波長の幾何光学による角半径
- 球形水滴内の屈折・部分反射・射出光路
- 太陽高度・方位と雨滴描画密度の操作
- 固定した24,000滴の雨域内を観察者が500 m移動する「虹を追う」数値実験
- 移動前後の虹角度、寄与水滴数、共通する水滴ID、距離標本の比較
- 22°ハロ、46°ハロ、幻日、環天頂アーク、上部タンジェントアーク、環水平アーク
- 数式から求めた環状ハロ、投影近似、模式図を画面上で明確に区別
- 全景と水滴1粒を行き来する段階的な意味的ズーム
- キーボード操作、スマートフォン表示、必要時だけ描画する省負荷レンダリング
- PC・スマホ向けの密度の高い操作画面

氷晶内を通る光線の完全な3D追跡、波動光学、強度分布、Monte Carlo光線追跡、全現象を連続スケールでつなぐ意味的ズームは今後の増築対象です。未計算の光路や現象を計算済みとは表示しません。

## 科学モデル

- 水滴は理想球、光は幾何光学として扱います。
- 水の屈折率分散はIAPWS R9-97に沿う20℃付近の代表値を固定し、空気の屈折率をほぼ1とする近似です。
- 一次虹は内部反射1回、二次虹は2回です。いずれも全反射ではなく部分反射として説明します。
- 代表7波長は連続スペクトルを理解しやすく表示するサンプルであり、自然の虹が7本の光線に分かれているという意味ではありません。
- 「虹を追う」は固定した有限の雨滴標本を使う再現可能な数値実験です。角度がほぼ同じまま寄与する水滴群が変わることと、角度だけでは虹までの距離を一意に決められないことを示します。
- 22°・46°ハロは氷の六角柱プリズムの最小偏角を計算します。幻日は水平板状氷晶の投影近似、向きに依存する3種のアークは太陽高度条件を示す模式図です。
- ハロ画面の黄色い線は光路の案内模式で、氷晶内の屈折点・入射角・射出角を計算した光線追跡ではありません。
- 波動光学が必要な過剰虹、回折、干渉、偏光、絶対輝度は現βの対象外です。

主な資料:

- IAPWS R9-97, Refractive Index of Ordinary Water Substance
- WMO International Cloud Atlas, Primary Rainbow / Secondary Bow / Halo entries
- AMS Glossary of Meteorology, Rainbow / Halo
- Warren & Brandt (2008), Optical constants of ice

## ローカル起動

Node.js 24とpnpm 11を使用します。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

検証:

```bash
pnpm test
pnpm build
node scripts/verify-build.mjs
python3 scripts/privacy_gate.py
```

## 公開安全設計

このリポジトリだけを独立した公開正本とし、親の非公開作業場、参考動画、スクリーンショット、ローカルデータ、個人情報をコピーしません。

公開前にローカルで、さらにGitHub Actionsを防御の二段目として次を検査します。

- 現行ファイルと到達可能な全Git履歴
- author / committerのnoreply allowlist
- commit messageと過去のファイル名・blob
- ローカル絶対パス、メール、秘密値・credential候補
- 動画、スクリーンショット、画像、PDF、DB、表計算、source map、symlink
- Pages配信allowlist
- `deployment.json`のsource commitと全配信ファイルSHA-256

push前に全履歴privacy gateを必ず合格させ、公開リポジトリへ不適切な履歴を送らないことを第一の防止策にします。GitHub Actions側でも同じ検査を再実行し、失敗時はPages artifactを作成せず配信更新を停止します。

## ライセンス

アプリケーションコードの再利用条件は、公開範囲が固まるまで未設定です。依存ライブラリは各ライセンスに従います。Three.jsはMIT Licenseです。
