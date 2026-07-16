import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "./styles.css";
import {
  RainbowChaseModel,
  compareChaseSnapshots,
  type ChaseSnapshot
} from "./physics/chase";
import {
  HALO_SPECTRAL_SAMPLES,
  projectedSundogOffsetDeg,
  type HaloPhenomenonId
} from "./physics/halo";
import {
  SPECTRAL_SAMPLES,
  findStationaryRay,
  rainbowAngleRange,
  type RainbowOrder
} from "./physics/rainbow";
import { ChaseExperiment } from "./scenes/chaseExperiment";
import { DropletDetail } from "./scenes/dropletDetail";
import { HaloOverview } from "./scenes/haloOverview";
import { RainbowOverview } from "./scenes/rainbowOverview";

type ViewName = "overview" | "chase" | "droplet" | "halo";

interface AppState {
  view: ViewName;
  order: RainbowOrder;
  sunElevation: number;
  sunAzimuth: number;
  particleDensity: number;
  observerDistanceM: number;
  haloPhenomenon: HaloPhenomenonId;
}

const CHASE_SUN_ELEVATION = 12;
const CHASE_SUN_AZIMUTH = 225;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`required element not found: ${selector}`);
  return element;
}

function setText(selector: string, value: string): void {
  requireElement<HTMLElement>(selector).textContent = value;
}

function setHidden(selector: string, hidden: boolean): void {
  requireElement<HTMLElement>(selector).hidden = hidden;
}

function normalizedDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function setFacts(
  labels: readonly [string, string, string, string],
  values: readonly [string, string, string, string]
): void {
  ["#fact-1-label", "#fact-2-label", "#fact-3-label", "#fact-4-label"].forEach(
    (selector, index) => setText(selector, labels[index] ?? "")
  );
  ["#center-value", "#reflection-value", "#red-angle-value", "#violet-angle-value"].forEach(
    (selector, index) => setText(selector, values[index] ?? "")
  );
}

function setModelItems(items: readonly [string, string, string, string]): void {
  items.forEach((item, index) => setText(`#model-${index + 1}`, item));
}

function rainbowVisibilityNote(order: RainbowOrder, sunElevation: number): string {
  const range = rainbowAngleRange(order);
  return sunElevation >= range.maximumDeg
    ? `太陽高度${sunElevation}°では、この次数の円錐は空側に出ません。3Dでは地平線下を含む全円錐を残しています。`
    : `太陽高度${sunElevation}°では円錐の一部が地平線より上に出ます。3Dは地平線下を含む全円錐です。`;
}

const state: AppState = {
  view: "overview",
  order: 1,
  sunElevation: 12,
  sunAzimuth: 225,
  particleDensity: 0.7,
  observerDistanceM: 0,
  haloPhenomenon: "halo-22"
};

const canvas = requireElement<HTMLCanvasElement>("#optics-canvas");
const stage = requireElement<HTMLElement>("#scene-stage");
const fallback = requireElement<HTMLElement>("#webgl-fallback");

let renderer: THREE.WebGLRenderer | null = null;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
} catch (error) {
  console.error("WebGL initialization failed", error);
  fallback.hidden = false;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020507);
scene.fog = new THREE.FogExp2(0x020507, 0.013);

const camera = new THREE.PerspectiveCamera(46, 1, 0.03, 250);
camera.position.set(18, 10, 24);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.6, 0);
controls.enableDamping = false;
controls.enablePan = false;
controls.minDistance = 4.7;
controls.maxDistance = 62;
controls.minPolarAngle = 0.08;
controls.maxPolarAngle = Math.PI - 0.08;
controls.rotateSpeed = 0.58;
controls.zoomSpeed = 0.75;
controls.update();

scene.add(new THREE.HemisphereLight(0x9adce8, 0x071014, 1.55));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
keyLight.position.set(-8, 10, 7);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x4eb9d4, 1.2);
rimLight.position.set(9, -2, -5);
scene.add(rimLight);

const overview = new RainbowOverview();
const chase = new ChaseExperiment({
  order: state.order,
  sunElevationDeg: CHASE_SUN_ELEVATION,
  sunAzimuthDeg: CHASE_SUN_AZIMUTH
});
const droplet = new DropletDetail();
const halo = new HaloOverview();
chase.setVisible(false);
scene.add(overview.group, chase.group, droplet.group, halo.group);

