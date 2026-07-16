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
- 虹の全景から同じ寄与水滴、2 mm球形模型、代表光線、7波長までをつなぐ連続的な対数意味ズーム
- 530 nmの代表停留光線を、入射・屈折・内部反射・射出の順に描く逐次表示
- 内部反射面1面のFresnel反射率と、反射せず水滴外へ透過する光の枝
- 太陽高度・方位と雨滴描画密度の操作
- 固定した24,000滴の雨域内を観察者が500 m移動する「虹を追う」数値実験
- 移動前後の虹角度、寄与水滴数、共通する水滴ID、距離標本の比較
- 22°ハロ、46°ハロ、幻日、環天頂アーク、上部タンジェントアーク、環水平アーク
- 数式から求めた環状ハロ、投影近似、模式図を画面上で明確に区別
- 連続スケールrange、ホイール、2本指ピンチ、ボタン、キーボードを同じズーム状態へ統合
- スマートフォン縦・横の第一画面に主要操作と3Dを収め、必要時だけ描画する省負荷レンダリング
- PC・スマホ向けの密度の高い操作画面

氷晶内を通る光線の完全な3D追跡、Airy／Lorenz–Mieによる波動光学、絶対強度・偏光、有限な太陽視直径、Monte Carlo光線追跡、雨滴の非球形状は今後の増築対象です。未計算の光路や現象を計算済みとは表示しません。

## 科学モデル

- 水滴は理想球、光は幾何光学として扱います。
- 水の屈折率分散はIAPWS R9-97に沿う20℃付近の代表値を固定し、空気の屈折率をほぼ1とする近似です。
- 一次虹は内部反射1回、二次虹は2回です。いずれも全反射ではなく部分反射として説明します。
- 停留光線は、内部反射回数を `k` とした解析条件 `cos²(i) = (n² − 1) / (k(k + 2))` から求めます。
- 530 nmの内部反射面1面では、s偏光・p偏光別と無偏光平均のFresnel反射率を計算します。入射面・射出面の損失は含めず、虹全体の強度ではありません。破線は、この虹次数の経路から外れる透過枝です。線の明るさは率に比例しません。
- 代表7波長は連続スペクトルを理解しやすく表示するサンプルであり、自然の虹が7本の光線に分かれているという意味ではありません。
- 水滴模型は直径2.0 mmの理想球です。実際の大きな雨滴は扁平・非対称になるため、内部光路を理解するための単純化です。
- 「虹を追う」は固定した有限の雨滴標本を使う再現可能な数値実験です。角度がほぼ同じまま寄与する水滴群が変わることと、角度だけでは虹までの距離を一意に決められないことを示します。
- 22°・46°ハロは氷の六角柱プリズムの最小偏角を計算します。幻日は水平板状氷晶の投影近似、向きに依存する3種のアークは太陽高度条件を示す模式図です。
- ハロ画面の黄色い線は光路の案内模式で、氷晶内の屈折点・入射角・射出角を計算した光線追跡ではありません。
- 波動光学が必要な過剰虹、回折、干渉、偏光、絶対輝度は現βの対象外です。

## 連続ズームのモデル

虹は距離が一意に決まる物体ではないため、300 m先に固定した虹へ実寸カメラで接近する実装にはしていません。530 nmの計算虹角上に代表水滴を1個置き、そのID・位置・太陽光方向・観察者へ戻る方向を全区間で保持します。

物理的な画角ではなく、学習段階を表す意味スケール指標を約300 m相当から350 µm相当まで対数補間します。遠景模型と水滴を中心とする局所模型を重ね、透明度・大きさ・カメラ注視点を連続補間します。画面上は途切れませんが、kmとmmを同じThree.js座標の実寸として扱わない「意味ズーム」です。この数値はカメラ画角や画面寸法から校正した実測縮尺ではありません。代表水滴を置く距離は説明用で、虹の固有距離ではありません。

表示段階:

1. 観察者中心の虹円錐と雨滴場
2. 530 nmの虹角条件を満たす同じ代表水滴
3. 直径2.0 mmの球形水滴模型
4. 代表停留光線1本の逐次光路
5. 代表7波長と部分透過枝

主な資料:

- [IAPWS R9-97, Refractive Index of Ordinary Water Substance](https://iapws.org/documents/release/Rindex.download)
- [Nussenzveig (1969), High-Frequency Scattering by a Transparent Sphere. II. Theory of the Rainbow and the Glory](https://doi.org/10.1063/1.1664747)
- [Adam (2002), The mathematical physics of rainbows and glories](https://doi.org/10.1016/S0370-1573(01)00076-X)
- [Vollmer & Tammer (1999), Laboratory experiments in atmospheric optics](https://doi.org/10.1364/OE.5.000075)
- [Wang & van de Hulst (1991), Rainbows: Mie computations and the Airy approximation](https://doi.org/10.1364/AO.30.000106)
- [Beard & Chuang (1987), A New Model for the Equilibrium Shape of Raindrops](https://doi.org/10.1175/1520-0469(1987)044%3C1509:ANMFTE%3E2.0.CO;2)
- [van Wijk & Nuij (2003), Smooth and efficient zooming and panning](https://doi.org/10.1109/INFVIS.2003.1249004)
- [WMO International Cloud Atlas, Halo phenomena](https://cloudatlas.wmo.int/en/halo-phenomena.html)
- [AMS Glossary of Meteorology, Rainbow](https://glossary.ametsoc.org/wiki/rainbow/)
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
