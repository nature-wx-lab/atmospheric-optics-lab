# 大気光学3Dラボ / Atmospheric Optics 3D Lab

虹やハロが「なぜその角度に見えるのか」を、観察者・太陽・水滴・氷晶の3D関係と粒子内部の光路から確かめる、Nature Wx Labの教育用Webツールです。

公開URL: `https://nature-wx-lab.github.io/atmospheric-optics-lab/`

## 現在の公開範囲

開発中のβ版です。初期版は次を実装します。

- ドラッグによる360°回転
- ホイール／ピンチによる拡大縮小
- 一次虹・二次虹の観察者中心の円錐
- 代表7波長の幾何光学による角半径
- 球形水滴内の屈折・部分反射・射出光路
- 太陽高度・方位と雨滴描画密度の操作
- PC・スマホ向けの密度の高い操作画面

ハロ、虹を追うデータ実験、連続semantic zoom、Monte Carlo光線追跡は公開後の段階的な増築対象です。未実装機能を計算済みとは表示しません。

## 科学モデル

- 水滴は理想球、光は幾何光学として扱います。
- 水の屈折率分散はIAPWS R9-97に沿う20℃付近の代表値を固定し、空気の屈折率をほぼ1とする近似です。
- 一次虹は内部反射1回、二次虹は2回です。いずれも全反射ではなく部分反射として説明します。
- 代表7波長は連続スペクトルを理解しやすく表示するサンプルであり、自然の虹が7本の光線に分かれているという意味ではありません。
- 波動光学が必要な過剰虹、回折、干渉、偏光、絶対輝度は初期βの対象外です。

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

公開前とGitHub Actionsで次を検査します。

- 現行ファイルと到達可能な全Git履歴
- author / committerのnoreply allowlist
- commit messageと過去のファイル名・blob
- ローカル絶対パス、メール、秘密値・credential候補
- 動画、スクリーンショット、画像、PDF、DB、表計算、source map、symlink
- Pages配信allowlist
- `deployment.json`のsource commitと全配信ファイルSHA-256

privacy gateが失敗した場合、Pages artifactを作成せず公開を停止します。

## ライセンス

アプリケーションコードの再利用条件は、公開範囲が固まるまで未設定です。依存ライブラリは各ライセンスに従います。Three.jsはMIT Licenseです。