let chaseBaseline: ChaseSnapshot = new RainbowChaseModel({
  order: state.order,
  sunElevationDeg: CHASE_SUN_ELEVATION,
  sunAzimuthDeg: CHASE_SUN_AZIMUTH
}).snapshot(0);

const sceneRegistry = { overview, chase, droplet, halo } as const;

function cameraDistance(): number {
  return camera.position.distanceTo(controls.target);
}

function setCameraDistance(multiplier: number): void {
  if (
    state.view === "overview" &&
    multiplier < 1 &&
    cameraDistance() <= controls.minDistance + 0.5
  ) {
    setView("droplet");
    return;
  }
  if (
    state.view === "droplet" &&
    multiplier > 1 &&
    cameraDistance() >= controls.maxDistance - 0.6
  ) {
    setView("overview");
    return;
  }
  const offset = camera.position.clone().sub(controls.target);
  const nextDistance = THREE.MathUtils.clamp(
    offset.length() * multiplier,
    controls.minDistance,
    controls.maxDistance
  );
  camera.position.copy(controls.target).add(offset.normalize().multiplyScalar(nextDistance));
  controls.update();
  updateCameraReadout();
}

function resetCamera(): void {
  if (state.view === "overview") {
    camera.position.set(18, 10, 24);
    controls.target.set(0, 0.6, 0);
    controls.minDistance = 8;
    controls.maxDistance = 62;
  } else if (state.view === "chase") {
    camera.position.set(12, 8, 17);
    controls.target.set(0, 2.2, 0);
    controls.minDistance = 6;
    controls.maxDistance = 44;
  } else if (state.view === "droplet") {
    camera.position.set(0.8, 0.7, 12.8);
    controls.target.set(0, 0, 0);
    controls.minDistance = 4.7;
    controls.maxDistance = 28;
  } else {
    camera.position.set(18, 10, 24);
    controls.target.set(0, 1.2, 0);
    controls.minDistance = 5;
    controls.maxDistance = 62;
  }
  controls.update();
  updateCameraReadout();
}

function focusCurrentParticle(): void {
  if (state.view === "overview" || state.view === "chase") {
    setView("droplet");
  } else if (state.view === "droplet") {
    setView("overview");
  } else {
    controls.target.set(3.8, 2.35, 1.2);
    camera.position.set(9.4, 6.2, 8.8);
    controls.minDistance = 3.2;
    controls.maxDistance = 28;
    controls.update();
    updateCameraReadout();
  }
}

function syncCurrentScene(): void {
  if (state.view === "overview") {
    overview.setConditions(state.order, state.sunElevation, state.sunAzimuth);
    overview.setDensity(state.particleDensity);
  } else if (state.view === "chase") {
    chase.setOrder(state.order);
    chase.setObserverDistance(state.observerDistanceM);
  } else if (state.view === "droplet") {
    droplet.setOrder(state.order);
  } else {
    halo.setConditions(state.haloPhenomenon, state.sunElevation, state.sunAzimuth);
    halo.setDensity(state.particleDensity);
  }
}

function renderControlVisibility(): void {
  const isChase = state.view === "chase";
  const isHalo = state.view === "halo";
  const usesDensity = state.view === "overview" || isHalo;
  setHidden("#order-controls", isHalo);
  setHidden("#elevation-control", isChase);
  setHidden("#azimuth-control", isChase);
  setHidden("#density-control", !usesDensity);
  setHidden("#chase-controls", !isChase);
  setHidden("#halo-controls", !isHalo);
  setHidden("#chase-data", !isChase);

  setText(
    "#focus-particle",
    state.view === "droplet"
      ? "虹の全景へ"
      : state.view === "halo"
        ? "氷晶へ寄る"
        : "水滴1粒へ"
  );
}

