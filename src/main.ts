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
  fresnelPower,
  rainbowAngleRange,
  type RainbowOrder
} from "./physics/rainbow";
import {
  OBSERVER_OPTICAL_ORIGIN,
  RAINBOW_CAMERA_FAR,
  RAINBOW_CAMERA_NEAR,
  RAINBOW_CHAPTER_LABELS,
  cameraDistanceFromProgress,
  formatSemanticSpan,
  progressFromCameraDistance,
  rainbowZoomFrame,
  type RainbowZoomChapter,
  type RainbowZoomFrame
} from "./physics/semanticZoom";
import { ChaseExperiment } from "./scenes/chaseExperiment";
import { HaloOverview } from "./scenes/haloOverview";
import { RainbowJourney } from "./scenes/rainbowJourney";

type ViewName = "overview" | "chase" | "droplet" | "halo";

interface AppState {
  view: ViewName;
  order: RainbowOrder;
  sunElevation: number;
  sunAzimuth: number;
  particleDensity: number;
  rainbowZoom: number;
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
  rainbowZoom: 0,
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

const rainbowJourney = new RainbowJourney();
const chase = new ChaseExperiment({
  order: state.order,
  sunElevationDeg: CHASE_SUN_ELEVATION,
  sunAzimuthDeg: CHASE_SUN_AZIMUTH
});
const halo = new HaloOverview();
chase.setVisible(false);
halo.setVisible(false);
scene.add(rainbowJourney.group, chase.group, halo.group);

let chaseBaseline: ChaseSnapshot = new RainbowChaseModel({
  order: state.order,
  sunElevationDeg: CHASE_SUN_ELEVATION,
  sunAzimuthDeg: CHASE_SUN_AZIMUTH
}).snapshot(0);

const RAINBOW_OVERVIEW_TARGET = new THREE.Vector3(
  OBSERVER_OPTICAL_ORIGIN.x,
  OBSERVER_OPTICAL_ORIGIN.y,
  OBSERVER_OPTICAL_ORIGIN.z
);
const DEFAULT_RAINBOW_DIRECTION = new THREE.Vector3(18, 9.4, 24).normalize();
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let applyingSemanticZoom = false;
let rainbowAnimationFrame = 0;
let lastRainbowChapter: RainbowZoomChapter | null = null;

function isRainbowView(view: ViewName): boolean {
  return view === "overview" || view === "droplet";
}

function cameraDistance(): number {
  return camera.position.distanceTo(controls.target);
}

function setCameraDistance(multiplier: number): void {
  if (isRainbowView(state.view)) {
    cancelRainbowAnimation();
    const distance = THREE.MathUtils.clamp(
      cameraDistance() * multiplier,
      RAINBOW_CAMERA_NEAR,
      RAINBOW_CAMERA_FAR
    );
    applyRainbowProgress(progressFromCameraDistance(distance));
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

function setActiveTab(view: ViewName, scrollIntoView = false): void {
  document.querySelectorAll<HTMLButtonElement>(".mode-tab[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    if (active && scrollIntoView) button.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

function rainbowTabForChapter(chapter: RainbowZoomChapter): "overview" | "droplet" {
  return chapter === "overview" || chapter === "contributor" ? "overview" : "droplet";
}

function updateRainbowProgressUi(frame: RainbowZoomFrame): void {
  const slider = requireElement<HTMLInputElement>("#semantic-zoom");
  const output = requireElement<HTMLOutputElement>("#semantic-zoom-value");
  const mobileSlider = requireElement<HTMLInputElement>("#mobile-semantic-zoom");
  const mobileOutput = requireElement<HTMLOutputElement>("#mobile-semantic-zoom-value");
  const percent = Math.round(frame.progress * 100);
  slider.value = String(Math.round(frame.progress * 1_000));
  slider.setAttribute(
    "aria-valuetext",
    `${RAINBOW_CHAPTER_LABELS[frame.chapter]}、意味ズーム${percent}パーセント`
  );
  output.value = `${RAINBOW_CHAPTER_LABELS[frame.chapter]} ${percent}%`;
  mobileSlider.value = slider.value;
  mobileSlider.setAttribute("aria-valuetext", slider.getAttribute("aria-valuetext") ?? "");
  mobileOutput.value = `${percent}%`;
  setText(
    "#scale-readout",
    `意味スケール指標 約${formatSemanticSpan(frame.semanticSpanM)}相当 / 水滴径 2.0 mm模型`
  );
  setText(
    "#view-state",
    `${RAINBOW_CHAPTER_LABELS[frame.chapter]} / 同じ代表水滴 ${rainbowJourney.getFocusSnapshot().id}`
  );
  setText("#focus-particle", frame.progress < 0.72 ? "代表光線まで" : "虹の全景へ");

  if (frame.chapter !== lastRainbowChapter) {
    lastRainbowChapter = frame.chapter;
    state.view = rainbowTabForChapter(frame.chapter);
    setActiveTab(state.view);
    renderControlVisibility();
    updateRainbowExplanation(frame);
    setText(
      "#zoom-status",
      `${RAINBOW_CHAPTER_LABELS[frame.chapter]}。意味スケール指標は約${formatSemanticSpan(frame.semanticSpanM)}相当です。`
    );
  }
  updateCameraReadout();
}

function applyRainbowProgress(progress: number, fromControls = false): void {
  const frame = rainbowZoomFrame(progress);
  const offset = camera.position.clone().sub(controls.target);
  const direction = offset.lengthSq() > 1e-12
    ? offset.normalize()
    : DEFAULT_RAINBOW_DIRECTION.clone();
  const distance = fromControls
    ? THREE.MathUtils.clamp(cameraDistance(), RAINBOW_CAMERA_NEAR, RAINBOW_CAMERA_FAR)
    : cameraDistanceFromProgress(frame.progress);
  const target = RAINBOW_OVERVIEW_TARGET.clone().lerp(
    rainbowJourney.getFocusPosition(),
    frame.targetBlend
  );

  state.rainbowZoom = frame.progress;
  rainbowJourney.applyZoom(frame);
  applyingSemanticZoom = true;
  controls.minDistance = RAINBOW_CAMERA_NEAR;
  controls.maxDistance = RAINBOW_CAMERA_FAR;
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(direction, distance);
  controls.update();
  applyingSemanticZoom = false;
  updateRainbowProgressUi(frame);
  requestRender();
}

function cancelRainbowAnimation(): void {
  if (!rainbowAnimationFrame) return;
  cancelAnimationFrame(rainbowAnimationFrame);
  rainbowAnimationFrame = 0;
}

function animateRainbowProgress(targetProgress: number): void {
  cancelRainbowAnimation();
  const target = THREE.MathUtils.clamp(targetProgress, 0, 1);
  const start = state.rainbowZoom;
  const difference = target - start;
  if (Math.abs(difference) < 1e-4 || prefersReducedMotion.matches) {
    applyRainbowProgress(target);
    return;
  }
  const startedAt = performance.now();
  const duration = Math.max(300, Math.abs(difference) * 900);
  const step = (now: number): void => {
    const unit = THREE.MathUtils.clamp((now - startedAt) / duration, 0, 1);
    const eased = unit * unit * (3 - 2 * unit);
    applyRainbowProgress(start + difference * eased);
    if (unit < 1) rainbowAnimationFrame = requestAnimationFrame(step);
    else rainbowAnimationFrame = 0;
  };
  rainbowAnimationFrame = requestAnimationFrame(step);
}

function resetCamera(): void {
  if (isRainbowView(state.view)) {
    const frame = rainbowZoomFrame(state.rainbowZoom);
    const target = RAINBOW_OVERVIEW_TARGET.clone().lerp(
      rainbowJourney.getFocusPosition(),
      frame.targetBlend
    );
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(
      DEFAULT_RAINBOW_DIRECTION,
      cameraDistanceFromProgress(frame.progress)
    );
    controls.minDistance = RAINBOW_CAMERA_NEAR;
    controls.maxDistance = RAINBOW_CAMERA_FAR;
  } else if (state.view === "chase") {
    camera.position.set(12, 8, 17);
    controls.target.set(0, 2.2, 0);
    controls.minDistance = 6;
    controls.maxDistance = 44;
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
  if (isRainbowView(state.view)) {
    animateRainbowProgress(state.rainbowZoom < 0.72 ? 0.86 : 0);
  } else if (state.view === "chase") {
    setView("droplet");
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
  if (isRainbowView(state.view)) {
    rainbowJourney.setConditions(state.order, state.sunElevation, state.sunAzimuth);
    rainbowJourney.setDensity(state.particleDensity);
    rainbowJourney.applyZoom(rainbowZoomFrame(state.rainbowZoom));
  } else if (state.view === "chase") {
    chase.setOrder(state.order);
    chase.setObserverDistance(state.observerDistanceM);
  } else {
    halo.setConditions(state.haloPhenomenon, state.sunElevation, state.sunAzimuth);
    halo.setDensity(state.particleDensity);
  }
}

function renderControlVisibility(): void {
  const isChase = state.view === "chase";
  const isHalo = state.view === "halo";
  const isRainbow = isRainbowView(state.view);
  const usesDensity = isRainbow || isHalo;
  setHidden("#order-controls", isHalo);
  setHidden("#elevation-control", isChase);
  setHidden("#azimuth-control", isChase);
  setHidden("#density-control", !usesDensity);
  setHidden("#chase-controls", !isChase);
  setHidden("#halo-controls", !isHalo);
  setHidden("#chase-data", !isChase);

  if (isHalo) setText("#focus-particle", "氷晶へ寄る");
  else if (!isRainbowView(state.view)) setText("#focus-particle", "水滴・光路へ");
  const zoomInLabel = isRainbow ? "水滴の光路側へ拡大" : "模型を拡大";
  const zoomOutLabel = isRainbow ? "虹の全景側へ縮小" : "模型を縮小";
  for (const selector of ["#zoom-in", "#mobile-zoom-in"]) {
    requireElement<HTMLButtonElement>(selector).setAttribute("aria-label", zoomInLabel);
  }
  for (const selector of ["#zoom-out", "#mobile-zoom-out"]) {
    requireElement<HTMLButtonElement>(selector).setAttribute("aria-label", zoomOutLabel);
  }
  requireElement<HTMLInputElement>("#semantic-zoom").disabled = !isRainbow;
  requireElement<HTMLInputElement>("#mobile-semantic-zoom").disabled = !isRainbow;
  setText("#semantic-zoom-label", isRainbow ? "虹から光路まで" : "虹モードで使用");
  setText("#mobile-semantic-zoom-label", isRainbow ? "虹→水滴→光路" : "虹モードで使用");
  if (!isRainbow) {
    requireElement<HTMLOutputElement>("#semantic-zoom-value").value = "—";
    requireElement<HTMLOutputElement>("#mobile-semantic-zoom-value").value = "—";
  }
}

function setView(view: ViewName): void {
  const wasRainbow = isRainbowView(state.view);
  if (isRainbowView(view)) {
    rainbowJourney.setVisible(true);
    chase.setVisible(false);
    halo.setVisible(false);
    if (!wasRainbow) {
      state.view = view;
      syncCurrentScene();
      lastRainbowChapter = null;
      const targetProgress = view === "overview" ? 0 : 0.86;
      controls.target.copy(RAINBOW_OVERVIEW_TARGET);
      camera.position.copy(RAINBOW_OVERVIEW_TARGET).addScaledVector(
        DEFAULT_RAINBOW_DIRECTION,
        cameraDistanceFromProgress(targetProgress)
      );
      applyRainbowProgress(targetProgress);
    } else {
      animateRainbowProgress(view === "overview" ? 0 : 0.86);
    }
    return;
  }

  cancelRainbowAnimation();
  state.view = view;
  rainbowJourney.setVisible(false);
  chase.setVisible(view === "chase");
  halo.setVisible(view === "halo");
  setActiveTab(view, true);
  renderControlVisibility();
  syncCurrentScene();
  resetCamera();
  updateExplanation();
  requestRender();
}

function updateRainbowExplanation(
  frame: RainbowZoomFrame = rainbowZoomFrame(state.rainbowZoom)
): void {
  const range = rainbowAngleRange(state.order);
  const isPrimary = state.order === 1;
  const orderLabel = isPrimary ? "一次虹" : "二次虹";
  const middle = SPECTRAL_SAMPLES[3];
  if (!middle) throw new Error("representative spectral sample is missing");
  const ray = findStationaryRay(middle.waterIndex, state.order);
  const fresnel = fresnelPower(ray.refractionDeg, middle.waterIndex, 1);
  const focus = rainbowJourney.getFocusSnapshot();
  const isFar = frame.chapter === "overview" || frame.chapter === "contributor";

  setText("#angle-label", isFar ? `${orderLabel}の角半径` : "代表光線 530 nmの虹角");
  setText(
    "#angle-value",
    isFar
      ? `${range.minimumDeg.toFixed(1)}°–${range.maximumDeg.toFixed(1)}°`
      : `${ray.radiusDeg.toFixed(3)}°`
  );
  setText(
    "#angle-context",
    isFar
      ? rainbowVisibilityNote(state.order, state.sunElevation)
      : `入射角 ${ray.incidenceDeg.toFixed(2)}° → 水中 ${ray.refractionDeg.toFixed(2)}°。虹角付近に光線束が集中する停留光線です。`
  );
  setText(
    "#reflection-note",
    isPrimary
      ? "水滴内で1回の部分反射。赤が外側、紫が内側。"
      : "水滴内で2回の部分反射。色順が逆になり、赤が内側。"
  );

  switch (frame.chapter) {
    case "overview":
      setText("#scene-kicker", "RAIN FIELD → RAINBOW");
      setText("#scene-title", "無数の水滴がつくる「見える角度」");
      setFacts(
        ["中心", "内部反射", "赤 656.3 nm", "紫 404.7 nm"],
        [
          "観察者の反太陽点",
          `${state.order}回（部分反射）`,
          `${range.redDeg.toFixed(1)}°`,
          `${range.violetDeg.toFixed(1)}°`
        ]
      );
      setText("#explanation-title", "虹は空に貼り付いた物体ではない");
      setText(
        "#explanation-body",
        "観察者を頂点とする円錐上で、計算角へ光を返す多数の水滴が虹を構成します。ズームすると、その条件を満たす代表水滴を入れ替えずに追跡します。"
      );
      break;
    case "contributor":
      setText("#scene-kicker", "RAINBOW → CONTRIBUTING DROP");
      setText("#scene-title", "虹をつくる同じ1滴を追い続ける");
      setFacts(
        ["代表水滴ID", "代表波長", "虹角", "配置距離"],
        [focus.id, `${focus.wavelengthNm} nm`, `${focus.rainbowRadiusDeg.toFixed(3)}°`, "理解用（固有距離なし）"]
      );
      setText("#explanation-title", "角度条件は正確、置いた距離は説明用");
      setText(
        "#explanation-body",
        "強調した水滴は530 nmの虹円錐上にあります。ただし虹に固有の距離はないため、この雨域内の位置は連続観察のための模型です。"
      );
      break;
    case "droplet":
      setText("#scene-kicker", "SAME DROP → 2 mm MODEL");
      setText("#scene-title", "位置を保ったまま、水滴表面が見えてくる");
      setFacts(
        ["水滴模型", "入射角", "水中の屈折角", "内部反射"],
        ["直径2.0 mm・球形", `${ray.incidenceDeg.toFixed(2)}°`, `${ray.refractionDeg.toFixed(2)}°`, `${state.order}回（部分反射）`]
      );
      setText("#explanation-title", "実寸差は局所模型へ連続に再正規化");
      setText(
        "#explanation-body",
        "画面上は途切れませんが、数百mとmmを同じ実寸座標へ無理に置かず、選択水滴を中心とする局所模型へ滑らかに移します。"
      );
      break;
    case "ray":
      setText("#scene-kicker", "ONE CAUSTIC RAY → REFRACTION");
      setText("#scene-title", "まず1本の代表光線を、順番にたどる");
      setFacts(
        ["代表光線", "入射角", "水中の屈折角", "内部反射"],
        [`${middle.wavelengthNm} nm`, `${ray.incidenceDeg.toFixed(2)}°`, `${ray.refractionDeg.toFixed(2)}°`, `${state.order}回（部分反射）`]
      );
      setText("#explanation-title", "入射 → 屈折 → 部分反射 → 射出");
      setText(
        "#explanation-body",
        "黄色から緑へ続く線は虹角付近に光が集中する代表的な幾何光線です。1個の光子や実際の光束幅を表す線ではありません。"
      );
      break;
    case "dispersion":
      setText("#scene-kicker", "DISPERSION + PARTIAL TRANSMISSION");
      setText("#scene-title", "波長差と、この虹次数から外れる透過光を見る");
      setFacts(
        ["代表7波長", "内部界面 Rs", "内部界面 Rp", "内部界面平均"],
        [
          "404.7–656.3 nm",
          `${(fresnel.sReflectance * 100).toFixed(1)}%`,
          `${(fresnel.pReflectance * 100).toFixed(2)}%`,
          `${(fresnel.unpolarizedReflectance * 100).toFixed(1)}% / 1面`
        ]
      );
      setText("#explanation-title", "破線の枝は、部分反射で外へ透過する光");
      setText(
        "#explanation-body",
        "表示値は内部反射面1面だけのFresnel反射率で、入射面・射出面の損失は未算入です。橙色の破線は、この虹次数の経路から外れる透過枝です。線の明るさは率に比例しません。色線は代表サンプルで、虹が7本だけという意味ではありません。"
      );
      break;
  }

  setText(
    "#fps-state",
    frame.chapter === "dispersion" ? "解析式 / 代表7波長" : "連続LOD / 代表530 nm"
  );
  setText(
    "#semantic-note",
    "約300 m相当から水滴内部までを見失わず学ぶ対数的な「意味ズーム」です。同じ代表水滴を追跡しながら局所模型へ連続に再正規化します。数値はカメラ画角や画面寸法から校正した実測縮尺ではありません。"
  );
  setModelItems([
    "同じ代表水滴IDを保ち、約300 m相当から水滴内部まで対数的な意味ズームで再正規化します。数値は実測縮尺ではありません。",
    "直径2.0 mmの球形水滴・幾何光学・空気の屈折率を1とする近似です。実際の大粒雨滴は扁平・非対称になります。",
    "停留光線は解析式で求め、内部反射面1面のFresnel反射率を表示します。入射・射出面の損失、線の強度と幅、水滴配置距離は模式または未計算です。",
    "過剰虹・干渉・回折・太陽視直径によるぼけ・絶対輝度にはAiry／Lorenz–Mie等の波動光学が必要で、未計算です。"
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
  setText(
    "#semantic-note",
    "固定した有限の雨滴場を観察者が移動する数値実験です。画面の模型距離はThree.js内の表示単位で、虹までの物理距離ではありません。"
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
  setText(
    "#semantic-note",
    "空の角度配置と氷晶の局所模型を同時に見せる教育用スケールです。計算したリングと、向き依存現象の模式表示を区別しています。"
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
  const previousFocusId = isRainbowView(state.view)
    ? rainbowJourney.getFocusSnapshot().id
    : null;
  syncCurrentScene();
  if (isRainbowView(state.view)) {
    applyRainbowProgress(state.rainbowZoom);
    updateRainbowExplanation();
    const nextFocusId = rainbowJourney.getFocusSnapshot().id;
    if (previousFocusId && previousFocusId !== nextFocusId) {
      setText(
        "#zoom-status",
        `条件変更により、寄与する代表水滴を ${nextFocusId} へ選び直しました。`
      );
    }
  } else {
    updateExplanation();
    requestRender();
  }
}

function updateCameraReadout(): void {
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  const azimuth = normalizedDegrees(THREE.MathUtils.radToDeg(spherical.theta));
  const elevation = 90 - THREE.MathUtils.radToDeg(spherical.phi);
  setText(
    "#camera-readout",
    isRainbowView(state.view)
      ? `方位 ${azimuth.toFixed(0)}° / 仰角 ${elevation.toFixed(0)}° / 意味ズーム ${Math.round(state.rainbowZoom * 100)}%`
      : `方位 ${azimuth.toFixed(0)}° / 仰角 ${elevation.toFixed(0)}° / 模型距離 ${spherical.radius.toFixed(1)}`
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
  if (isRainbowView(state.view)) rainbowJourney.setDensity(state.particleDensity);
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
requireElement<HTMLButtonElement>("#zoom-in").addEventListener("click", () => setCameraDistance(0.9));
requireElement<HTMLButtonElement>("#zoom-out").addEventListener("click", () => setCameraDistance(1.1));

const semanticZoomInput = requireElement<HTMLInputElement>("#semantic-zoom");
const mobileSemanticZoomInput = requireElement<HTMLInputElement>("#mobile-semantic-zoom");
for (const input of [semanticZoomInput, mobileSemanticZoomInput]) {
  input.addEventListener("input", () => {
    if (!isRainbowView(state.view)) setView("overview");
    cancelRainbowAnimation();
    applyRainbowProgress(Number(input.value) / 1_000);
  });
  input.addEventListener("change", () => {
    const frame = rainbowZoomFrame(state.rainbowZoom);
    setText(
      "#zoom-status",
      `${RAINBOW_CHAPTER_LABELS[frame.chapter]}。意味ズーム${Math.round(frame.progress * 100)}パーセントです。`
    );
  });
}
requireElement<HTMLButtonElement>("#mobile-zoom-in").addEventListener("click", () =>
  setCameraDistance(0.9)
);
requireElement<HTMLButtonElement>("#mobile-zoom-out").addEventListener("click", () =>
  setCameraDistance(1.1)
);

controls.addEventListener("change", () => {
  if (isRainbowView(state.view) && !applyingSemanticZoom) {
    cancelRainbowAnimation();
    applyRainbowProgress(progressFromCameraDistance(cameraDistance()), true);
    return;
  }
  updateCameraReadout();
  requestRender();
});

canvas.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey || event.metaKey) {
      event.stopImmediatePropagation();
      return;
    }
    if (!isRainbowView(state.view)) return;
    cancelRainbowAnimation();
    const atNearEdge = cameraDistance() <= RAINBOW_CAMERA_NEAR + 0.01 && event.deltaY < 0;
    const atFarEdge = cameraDistance() >= RAINBOW_CAMERA_FAR - 0.01 && event.deltaY > 0;
    if (atNearEdge || atFarEdge) event.stopImmediatePropagation();
  },
  { capture: true, passive: true }
);

canvas.addEventListener("pointerdown", cancelRainbowAnimation, { passive: true });

canvas.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") rotateCamera(-0.1, 0);
  else if (event.key === "ArrowRight") rotateCamera(0.1, 0);
  else if (event.key === "ArrowUp") rotateCamera(0, -0.08);
  else if (event.key === "ArrowDown") rotateCamera(0, 0.08);
  else if (event.key === "+" || event.key === "=") setCameraDistance(0.9);
  else if (event.key === "-" || event.key === "_") setCameraDistance(1.1);
  else if (event.key === "PageUp" && isRainbowView(state.view)) {
    cancelRainbowAnimation();
    applyRainbowProgress(state.rainbowZoom + 0.12);
  } else if (event.key === "PageDown" && isRainbowView(state.view)) {
    cancelRainbowAnimation();
    applyRainbowProgress(state.rainbowZoom - 0.12);
  } else if (event.key === "Home" && isRainbowView(state.view)) animateRainbowProgress(0);
  else if (event.key === "End" && isRainbowView(state.view)) animateRainbowProgress(1);
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
  cancelRainbowAnimation();
  controls.dispose();
  rainbowJourney.dispose();
  chase.dispose();
  halo.dispose();
  renderer?.dispose();
}

window.addEventListener("pagehide", disposeApp, { once: true });
window.addEventListener("beforeunload", disposeApp, { once: true });

setView("overview");
requestRender();