function setView(view: ViewName): void {
  state.view = view;
  (Object.entries(sceneRegistry) as [ViewName, (typeof sceneRegistry)[ViewName]][]).forEach(
    ([name, entry]) => entry.setVisible(name === view)
  );

  document.querySelectorAll<HTMLButtonElement>(".mode-tab[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    if (active) button.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  renderControlVisibility();
  syncCurrentScene();
  resetCamera();
  updateExplanation();
  requestRender();
}

function updateRainbowExplanation(): void {
  const range = rainbowAngleRange(state.order);
  const isPrimary = state.order === 1;
  const orderLabel = isPrimary ? "一次虹" : "二次虹";
  setText("#angle-label", `${orderLabel}の角半径`);
  setText("#angle-value", `${range.minimumDeg.toFixed(1)}°–${range.maximumDeg.toFixed(1)}°`);
  setText(
    "#angle-context",
    state.view === "overview"
      ? rainbowVisibilityNote(state.order, state.sunElevation)
      : isPrimary
        ? "赤が外側・紫が内側。水滴内の代表7波長を分けて表示します。"
        : "一次虹より外側で色順が逆。赤が内側・紫が外側です。"
  );
  setFacts(
    ["中心", "内部反射", "赤 656.3 nm", "紫 404.7 nm"],
    [
      "観察者の反太陽点",
      `${state.order}回（部分反射）`,
      `${range.redDeg.toFixed(1)}°`,
      `${range.violetDeg.toFixed(1)}°`
    ]
  );
  setText(
    "#reflection-note",
    isPrimary
      ? "水滴内で1回の部分反射。赤が外側、紫が内側。"
      : "水滴内で2回の部分反射。色順が逆になり、赤が内側。"
  );

  if (state.view === "overview") {
    setText("#scene-kicker", "RAIN FIELD → RAINBOW");
    setText("#scene-title", "無数の水滴がつくる「見える角度」");
    setText("#scale-readout", "雨域：数百m");
    setText(
      "#view-state",
      `${orderLabel} ${range.minimumDeg.toFixed(1)}°–${range.maximumDeg.toFixed(1)}° / 観察者中心の円錐`
    );
    setText("#explanation-title", "虹は空に貼り付いた物体ではない");
    setText(
      "#explanation-body",
      "反太陽方向へ計算角で光を返す水滴だけが虹の一部になります。全円錐は外から確認する幾何模型で、実際の空では地平線より上の部分だけが見えます。"
    );
  } else {
    const middle = SPECTRAL_SAMPLES[3];
    const ray = middle ? findStationaryRay(middle.waterIndex, state.order) : null;
    setText("#scene-kicker", "ONE DROPLET → LIGHT PATH");
    setText("#scene-title", "1粒の中で、光はどう曲がる？");
    setText("#scale-readout", "代表水滴：数mm");
    setText("#view-state", `屈折 → ${state.order}回の部分反射 → 屈折`);
    setText("#explanation-title", `${state.order}回反射する代表光路`);
    setText(
      "#explanation-body",
      ray
        ? `緑 ${middle?.wavelengthNm ?? 530} nmでは、入射角${ray.incidenceDeg.toFixed(1)}°、水中の屈折角${ray.refractionDeg.toFixed(1)}°付近で光が集中します。内部反射は全反射ではなく部分反射です。`
        : "代表波長の光路を計算できませんでした。"
    );
  }

  setText("#fps-state", "WebGL 2 / 代表7波長");
  setModelItems([
    "球形水滴・幾何光学・空気の屈折率を1とする近似です。",
    "代表波長404.7–656.3 nmの水の分散を使います。",
    "波動光学が必要な過剰虹・干渉・偏光・絶対輝度は未計算です。",
    "雨滴密度と全円錐表示は理解用で、実際の降水量や可視範囲ではありません。"
  ]);
}

function updateChaseExplanation(): void {
  const { snapshot } = chase.getState();
  const fromStart = compareChaseSnapshots(chaseBaseline, snapshot);
  const sampleId = snapshot.contributingDropletIds[0] ?? "該当なし";
  const sampledRange = snapshot.sampledDistanceRangeM;
  const distanceRange = sampledRange.minimum === null || sampledRange.maximum === null
    ? "該当水滴なし"
    : `${sampledRange.minimum.toFixed(0)}–${sampledRange.maximum.toFixed(0)} m`;

  setText("#scene-kicker", "OBSERVER-CENTRED EXPERIMENT");
  setText("#scene-title", "虹を追うと、寄与する水滴はどう変わる？");
  setText("#scale-readout", `移動：${snapshot.observerDistanceM.toFixed(0)} / 500 m`);
  setText(
    "#view-state",
    `移動 ${snapshot.observerDistanceM.toFixed(0)} m / 角半径 ${snapshot.rainbowRadiusDeg.toFixed(1)}°`
  );
  setText("#fps-state", "固定24,000滴 / ID比較");
  setText("#angle-label", "移動しても変わらない代表角");
  setText("#angle-value", `${snapshot.rainbowRadiusDeg.toFixed(3)}°`);
  setText(
    "#angle-context",
    `太陽は高度${CHASE_SUN_ELEVATION}°・方位${CHASE_SUN_AZIMUTH}°に固定。虹の角度は方向を選びますが、固有の距離は決めません。`
  );
  setFacts(
    ["観察者の移動", "寄与する水滴", "開始時から入／出", "寄与IDの例"],
    [
      `${snapshot.observerDistanceM.toFixed(0)} m`,
      `${formatCount(snapshot.contributingDroplets.length)}滴`,
      `${formatCount(fromStart.enteredIds.length)} / ${formatCount(fromStart.exitedIds.length)}`,
      sampleId
    ]
  );
  setText("#explanation-title", "追うほど、同じ『物体』へ近づくわけではない");
  setText(
    "#explanation-body",
    "固定した雨滴場の中で観察者だけを動かすと、開始時と同じ水滴が一部残る場合もありますが、計算角に入る集合は変化します。虹は観察者ごとに選び直される光の方向です。"
  );
  setText("#chase-position-value", `${snapshot.observerDistanceM.toFixed(0)} m`);
  setText("#chase-angle-value", `${snapshot.rainbowRadiusDeg.toFixed(6)}°`);
  setText("#chase-droplet-value", `${formatCount(snapshot.contributingDroplets.length)}滴`);
  setText(
    "#chase-overlap-value",
    `${formatCount(fromStart.retainedIds.length)}滴 / ${(fromStart.overlapFraction * 100).toFixed(1)}%`
  );
  setText(
    "#chase-distance-note",
    `同じ角度条件に入る標本距離は ${distanceRange}。これは有限の雨滴モデル内の範囲で、虹までの距離ではありません。`
  );
  setModelItems([
    "固定seedの24,000滴と識別IDを使い、反太陽方位へ0–500 m移動します。",
    `代表波長${snapshot.wavelengthNm} nm、許容角を含む幾何モデルです。`,
    "短い移動では同じ水滴が残る場合があり、全水滴の完全交換は仮定しません。",
    snapshot.modelStatement
  ]);
}

function habitLabel(habit: "plate" | "column" | "plate-or-column"): string {
  if (habit === "plate") return "板状六角晶";
  if (habit === "column") return "柱状六角晶";
  return "板状・柱状六角晶";
}

function orientationLabel(orientation: "random" | "horizontal-plate" | "horizontal-column"): string {
  if (orientation === "random") return "ランダム";
  if (orientation === "horizontal-plate") return "板面が水平";
  return "柱軸が水平";
}

function updateHaloExplanation(): void {
  const snapshot = halo.getSnapshot();
  const phenomenon = snapshot.phenomenon;
  const range = snapshot.referenceMinimumDeviation;
  const computedRing = phenomenon.anglePlacement === "computed-minimum-deviation";
  const projected = phenomenon.anglePlacement === "projected-minimum-deviation";
  const offsets = projected
    ? HALO_SPECTRAL_SAMPLES.map((sample) =>
        projectedSundogOffsetDeg(sample.iceIndex, state.sunElevation)
      ).filter((value): value is number => value !== null)
    : [];
  const angleValue = computedRing
    ? `${range.minimumDeg.toFixed(1)}°–${range.maximumDeg.toFixed(1)}°`
    : projected && offsets.length > 0
      ? `${Math.min(...offsets).toFixed(1)}°–${Math.max(...offsets).toFixed(1)}°`
      : `${phenomenon.minimumSunElevationDeg.toFixed(0)}°–${phenomenon.maximumSunElevationDeg.toFixed(1)}°`;

  setText("#scene-kicker", "ICE CRYSTALS → HALO FAMILY");
  setText("#scene-title", `${phenomenon.labelJa}と氷晶の向き・光路`);
  setText("#scale-readout", "空：数km / 氷晶：mm–cm");
  setText(
    "#view-state",
    `${phenomenon.labelJa} / ${computedRing ? "角度計算" : projected ? "投影近似" : "模式表示"} / 黄線:光路模式`
  );
  setText("#fps-state", "代表7波長 / 六角氷晶");
  setText(
    "#angle-label",
    computedRing ? `${phenomenon.labelJa}の角半径` : projected ? "太陽からの投影偏角" : "代表的な出現太陽高度"
  );
  setText("#angle-value", angleValue);
  setText(
    "#angle-context",
    `${snapshot.availabilityNoticeJa} ${computedRing ? "リングは屈折率から計算しています。" : projected ? "位置は水平板状晶の投影近似です。" : "弧の厳密な位置・形・輝度は未計算です。"}`
  );
  setFacts(
    ["結晶", "主な向き", "基準プリズム", "現在の条件"],
    [
      habitLabel(phenomenon.crystalHabit),
      orientationLabel(phenomenon.orientation),
      `${range.prismApexDeg}°光路`,
      snapshot.visibleAtCurrentSun ? "出現条件内" : "出現条件外"
    ]
  );
  setText("#explanation-title", phenomenon.rayPathJa);
  setText(
    "#explanation-body",
    `${phenomenon.modelNoticeJa} ${snapshot.representativeRayGuideNoticeJa}`
  );
  setText("#halo-model-note", `${phenomenon.modelNoticeJa} ${snapshot.availabilityNoticeJa}`);
  setModelItems([
    computedRing
      ? "22°・46°リングは氷の波長別屈折率と最小偏角から計算します。"
      : snapshot.referenceAngleNoticeJa,
    "幻日は水平板状晶の投影近似、向き依存アークは条件付きの模式表示です。",
    snapshot.representativeRayGuideNoticeJa,
    "粒子数・明るさ・結晶分布・散乱強度は教育用の代表表示で、実測値ではありません。"
  ]);
}

function updateExplanation(): void {
  if (state.view === "overview" || state.view === "droplet") updateRainbowExplanation();
  else if (state.view === "chase") updateChaseExplanation();
  else updateHaloExplanation();
}

function updateCurrentConditions(): void {
  syncCurrentScene();
  updateExplanation();
  requestRender();
}

function updateCameraReadout(): void {
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  const azimuth = normalizedDegrees(THREE.MathUtils.radToDeg(spherical.theta));
  const elevation = 90 - THREE.MathUtils.radToDeg(spherical.phi);
  setText(
    "#camera-readout",
    `方位 ${azimuth.toFixed(0)}° / 仰角 ${elevation.toFixed(0)}° / 距離 ${spherical.radius.toFixed(1)}`
  );
}

function rotateCamera(deltaAzimuth: number, deltaPolar: number): void {
  const spherical = new THREE.Spherical().setFromVector3(
    camera.position.clone().sub(controls.target)
  );
  spherical.theta += deltaAzimuth;
  spherical.phi = THREE.MathUtils.clamp(
    spherical.phi + deltaPolar,
    controls.minPolarAngle,
    controls.maxPolarAngle
  );
  camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
  controls.update();
  updateCameraReadout();
}

document.querySelectorAll<HTMLButtonElement>(".mode-tab[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (view === "overview" || view === "chase" || view === "droplet" || view === "halo") {
      setView(view);
    }
  });
});

document.querySelectorAll<HTMLButtonElement>(".segment-button[data-order]").forEach((button) => {
  button.addEventListener("click", () => {
    state.order = button.dataset.order === "2" ? 2 : 1;
    document.querySelectorAll<HTMLButtonElement>(".segment-button[data-order]").forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-pressed", String(active));
    });
    chaseBaseline = new RainbowChaseModel({
      order: state.order,
      sunElevationDeg: CHASE_SUN_ELEVATION,
      sunAzimuthDeg: CHASE_SUN_AZIMUTH
    }).snapshot(0);
    updateCurrentConditions();
  });
});

const sunElevationInput = requireElement<HTMLInputElement>("#sun-elevation");
sunElevationInput.addEventListener("input", () => {
  state.sunElevation = Number(sunElevationInput.value);
  requireElement<HTMLOutputElement>("#sun-elevation-value").value = `${state.sunElevation}°`;
  sunElevationInput.setAttribute("aria-valuetext", `${state.sunElevation}度`);
  updateCurrentConditions();
});

const sunAzimuthInput = requireElement<HTMLInputElement>("#sun-azimuth");
sunAzimuthInput.addEventListener("input", () => {
  state.sunAzimuth = Number(sunAzimuthInput.value);
  requireElement<HTMLOutputElement>("#sun-azimuth-value").value = `${state.sunAzimuth}°`;
  sunAzimuthInput.setAttribute("aria-valuetext", `${state.sunAzimuth}度`);
  updateCurrentConditions();
});

const densityInput = requireElement<HTMLInputElement>("#particle-density");
densityInput.addEventListener("input", () => {
  state.particleDensity = Number(densityInput.value) / 100;
  requireElement<HTMLOutputElement>("#particle-density-value").value = `${densityInput.value}%`;
  densityInput.setAttribute("aria-valuetext", `${densityInput.value}パーセント`);
  if (state.view === "overview") overview.setDensity(state.particleDensity);
  else if (state.view === "halo") halo.setDensity(state.particleDensity);
  requestRender();
});

const observerDistanceInput = requireElement<HTMLInputElement>("#observer-distance");
let pendingChaseFrame = 0;
observerDistanceInput.addEventListener("input", () => {
  state.observerDistanceM = Number(observerDistanceInput.value);
  requireElement<HTMLOutputElement>("#observer-distance-value").value =
    `${state.observerDistanceM} m`;
  observerDistanceInput.setAttribute("aria-valuetext", `${state.observerDistanceM}メートル`);
  if (pendingChaseFrame) return;
  pendingChaseFrame = requestAnimationFrame(() => {
    pendingChaseFrame = 0;
    chase.setObserverDistance(state.observerDistanceM);
    if (state.view === "chase") updateChaseExplanation();
    requestRender();
  });
});

const haloTypeSelect = requireElement<HTMLSelectElement>("#halo-type");
haloTypeSelect.addEventListener("change", () => {
  state.haloPhenomenon = haloTypeSelect.value as HaloPhenomenonId;
  halo.setConditions(state.haloPhenomenon, state.sunElevation, state.sunAzimuth);
  updateHaloExplanation();
  requestRender();
});

requireElement<HTMLButtonElement>("#reset-view").addEventListener("click", resetCamera);
requireElement<HTMLButtonElement>("#focus-particle").addEventListener("click", focusCurrentParticle);
requireElement<HTMLButtonElement>("#zoom-in").addEventListener("click", () => setCameraDistance(0.8));
requireElement<HTMLButtonElement>("#zoom-out").addEventListener("click", () => setCameraDistance(1.25));
controls.addEventListener("change", () => {
  updateCameraReadout();
  requestRender();
});

let semanticWheelTimer = 0;
canvas.addEventListener(
  "wheel",
  (event) => {
    window.clearTimeout(semanticWheelTimer);
    semanticWheelTimer = window.setTimeout(() => {
      if (state.view === "overview" && event.deltaY < 0 && cameraDistance() <= controls.minDistance + 0.5) {
        setView("droplet");
      } else if (
        state.view === "droplet" &&
        event.deltaY > 0 &&
        cameraDistance() >= controls.maxDistance - 0.6
      ) {
        setView("overview");
      }
    }, 70);
  },
  { passive: true }
);

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") rotateCamera(-0.1, 0);
  else if (event.key === "ArrowRight") rotateCamera(0.1, 0);
  else if (event.key === "ArrowUp") rotateCamera(0, -0.08);
  else if (event.key === "ArrowDown") rotateCamera(0, 0.08);
  else if (event.key === "+" || event.key === "=") setCameraDistance(0.8);
  else if (event.key === "-" || event.key === "_") setCameraDistance(1.25);
  else if (event.key === "Home") resetCamera();
  else return;
  event.preventDefault();
});

let resizeFrame = 0;
let renderedWidth = 0;
let renderedHeight = 0;
const resizeObserver = new ResizeObserver(() => {
  if (!renderer || resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    if (!renderer) return;
    const width = Math.max(1, Math.round(stage.clientWidth));
    const height = Math.max(1, Math.round(stage.clientHeight));
    if (width === renderedWidth && height === renderedHeight) return;
    renderedWidth = width;
    renderedHeight = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  });
});
resizeObserver.observe(stage);

let renderFrame = 0;
function requestRender(): void {
  if (!renderer || document.hidden || renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    renderer?.render(scene, camera);
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(renderFrame);
    renderFrame = 0;
  } else {
    requestRender();
  }
});

let disposed = false;
function disposeApp(): void {
  if (disposed) return;
  disposed = true;
  resizeObserver.disconnect();
  cancelAnimationFrame(resizeFrame);
  cancelAnimationFrame(renderFrame);
  cancelAnimationFrame(pendingChaseFrame);
  window.clearTimeout(semanticWheelTimer);
  controls.dispose();
  overview.dispose();
  chase.dispose();
  droplet.dispose();
  halo.dispose();
  renderer?.dispose();
}

window.addEventListener("pagehide", disposeApp, { once: true });
window.addEventListener("beforeunload", disposeApp, { once: true });

setView("overview");
requestRender();
