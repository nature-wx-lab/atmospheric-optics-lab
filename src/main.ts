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
  findStationaryRay,
  fresnelPower,
  rainbowAngleRange,
  traceDropletRay,
  type RainbowOrder
} from "./physics/rainbow";
import { RainbowSelectionGesture } from "./interaction/rainbowSelectionGesture";
import {
  resolveRainbowZoomAction,
  type RainbowMode,
  zoomAmountFromButtonMultiplier,
  zoomAmountFromPinchDistances,
  zoomAmountFromWheelPixels
} from "./interaction/rainbowNavigation";
import {
  inspectionCameraPosition,
  rainbowApproachPathPose,
  slerpCameraDirection,
  shouldCaptureDropApproachAnchor,
  type InspectionCameraPath
} from "./physics/rainbowCameraPath";
import {
  OBSERVER_OPTICAL_ORIGIN,
  RAIN_FIELD_APPROACH_END,
  RAIN_FIELD_METERS_TO_SCENE_UNITS,
  RAINBOW_CAMERA_FAR,
  RAINBOW_CAMERA_NEAR,
  RAINBOW_CHAPTER_LABELS,
  cameraDistanceFromProgress,
  fieldInspectionTravelM,
  formatSemanticSpan,
  rainbowZoomFrame,
  type RainbowZoomChapter,
  type RainbowZoomFrame
} from "./physics/semanticZoom";
import {
  defaultObserverLookDirection,
  observerRainbowVerticalFovDeg
} from "./physics/rainbowView";
import { boundedHorizontalObserverMove } from "./physics/observerMovement";
import { ChaseExperiment } from "./scenes/chaseExperiment";
import { HaloOverview } from "./scenes/haloOverview";
import { RainbowJourney, type FocusDropletSnapshot } from "./scenes/rainbowJourney";

type ViewName = "overview" | "chase" | "droplet" | "halo";

interface RainbowCameraPose {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly fov: number;
}

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

let rainbowDropSelectionArmed = false;

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

function selectedDropStatus(snapshot: FocusDropletSnapshot): string {
  if (!snapshot.explicitlySelected) {
    return "追う雨滴は未選択 — 虹の色・画面上の点・固定IDから選べます";
  }
  const opticalStatus = snapshot.contributes
    ? `寄与滴・${snapshot.dominantWavelengthNm?.toFixed(1)} nm相当`
    : `虹帯外・最寄りの虹角との差 ${Math.abs(snapshot.angularErrorDeg).toFixed(1)}°`;
  return `${snapshot.id} / ${opticalStatus} / 距離 ${snapshot.distanceFromObserverM.toFixed(0)} m`;
}

function updateSelectedDropUi(snapshot: FocusDropletSnapshot): void {
  setText("#selected-drop-readout", selectedDropStatus(snapshot));
  if (!snapshot.explicitlySelected) {
    for (const selector of ["#drop-id-input", "#mobile-drop-id-input"]) {
      const idInput = requireElement<HTMLInputElement>(selector);
      if (document.activeElement !== idInput) idInput.value = "";
    }
    requireElement<HTMLButtonElement>("#clear-drop-selection").disabled = true;
    return;
  }
  setText(
    "#mobile-selected-drop",
    snapshot.contributes
      ? `${snapshot.id}・${snapshot.dominantWavelengthNm?.toFixed(0)} nm`
      : `${snapshot.id}・虹帯外`
  );
  for (const selector of ["#drop-id-input", "#mobile-drop-id-input"]) {
    const idInput = requireElement<HTMLInputElement>(selector);
    if (document.activeElement !== idInput) idInput.value = snapshot.id;
  }
  requireElement<HTMLButtonElement>("#clear-drop-selection").disabled = false;
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

function rainbowVisibilityNote(
  order: RainbowOrder,
  sunElevation: number,
  mode: RainbowMode
): string {
  const range = rainbowAngleRange(order);
  const guideNote =
    mode !== "external"
      ? "「光路を外から」へ切り替えると、地平線下を含む計算円錐と寄与滴を確認できます。"
      : "中性破線は、地平線下を含む計算角ガイドです。";
  return sunElevation >= range.maximumDeg
    ? `太陽高度${sunElevation}°では、この次数の円錐は空側に出ません。${guideNote}`
    : `太陽高度${sunElevation}°では円錐の一部が地平線より上に出ます。${guideNote}`;
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

const INITIAL_RAINBOW_OBSERVER_POSITION_M = rainbowJourney.getObserverPositionM();
// Side-on to the default rainbow scattering plane, so the incoming sunlight,
// internal turn, and observer-reaching ray are legible before any drag.
const DEFAULT_STRUCTURE_DIRECTION = new THREE.Vector3(0.72, 0.28, -0.69).normalize();
const EYE_GAZE_DISTANCE = 1;
const DEFAULT_CAMERA_FOV = 46;
const DETAIL_ORBIT_START = 0.7;
const EYE_LOOK_END = 0.08;
const FREE_MOVE_STEP_M = 5;
const FREE_MOVE_LIMIT_M = 45;
const INSPECTION_FREE_MOVE_STEP_M = 8;
const INSPECTION_RADIUS_LIMIT_M = 260;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let applyingSemanticZoom = false;
let rainbowAnimationFrame = 0;
let lastRainbowChapter: RainbowZoomChapter | null = null;
// The first visible state is the observer's rainbow.  The external ray
// geometry remains one click away and uses the same underlying world.
let rainbowMode: RainbowMode = "approach";
const rainbowProgressByMode: Record<"approach" | "external", number> = {
  approach: state.rainbowZoom,
  external: 0
};
let eyeViewTracksSun = true;
let structureDirection = DEFAULT_STRUCTURE_DIRECTION.clone();
let detailOrbitDirection: THREE.Vector3 | null = null;
let eyeLookDirection = new THREE.Vector3();
let inspectionLookDirection = new THREE.Vector3();
let inspectionOverviewLookDirection = new THREE.Vector3();
let inspectionPathDirection = new THREE.Vector3();
const inspectionFreeOffset = new THREE.Vector3();
let selectedApproachAnchorPosition: THREE.Vector3 | null = null;
let selectedApproachAnchorDirection: THREE.Vector3 | null = null;
let wavelengthSelectionTargetNm: number | null = null;
let wavelengthSelectionOffset = 0;
const selectionGesture = new RainbowSelectionGesture();

interface ExternalOpticalSnapshot {
  readonly observerPositionM: THREE.Vector3;
  readonly lookDirection: THREE.Vector3;
}

let externalOpticalSnapshot: ExternalOpticalSnapshot | null = null;
let pendingObserverMoveM = 0;
let pendingObserverMoveFrame = 0;

function observerOrigin(): THREE.Vector3 {
  return rainbowJourney.getObserverScenePosition();
}

function inspectionCameraPath(): InspectionCameraPath {
  return {
    origin: observerOrigin(),
    pathDirection: inspectionPathDirection,
    freeOffset: inspectionFreeOffset,
    overviewGazeDirection: inspectionOverviewLookDirection,
    fieldGazeDirection: inspectionLookDirection
  };
}

function inspectionDistanceFromObserverM(progress = state.rainbowZoom): number {
  return inspectionCameraPosition(inspectionCameraPath(), progress)
    .distanceTo(observerOrigin()) / RAIN_FIELD_METERS_TO_SCENE_UNITS;
}

function resetEyeLookDirection(updateInspection = rainbowMode === "approach"): void {
  const direction = defaultObserverLookDirection(state.sunElevation, state.sunAzimuth);
  eyeLookDirection.set(direction.x, direction.y, direction.z).normalize();
  if (!updateInspection) return;
  inspectionLookDirection.copy(eyeLookDirection);
  if (state.rainbowZoom <= EYE_LOOK_END && inspectionFreeOffset.lengthSq() < 1e-12) {
    inspectionOverviewLookDirection.copy(inspectionLookDirection);
    inspectionPathDirection.copy(inspectionLookDirection);
  }
}

function resetInspectionNavigation(): void {
  inspectionFreeOffset.set(0, 0, 0);
  inspectionLookDirection.copy(inspectionOverviewLookDirection);
  inspectionPathDirection.copy(inspectionLookDirection);
  selectedApproachAnchorPosition = null;
  selectedApproachAnchorDirection = null;
}

resetEyeLookDirection();

function isRainbowView(view: ViewName): boolean {
  return view === "overview" || view === "droplet";
}

function rainbowModeLabel(mode: RainbowMode): string {
  if (mode === "approach") {
    if (rainbowJourney.hasExplicitSelection()) return "観測者の目→選択滴";
    return state.rainbowZoom >= RAIN_FIELD_APPROACH_END - 1e-6
      ? "観測者の目・雨域探索"
      : "観測者の目";
  }
  if (mode === "move") return "観測者を移動";
  return "3D空間を外から";
}

function rainbowModeStatus(mode: RainbowMode): string {
  if (mode === "approach") {
    return rainbowJourney.hasExplicitSelection()
      ? "現在の観測点を固定起点にしました。選んだ同じIDへ連続接近できます。"
      : "現在の観測点は固定したまま、検査カメラで大量の雨滴が見える雨域へ進みます。雨滴は明示的に選ぶまで追尾しません。";
  }
  if (mode === "move") {
    return "観測者移動モードです。ズーム操作で水平に前後し、ドラッグや矢印で進行方位を変えます。";
  }
  return "太陽・観測者・主虹／副虹・多数の雨滴を同じ3D空間に表示しています。外側カメラを回しても物理条件は変わらず、条件操作を変えると全光路を再計算します。";
}

function isObserverViewMode(): boolean {
  return rainbowMode !== "external";
}

function syncRainbowDropSelectionUi(
  frame: RainbowZoomFrame = rainbowZoomFrame(state.rainbowZoom)
): void {
  const focus = rainbowJourney.getFocusSnapshot();
  const canArm = isRainbowView(state.view) && rainbowMode !== "move" && !focus.explicitlySelected;
  if (!canArm) rainbowDropSelectionArmed = false;
  const armed = canArm && rainbowDropSelectionArmed;
  canvas.classList.toggle("is-drop-selection-armed", armed);
  canvas.setAttribute("aria-pressed", String(armed));
  const canvasModeDescription = rainbowMode === "move"
    ? "観測者移動モード。ズーム操作は観測者の物理的な前進と後退です。"
    : rainbowMode === "external"
      ? "外側3Dモード。ドラッグで構造を回転し、赤と青紫を別々の雨滴から目へ結ぶ光路を確認できます。"
      : "接近モード。ズームインで雨域へ進み、雨域からズームアウトすると連続虹へ戻れます。";
  canvas.setAttribute(
    "aria-label",
    armed
      ? "雨滴選択モード。画面に見える任意の雨滴を短くタップしてください。ドラッグ、ホイール、ピンチでは選択されません。"
      : `${canvasModeDescription} ズームだけでは雨滴を選択しません。雨滴を選ぶボタンを押した後、見える雨滴を短くタップできます。`
  );
  if (!isRainbowView(state.view)) return;

  const focusButton = requireElement<HTMLButtonElement>("#focus-particle");
  focusButton.setAttribute("aria-pressed", String(armed));
  focusButton.textContent = rainbowMode === "move"
    ? "開始位置へ戻る"
    : !focus.explicitlySelected
      ? armed ? "選択をやめる" : "画面の雨滴を選ぶ"
      : frame.progress < 0.72 ? "この水滴へ" : "虹の全景へ";

  const mobileButton = requireElement<HTMLButtonElement>("#mobile-clear-drop-selection");
  mobileButton.disabled = rainbowMode === "move" && !focus.explicitlySelected;
  mobileButton.setAttribute("aria-pressed", String(armed));
  setText(
    "#mobile-selected-drop",
    !focus.explicitlySelected
      ? armed ? "雨滴をタップ" : "雨滴を選ぶ"
      : focus.contributes
        ? `${focus.id}・${focus.dominantWavelengthNm?.toFixed(0)} nm`
        : `${focus.id}・虹帯外`
  );
  const approachModeButton = requireElement<HTMLButtonElement>(
    '[data-rainbow-mode="approach"]'
  );
  approachModeButton.textContent = rainbowModeLabel("approach");
  const zoomInLabel = canFreelyExploreRainField()
    ? "検査カメラを視線方向へ前進"
    : focus.explicitlySelected
      ? "選択した水滴の光路側へ拡大"
      : "特定の雨滴を選ばず雨域へ前進";
  const zoomOutLabel = canFreelyExploreRainField()
    ? "雨滴群から連続虹へ戻る"
    : "虹の全景側へ縮小";
  for (const selector of ["#zoom-in", "#mobile-zoom-in"]) {
    requireElement<HTMLButtonElement>(selector).setAttribute("aria-label", zoomInLabel);
  }
  for (const selector of ["#zoom-out", "#mobile-zoom-out"]) {
    requireElement<HTMLButtonElement>(selector).setAttribute("aria-label", zoomOutLabel);
  }
}

function setRainbowDropSelectionArmed(armed: boolean, announce = true): void {
  rainbowDropSelectionArmed =
    armed && isRainbowView(state.view) && rainbowMode !== "move" &&
    !rainbowJourney.hasExplicitSelection();
  if (!rainbowDropSelectionArmed) selectionGesture.cancel();
  syncRainbowDropSelectionUi();
  if (!announce) return;
  setText(
    "#zoom-status",
    rainbowDropSelectionArmed
      ? "雨滴選択モードです。大量の雨滴が見える画面で、調べたい1滴を短くタップしてください。ドラッグやズームでは選択しません。"
      : "雨滴選択モードを終了しました。特定の雨滴は選ばず、ズームインで雨域へ進み、ズームアウトで虹へ戻ります。"
  );
}

function availableRainbowProgress(requested: number): number {
  const bounded = THREE.MathUtils.clamp(requested, 0, 1);
  if (rainbowMode === "move") return 0;
  return rainbowJourney.hasExplicitSelection()
    ? bounded
    : Math.min(bounded, RAIN_FIELD_APPROACH_END);
}

function rememberRainbowProgress(): void {
  if (rainbowMode !== "move") rainbowProgressByMode[rainbowMode] = state.rainbowZoom;
}

function cancelQueuedObserverMove(): void {
  pendingObserverMoveM = 0;
  if (!pendingObserverMoveFrame) return;
  cancelAnimationFrame(pendingObserverMoveFrame);
  pendingObserverMoveFrame = 0;
}

function canFreelyExploreRainField(): boolean {
  return isRainbowView(state.view) &&
    rainbowMode === "approach" &&
    !rainbowJourney.hasExplicitSelection() &&
    state.rainbowZoom >= RAIN_FIELD_APPROACH_END - 1e-6;
}

function currentRainbowZoomAction(amount: number) {
  return resolveRainbowZoomAction({
    mode: rainbowMode,
    progress: state.rainbowZoom,
    hasExplicitSelection: rainbowJourney.hasExplicitSelection(),
    amount,
    rainFieldBoundary: RAIN_FIELD_APPROACH_END
  });
}

function moveInspectionCamera(
  forwardM: number,
  lateralM = 0,
  verticalM = 0
): void {
  if (!canFreelyExploreRainField()) return;
  const forward = inspectionLookDirection.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, up);
  if (right.lengthSq() < 1e-10) right.set(1, 0, 0);
  else right.normalize();
  const delta = forward
    .multiplyScalar(forwardM)
    .addScaledVector(right, lateralM)
    .addScaledVector(up, verticalM)
    .multiplyScalar(RAIN_FIELD_METERS_TO_SCENE_UNITS);
  if (delta.lengthSq() < 1e-12) return;

  const current = inspectionCameraPosition(
    inspectionCameraPath(),
    RAIN_FIELD_APPROACH_END
  );
  const candidate = current.add(delta);
  const relative = candidate.clone().sub(observerOrigin());
  const limitScene = INSPECTION_RADIUS_LIMIT_M * RAIN_FIELD_METERS_TO_SCENE_UNITS;
  const limited = relative.length() > limitScene;
  if (limited) relative.setLength(limitScene);
  const nextPosition = observerOrigin().add(relative);
  const basePosition = inspectionCameraPosition(
    {
      ...inspectionCameraPath(),
      freeOffset: new THREE.Vector3()
    },
    RAIN_FIELD_APPROACH_END
  );
  inspectionFreeOffset.copy(nextPosition).sub(basePosition);
  selectedApproachAnchorPosition = null;
  selectedApproachAnchorDirection = null;
  applyRainbowProgress(RAIN_FIELD_APPROACH_END);
  setText(
    "#zoom-status",
    limited
      ? `代表雨域の外縁影響を避けるため、検査カメラは固定観測点から${INSPECTION_RADIUS_LIMIT_M}メートルで停止しました。観測点と寄与計算は動いていません。`
      : `雨域内を自由探索中。検査カメラは固定観測点から${inspectionDistanceFromObserverM().toFixed(0)}メートルです。観測点と虹の寄与計算は動いていません。`
  );
}

function queuePhysicalObserverMove(distanceM: number): void {
  if (!Number.isFinite(distanceM) || rainbowMode !== "move") return;
  pendingObserverMoveM = THREE.MathUtils.clamp(
    pendingObserverMoveM + distanceM,
    -FREE_MOVE_STEP_M * 2,
    FREE_MOVE_STEP_M * 2
  );
  if (pendingObserverMoveFrame) return;
  pendingObserverMoveFrame = requestAnimationFrame(() => {
    pendingObserverMoveFrame = 0;
    const queuedDistanceM = pendingObserverMoveM;
    pendingObserverMoveM = 0;
    if (Math.abs(queuedDistanceM) >= 0.02) movePhysicalObserver(queuedDistanceM);
  });
}

function setCameraDistance(multiplier: number): void {
  if (isRainbowView(state.view)) {
    selectionGesture.cancel();
    const amount = zoomAmountFromButtonMultiplier(multiplier);
    if (amount === 0) return;
    const action = currentRainbowZoomAction(amount);
    if (action === "physical-observer-move") {
      movePhysicalObserver(amount > 0 ? FREE_MOVE_STEP_M : -FREE_MOVE_STEP_M);
      return;
    }
    if (action === "inspection-forward") {
      moveInspectionCamera(INSPECTION_FREE_MOVE_STEP_M);
      return;
    }
    cancelRainbowAnimation();
    applyRainbowProgress(state.rainbowZoom + amount);
    announceRainbowProgress(rainbowZoomFrame(state.rainbowZoom));
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

function announceRainbowProgress(frame: RainbowZoomFrame): void {
  if (rainbowMode === "move") {
    const observer = rainbowJourney.getObserverPositionM();
    const moved = observer.distanceTo(INITIAL_RAINBOW_OBSERVER_POSITION_M);
    setText(
      "#zoom-status",
      `観測者は開始位置から${moved.toFixed(1)}メートル。ズーム操作は視線の水平方位への前進・後退です。`
    );
    return;
  }
  if (!rainbowJourney.hasExplicitSelection() && frame.progress >= RAIN_FIELD_APPROACH_END - 1e-6) {
    setText(
      "#zoom-status",
      "検査カメラは雨域へ到着しました。ズームイン方向で前進し、ズームアウト方向で大量雨滴から連続虹への経路を戻れます。WASD/QEは雨域内の自由移動、ドラッグ・矢印は視線変更です。観測点と寄与計算は固定のままです。"
    );
    return;
  }
  setText(
    "#zoom-status",
    `${RAINBOW_CHAPTER_LABELS[frame.chapter]}。意味ズーム${Math.round(frame.progress * 100)}パーセント、意味スケール指標は約${formatSemanticSpan(frame.semanticSpanM)}相当です。`
  );
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
  const focus = rainbowJourney.getFocusSnapshot();
  const observerMovedM = focus.observerPositionM.distanceTo(INITIAL_RAINBOW_OBSERVER_POSITION_M);
  setText(
    "#scale-readout",
    rainbowMode === "move"
      ? `観測者：開始位置から ${observerMovedM.toFixed(1)} m / 高さ ${focus.observerPositionM.y.toFixed(1)} m`
      : focus.explicitlySelected
        ? `意味スケール指標 約${formatSemanticSpan(frame.semanticSpanM)}相当 / 選択滴径 ${focus.diameterMm.toFixed(2)} mm`
        : rainbowMode === "approach"
          ? `検査カメラ ${inspectionDistanceFromObserverM(frame.progress).toFixed(0)} m（観測点は固定） / 対象未選択`
          : `意味スケール指標 約${formatSemanticSpan(frame.semanticSpanM)}相当 / 対象未選択`
  );
  updateSelectedDropUi(focus);
  setText(
    "#view-state",
    `${rainbowModeLabel(rainbowMode)} / ${RAINBOW_CHAPTER_LABELS[frame.chapter]} / ${
      focus.explicitlySelected ? `実在ID ${focus.id}` : "対象未選択"
    }`
  );
  syncRainbowDropSelectionUi(frame);
  updateRainbowDragHint(frame);

  if (frame.chapter !== lastRainbowChapter) {
    lastRainbowChapter = frame.chapter;
    state.view = rainbowTabForChapter(frame.chapter);
    setActiveTab(state.view);
    renderControlVisibility();
    updateRainbowExplanation(frame);
    announceRainbowProgress(frame);
  }
  updateCameraReadout();
}

function computedDetailOrbitDirection(): THREE.Vector3 {
  const focus = rainbowJourney.getFocusSnapshot();
  const normal = new THREE.Vector3().crossVectors(
    focus.incomingDirection,
    focus.outgoingDirection
  );
  if (normal.lengthSq() < 1e-10) return DEFAULT_STRUCTURE_DIRECTION.clone();
  normal.normalize();
  if (normal.y < 0) normal.negate();
  return normal.addScaledVector(new THREE.Vector3(0, 1, 0), 0.18).normalize();
}

function rainbowCameraPose(frame: RainbowZoomFrame): RainbowCameraPose {
  const focus = rainbowJourney.getFocusSnapshot();
  const origin = observerOrigin();
  const observerFov = observerRainbowVerticalFovDeg(
    state.order,
    state.sunElevation,
    camera.aspect
  );
  if (rainbowMode === "move") {
    return {
      position: origin,
      target: origin.clone().addScaledVector(eyeLookDirection, EYE_GAZE_DISTANCE),
      fov: observerFov
    };
  }
  if (rainbowMode === "external") {
    const orderPaths = rainbowJourney
      .getRepresentativeWorldPaths()
      .filter((path) => path.order === state.order);
    const dropCentre = orderPaths.reduce(
      (sum, path) => sum.add(path.dropletPosition),
      new THREE.Vector3()
    );
    if (orderPaths.length > 0) dropCentre.multiplyScalar(1 / orderPaths.length);
    else dropCentre.copy(origin).add(new THREE.Vector3(0, 3.2, 0));
    // Frame the observer and both representative scattering volumes as one
    // continuous world.  Keeping the target slightly closer to (and below)
    // the observer prevents the human-scale reference from being clipped
    // while the primary and secondary paths remain visible together.
    const worldCentre = origin.clone().lerp(dropCentre, 0.6);
    worldCentre.y = origin.y - 2.4;
    const target = focus.explicitlySelected
      ? worldCentre.clone().lerp(focus.position, frame.targetBlend)
      : worldCentre;
    return {
      position: target
        .clone()
        .addScaledVector(
          structureDirection,
          cameraDistanceFromProgress(frame.progress) * (0.52 - 0.04 * frame.progress)
        ),
      target,
      fov: 58
    };
  }

  const selectedTarget = focus.explicitlySelected
    ? (() => {
        const endDirection = detailOrbitDirection ?? computedDetailOrbitDirection();
        const endPosition = focus.position
          .clone()
          .addScaledVector(endDirection, RAINBOW_CAMERA_NEAR);
        return {
          endPosition,
          endForward: focus.position.clone().sub(endPosition).normalize(),
          anchorPosition: selectedApproachAnchorPosition,
          anchorForward: selectedApproachAnchorDirection
        };
      })()
    : null;
  const pathPose = rainbowApproachPathPose(
    inspectionCameraPath(),
    frame.progress,
    selectedTarget
  );
  const gazeDistance = THREE.MathUtils.lerp(
    EYE_GAZE_DISTANCE,
    RAINBOW_CAMERA_NEAR,
    pathPose.travelBlend
  );
  return {
    position: pathPose.position,
    target: pathPose.position.clone().addScaledVector(pathPose.forward, gazeDistance),
    fov: THREE.MathUtils.lerp(
      observerFov,
      DEFAULT_CAMERA_FOV,
      pathPose.turnBlend
    )
  };
}

function configureRainbowControls(frame: RainbowZoomFrame): void {
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableRotate =
    rainbowMode === "external" ||
    rainbowMode === "move" ||
    !rainbowJourney.hasExplicitSelection() ||
    frame.progress <= EYE_LOOK_END ||
    frame.progress >= DETAIL_ORBIT_START;
  controls.minDistance = rainbowMode === "external"
    ? RAINBOW_CAMERA_NEAR
    : 0.45;
  controls.maxDistance = RAINBOW_CAMERA_FAR;
}

function applyRainbowCameraPose(frame: RainbowZoomFrame): void {
  const pose = rainbowCameraPose(frame);
  applyingSemanticZoom = true;
  try {
    controls.target.copy(pose.target);
    camera.position.copy(pose.position);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    configureRainbowControls(frame);
    controls.update();
  } finally {
    applyingSemanticZoom = false;
  }
}

function applyRainbowProgress(progress: number): void {
  if (
    rainbowMode === "approach" &&
    progress <= 1e-6 &&
    state.rainbowZoom > 1e-6
  ) {
    resetInspectionNavigation();
  }
  const frame = rainbowZoomFrame(availableRainbowProgress(progress));
  state.rainbowZoom = frame.progress;
  rememberRainbowProgress();
  rainbowJourney.setObserverView(isObserverViewMode());
  rainbowJourney.applyZoom(frame);
  applyRainbowCameraPose(frame);
  updateRainbowProgressUi(frame);
  requestRender();
}

function cancelRainbowAnimation(): void {
  if (!rainbowAnimationFrame) return;
  cancelAnimationFrame(rainbowAnimationFrame);
  rainbowAnimationFrame = 0;
}

function animateRainbowProgress(
  targetProgress: number,
  onComplete?: () => void,
  onFrame?: (easedProgress: number) => void
): void {
  cancelRainbowAnimation();
  const target = availableRainbowProgress(targetProgress);
  const start = state.rainbowZoom;
  const difference = target - start;
  if (Math.abs(difference) < 1e-4 || prefersReducedMotion.matches) {
    onFrame?.(1);
    applyRainbowProgress(target);
    announceRainbowProgress(rainbowZoomFrame(state.rainbowZoom));
    onComplete?.();
    return;
  }
  const startedAt = performance.now();
  const duration = Math.max(300, Math.abs(difference) * 900);
  const step = (now: number): void => {
    const unit = THREE.MathUtils.clamp((now - startedAt) / duration, 0, 1);
    const eased = unit * unit * (3 - 2 * unit);
    onFrame?.(eased);
    applyRainbowProgress(start + difference * eased);
    if (unit < 1) rainbowAnimationFrame = requestAnimationFrame(step);
    else {
      rainbowAnimationFrame = 0;
      announceRainbowProgress(rainbowZoomFrame(state.rainbowZoom));
      onComplete?.();
    }
  };
  rainbowAnimationFrame = requestAnimationFrame(step);
}

function animateInspectionReturnToOverview(onComplete: () => void): void {
  const startLookDirection = controls.target.clone().sub(camera.position);
  if (startLookDirection.lengthSq() < 1e-12) {
    startLookDirection.copy(inspectionLookDirection);
  }
  startLookDirection.normalize();
  const defaultDirection = defaultObserverLookDirection(state.sunElevation, state.sunAzimuth);
  const endLookDirection = new THREE.Vector3(
    defaultDirection.x,
    defaultDirection.y,
    defaultDirection.z
  ).normalize();
  animateRainbowProgress(0, onComplete, (easedProgress) => {
    const nextDirection = slerpCameraDirection(
      startLookDirection,
      endLookDirection,
      easedProgress
    );
    inspectionOverviewLookDirection.copy(nextDirection);
    inspectionLookDirection.copy(nextDirection);
  });
}

function resetCamera(): void {
  if (isRainbowView(state.view)) {
    if (rainbowMode === "move") {
      resetPhysicalObserver();
      return;
    }
    setRainbowDropSelectionArmed(false, false);
    selectionGesture.cancel();
    const finishAtOverview = (): void => {
      if (rainbowMode === "approach") {
        eyeViewTracksSun = true;
        resetEyeLookDirection();
        resetInspectionNavigation();
      } else if (rainbowMode === "external") {
        structureDirection.copy(DEFAULT_STRUCTURE_DIRECTION);
      }
      detailOrbitDirection = null;
      applyRainbowProgress(0);
      updateRainbowModeUi();
    };
    const returnFromField = (): void => {
      if (rainbowMode === "external") {
        detailOrbitDirection = null;
        animateRainbowProgress(0, finishAtOverview);
        return;
      }
      resetOverlapPick();
      resetWavelengthSelectionCycle();
      detailOrbitDirection = null;
      rainbowJourney.setObserverView(isObserverViewMode());
      applyRainbowProgress(Math.min(state.rainbowZoom, RAIN_FIELD_APPROACH_END));
      updateRainbowModeUi();
      animateInspectionReturnToOverview(finishAtOverview);
    };
    if (
      rainbowJourney.hasExplicitSelection() &&
      state.rainbowZoom > RAIN_FIELD_APPROACH_END
    ) {
      animateRainbowProgress(RAIN_FIELD_APPROACH_END, returnFromField);
    } else returnFromField();
    return;
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
  camera.fov = DEFAULT_CAMERA_FOV;
  camera.updateProjectionMatrix();
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = false;
  controls.update();
  updateCameraReadout();
}

function focusCurrentParticle(): void {
  if (isRainbowView(state.view)) {
    if (rainbowMode === "move") {
      resetPhysicalObserver();
      return;
    }
    if (!rainbowJourney.hasExplicitSelection()) {
      const nextArmed = !rainbowDropSelectionArmed;
      setRainbowDropSelectionArmed(nextArmed);
      if (nextArmed && state.rainbowZoom < RAIN_FIELD_APPROACH_END) {
        animateRainbowProgress(RAIN_FIELD_APPROACH_END);
      }
      return;
    }
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

function selectionAnnouncement(snapshot: FocusDropletSnapshot): string {
  return snapshot.contributes
    ? `${snapshot.id}を選択。反太陽点から${snapshot.apparentRadiusDeg.toFixed(2)}度、${snapshot.dominantWavelengthNm?.toFixed(1)}ナノメートル相当の寄与滴です。`
    : `${snapshot.id}を選択。反太陽点から${snapshot.apparentRadiusDeg.toFixed(2)}度で、現在の虹帯には寄与しません。`;
}

function acceptRainDropSelection(
  snapshot: FocusDropletSnapshot,
  startTarget: THREE.Vector3,
  startCameraPosition: THREE.Vector3,
  extraStatus = ""
): void {
  cancelRainbowAnimation();
  rainbowDropSelectionArmed = false;
  selectionGesture.cancel();
  if (
    rainbowMode === "approach" &&
    shouldCaptureDropApproachAnchor(state.rainbowZoom)
  ) {
    selectedApproachAnchorPosition = startCameraPosition.clone();
    const startForward = startTarget.clone().sub(startCameraPosition);
    selectedApproachAnchorDirection = startForward.lengthSq() > 1e-12
      ? startForward.normalize()
      : inspectionLookDirection.clone();
  } else {
    selectedApproachAnchorPosition = null;
    selectedApproachAnchorDirection = null;
  }
  const frame = rainbowZoomFrame(state.rainbowZoom);
  detailOrbitDirection = null;
  rainbowJourney.setObserverView(isObserverViewMode());
  rainbowJourney.applyZoom(frame);
  updateRainbowProgressUi(frame);
  updateRainbowModeUi();
  updateRainbowExplanation();
  const status = `${selectionAnnouncement(snapshot)}${extraStatus ? ` ${extraStatus}` : ""}`;
  const endPose = rainbowCameraPose(frame);
  const startFov = camera.fov;
  const travel =
    startCameraPosition.distanceTo(endPose.position) +
    startTarget.distanceTo(endPose.target);
  if (travel < 1e-4 || frame.progress < 0.1 || prefersReducedMotion.matches) {
    applyRainbowCameraPose(frame);
    updateCameraReadout();
    setText("#zoom-status", status);
    requestRender();
    return;
  }

  const startedAt = performance.now();
  const duration = THREE.MathUtils.clamp(360 + travel * 28, 420, 900);
  const step = (now: number): void => {
    const unit = THREE.MathUtils.clamp((now - startedAt) / duration, 0, 1);
    const eased = unit * unit * (3 - 2 * unit);
    applyingSemanticZoom = true;
    try {
      controls.target.lerpVectors(startTarget, endPose.target, eased);
      camera.position.lerpVectors(startCameraPosition, endPose.position, eased);
      camera.fov = THREE.MathUtils.lerp(startFov, endPose.fov, eased);
      camera.updateProjectionMatrix();
      configureRainbowControls(frame);
      controls.update();
    } finally {
      applyingSemanticZoom = false;
    }
    updateCameraReadout();
    requestRender();
    if (unit < 1) {
      rainbowAnimationFrame = requestAnimationFrame(step);
    } else {
      rainbowAnimationFrame = 0;
      setText("#zoom-status", status);
    }
  };
  rainbowAnimationFrame = requestAnimationFrame(step);
}

function resetWavelengthSelectionCycle(): void {
  wavelengthSelectionTargetNm = null;
  wavelengthSelectionOffset = 0;
}

function selectRainbowContributorByWavelength(targetWavelengthNm: number): void {
  if (!isRainbowView(state.view)) setView("overview");
  resetOverlapPick();
  if (wavelengthSelectionTargetNm === targetWavelengthNm) wavelengthSelectionOffset += 1;
  else {
    wavelengthSelectionTargetNm = targetWavelengthNm;
    wavelengthSelectionOffset = 0;
  }
  const startTarget = controls.target.clone();
  const startCameraPosition = camera.position.clone();
  const snapshot = rainbowJourney.selectContributorNearestWavelength(
    targetWavelengthNm,
    wavelengthSelectionOffset
  );
  if (!snapshot) {
    setText(
      "#zoom-status",
      `${targetWavelengthNm.toFixed(0)}ナノメートル付近の寄与滴は、現在の表示密度と観測条件では見つかりません。`
    );
    return;
  }
  acceptRainDropSelection(
    snapshot,
    startTarget,
    startCameraPosition,
    `${targetWavelengthNm.toFixed(0)} nm側の候補${wavelengthSelectionOffset + 1}滴目。これは水滴の色ではなく、現在の観測点へ届く代表波長です。`
  );
}

function clearRainbowDropSelection(): void {
  const finish = (): void => {
    setRainbowDropSelectionArmed(false, false);
    selectionGesture.cancel();
    resetOverlapPick();
    resetWavelengthSelectionCycle();
    detailOrbitDirection = null;
    selectedApproachAnchorPosition = null;
    selectedApproachAnchorDirection = null;
    rainbowJourney.clearSelection();
    applyRainbowProgress(Math.min(state.rainbowZoom, RAIN_FIELD_APPROACH_END));
    updateRainbowExplanation();
    setText(
      "#zoom-status",
      "対象を解除しました。虹の色、画面上の任意の雨滴、または固定IDから選び直せます。"
    );
  };
  if (state.rainbowZoom > RAIN_FIELD_APPROACH_END) {
    animateRainbowProgress(RAIN_FIELD_APPROACH_END, finish);
  } else finish();
}

function selectAdjacentRainbowContributor(direction: -1 | 1): void {
  if (!isRainbowView(state.view)) setView("overview");
  resetWavelengthSelectionCycle();
  resetOverlapPick();
  const startTarget = controls.target.clone();
  const startCameraPosition = camera.position.clone();
  const snapshot = rainbowJourney.selectAdjacentContributor(direction);
  if (snapshot) acceptRainDropSelection(snapshot, startTarget, startCameraPosition);
  else setText("#zoom-status", "現在の表示条件では、選択できる寄与滴がありません。");
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
  setHidden("#rainbow-selection-controls", !isRainbow);
  setHidden("#wavelength-selection-actions", !isRainbow);
  setHidden("#drop-selection-actions", !isRainbow);
  setHidden("#mobile-wavelength-dock", !isRainbow);
  setHidden("#mobile-drop-dock", !isRainbow);
  setHidden("#mobile-drop-id-dock", !isRainbow);
  setHidden("#selected-drop-readout", !isRainbow);
  setHidden("#rainbow-perspective-switch", !isRainbow);
  setHidden("#world-legend", !isRainbow || rainbowMode !== "external");

  if (isHalo) setText("#focus-particle", "氷晶へ寄る");
  else if (!isRainbowView(state.view)) setText("#focus-particle", "水滴・光路へ");
  setText(
    "#reset-view",
    isRainbow && rainbowMode === "move" ? "観測者を開始位置へ" : isRainbow ? "視点を戻す" : "視点を戻す"
  );
  const zoomInLabel = isRainbow
    ? rainbowMode === "move"
      ? "観測者を視線の水平方位へ前進"
      : rainbowJourney.hasExplicitSelection()
        ? "選択した水滴の光路側へ拡大"
        : "特定の雨滴を選ばず雨域へ前進"
    : "模型を拡大";
  const zoomOutLabel = isRainbow
    ? rainbowMode === "move" ? "観測者を視線の水平方位と逆へ後退" : "虹の全景側へ縮小"
    : "模型を縮小";
  for (const selector of ["#zoom-in", "#mobile-zoom-in"]) {
    requireElement<HTMLButtonElement>(selector).setAttribute("aria-label", zoomInLabel);
  }
  for (const selector of ["#zoom-out", "#mobile-zoom-out"]) {
    requireElement<HTMLButtonElement>(selector).setAttribute("aria-label", zoomOutLabel);
  }
  const usesSemanticZoom = isRainbow && rainbowMode !== "move";
  requireElement<HTMLInputElement>("#semantic-zoom").disabled = !usesSemanticZoom;
  requireElement<HTMLInputElement>("#mobile-semantic-zoom").disabled = !usesSemanticZoom;
  setHidden("#semantic-zoom-control", !usesSemanticZoom);
  setHidden("#mobile-semantic-zoom-control", !usesSemanticZoom);
  setHidden("#free-move-note", !(isRainbow && rainbowMode === "move"));
  setHidden("#mobile-free-move-note", !(isRainbow && rainbowMode === "move"));
  setText("#semantic-zoom-label", isRainbow ? "虹→雨滴群→選択滴→光路" : "虹モードで使用");
  setText("#mobile-semantic-zoom-label", isRainbow ? "虹→雨滴群→選択滴→光路" : "虹モードで使用");
  if (!isRainbow) {
    requireElement<HTMLOutputElement>("#semantic-zoom-value").value = "—";
    requireElement<HTMLOutputElement>("#mobile-semantic-zoom-value").value = "—";
  }
  // The outside camera is only a viewpoint. Sun, order, and density remain
  // live physical inputs so the same 3D world can be explored continuously.
  const freezeConditions = false;
  document.querySelectorAll<HTMLButtonElement>("[data-order]").forEach((button) => {
    button.disabled = freezeConditions;
  });
  requireElement<HTMLInputElement>("#sun-elevation").disabled = freezeConditions;
  requireElement<HTMLInputElement>("#sun-azimuth").disabled = freezeConditions;
  requireElement<HTMLInputElement>("#particle-density").disabled = freezeConditions;
  updateRainbowModeUi();
}

function updateRainbowModeUi(): void {
  document
    .querySelectorAll<HTMLButtonElement>("[data-rainbow-mode]")
    .forEach((button) => {
      const active = button.dataset.rainbowMode === rainbowMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      if (button.dataset.rainbowMode === "approach") {
        button.textContent = rainbowModeLabel("approach");
      }
    });
  syncRainbowDropSelectionUi();
  updateRainbowDragHint();
}

function updateRainbowDragHint(
  frame: RainbowZoomFrame = rainbowZoomFrame(state.rainbowZoom)
): void {
  if (!isRainbowView(state.view)) {
    setText("#drag-hint", "↔ ドラッグで360°回転");
  } else if (rainbowMode === "external") {
    setText(
      "#drag-hint",
      rainbowJourney.hasExplicitSelection()
        ? "↔ 外側カメラを回転 / ズームで選択滴と表示光路へ"
        : "↔ 外側カメラを回転 / 雨滴を選ぶと表示光路へ接近"
    );
  } else if (rainbowMode === "move") {
    setText("#drag-hint", "↔ 水平方位を変更 / ホイール・ピンチで前後移動");
  } else if (!rainbowJourney.hasExplicitSelection()) {
    setText(
      "#drag-hint",
      rainbowDropSelectionArmed
        ? "◎ 選択中：見える雨滴を短くタップ / ドラッグでは選択しません"
        : canFreelyExploreRainField()
          ? "自由探索：ズームインで前進／ズームアウトで虹へ戻る、WASD/QEで移動"
          : "↔ 視線を変更 / ズームで雨滴群へ（特定の滴は選びません）"
    );
  } else if (frame.progress <= EYE_LOOK_END) {
    setText("#drag-hint", "↔ ドラッグで視線を360°");
  } else if (frame.progress < DETAIL_ORBIT_START) {
    setText("#drag-hint", "↕ ホイール・ピンチで同じ水滴へ接近");
  } else {
    setText("#drag-hint", "↔ ドラッグで水滴模型を360°");
  }
}

function setView(view: ViewName): void {
  cancelQueuedObserverMove();
  const wasRainbow = isRainbowView(state.view);
  if (isRainbowView(view)) {
    rainbowJourney.setVisible(true);
    chase.setVisible(false);
    halo.setVisible(false);
    if (!wasRainbow) {
      state.view = view;
      rainbowMode = "approach";
      externalOpticalSnapshot = null;
      eyeViewTracksSun = true;
      resetEyeLookDirection();
      detailOrbitDirection = null;
      structureDirection.copy(DEFAULT_STRUCTURE_DIRECTION);
      syncCurrentScene();
      lastRainbowChapter = null;
      const targetProgress = view === "overview" ? 0 : 0.86;
      rainbowJourney.setObserverView(true);
      updateRainbowModeUi();
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
  const focus = rainbowJourney.getFocusSnapshot();
  const ray = findStationaryRay(focus.refractiveIndex, state.order);
  const tracedRay = traceDropletRay(focus.refractiveIndex, state.order);
  const entryEvent = tracedRay.interfaceEvents.find((event) => event.kind === "entry-refraction");
  const reflectionEvents = tracedRay.interfaceEvents.filter(
    (event) => event.kind === "internal-reflection"
  );
  const exitEvent = tracedRay.interfaceEvents.find((event) => event.kind === "exit-refraction");
  const fresnel = fresnelPower(ray.refractionDeg, focus.refractiveIndex, 1);
  const isFar = frame.chapter === "overview" || frame.chapter === "contributor";
  const selectedWavelengthLabel = focus.contributes
    ? `${focus.dominantWavelengthNm?.toFixed(1)} nm相当`
    : `最寄りの比較光線 ${focus.referenceWavelengthNm.toFixed(1)} nm`;

  setText(
    "#angle-label",
    isFar ? `${orderLabel}の角半径` : focus.contributes ? "選択滴から目へ届く虹角" : "選択滴の視線角"
  );
  setText(
    "#angle-value",
    isFar
      ? `${range.minimumDeg.toFixed(1)}°–${range.maximumDeg.toFixed(1)}°`
      : `${focus.apparentRadiusDeg.toFixed(3)}°`
  );
  setText(
    "#angle-context",
    isFar
      ? rainbowVisibilityNote(state.order, state.sunElevation, rainbowMode)
      : focus.contributes
        ? `${selectedWavelengthLabel}の停留角 ${focus.rainbowRadiusDeg.toFixed(3)}°と一致。入射角 ${ray.incidenceDeg.toFixed(2)}° → 水中 ${ray.refractionDeg.toFixed(2)}°です。`
        : `この滴は虹帯 ${range.minimumDeg.toFixed(1)}°–${range.maximumDeg.toFixed(1)}°の外です。表示する比較光線は観察者の目を外れます。`
  );
  setText(
    "#reflection-note",
    isPrimary
      ? "水滴内で1回の部分反射。赤が外側、紫が内側。"
      : "水滴内で2回の部分反射。色順が逆になり、赤が内側。"
  );

  switch (frame.chapter) {
    case "overview":
      setText(
        "#scene-kicker",
        rainbowMode === "move"
          ? "MOVING OBSERVER → RECLASSIFIED DROPS"
          : rainbowMode === "external"
            ? "SUN + OBSERVER + RAIN FIELD → ONE 3D WORLD"
            : "RAIN FIELD → RAINBOW"
      );
      setText(
        "#scene-title",
        rainbowMode === "move"
          ? "観測者を動かすと、同じ雨域から寄与する雨滴が選び直される"
          : rainbowMode === "external"
            ? "白い太陽光が、別々の雨滴から赤と青紫になって目へ届く"
            : "未分解の大量雨滴の光が、連続した虹の帯になる"
      );
      setFacts(
        ["固定3D雨滴", "現在の寄与ID", rainbowMode === "move" ? "開始点から" : "選択ID", "選択状態"],
        [
          `${formatCount(focus.visibleDroplets)} / ${formatCount(focus.totalDroplets)}滴`,
          `${formatCount(focus.contributingDroplets)}滴`,
          rainbowMode === "move"
            ? `${focus.observerPositionM.distanceTo(INITIAL_RAINBOW_OBSERVER_POSITION_M).toFixed(1)} m`
            : focus.explicitlySelected ? focus.id : "未選択",
          focus.explicitlySelected
            ? focus.contributes ? `${focus.dominantWavelengthNm?.toFixed(1)} nm相当` : "虹帯外"
            : "色・点・IDから選択"
        ]
      );
      setText(
        "#explanation-title",
        rainbowMode === "external"
          ? "主虹と副虹を同時表示し、色ごとに別の実在雨滴を目へ結ぶ"
          : rainbowMode === "move"
            ? "雨滴の世界座標は固定し、観測者位置から角度を全件再計算"
            : "遠景では1滴ずつ見えず、方向ごとの散乱光が積算される"
      );
      setText(
        "#explanation-body",
        rainbowMode === "external"
          ? "白線は雨滴へ入るまで重なった太陽光、色線は水との境界で分散し、屈折・内部反射を経て観測者の目へ届く経路です。赤と青紫は別IDの雨滴を使い、主虹・副虹の4経路を同じ固定雨滴場から選んでいます。二つの虹の間にはアレキサンダーの暗帯も角度計算から置いています。"
          : rainbowMode === "move"
            ? `観測者は開始点から最大${FREE_MOVE_LIMIT_M} mの範囲を水平移動します。60,000滴の位置とIDは変えず、各移動後に観測者からの方向・距離・代表波長を再計算します。視線を回すだけでは物理条件は変わりません。`
            : "全景の滑らかな帯は、波長別の停留角を密に積分し、太陽円盤と雨滴径の広がりで平滑化した相対放射輝度近似です。独立した虹画像ではありません。ズームすると、同じ角条件を満たす固定seedの代表雨滴ID層が徐々に解像されます。"
      );
      break;
    case "contributor":
      if (!focus.explicitlySelected) {
        setText("#scene-kicker", "RAIN FIELD → CHOOSE ANY DROP");
        setText("#scene-title", "大量雨滴が見えてきた。ここから任意の1滴を選ぶ");
        setFacts(
          ["表示雨滴", "寄与候補", "対象", "選び方"],
          [
            `${formatCount(focus.visibleDroplets)}滴`,
            `${formatCount(focus.contributingDroplets)}滴`,
            "未選択",
            "色・選択モードの点・固定ID"
          ]
        );
        setText("#explanation-title", "既定IDへは移動しません");
        setText(
          "#explanation-body",
          "色付きの点は現在の観測点へ虹光を送る代表滴、灰色点は現在の虹角外です。「画面の雨滴を選ぶ」を押した後、任意の点をクリック／短くタップすると、その固定IDへ以後のズームを接続します。"
        );
        break;
      }
      setText("#scene-kicker", focus.contributes ? "RAINBOW → EXISTING CONTRIBUTOR" : "RAIN FIELD → NON-CONTRIBUTOR");
      setText(
        "#scene-title",
        focus.contributes ? "連続した虹の帯を、同じ方向の代表雨滴へ分解する" : "選択した灰色の雨滴が、なぜ虹にならないかを見る"
      );
      setFacts(
        ["雨滴ID", "観測上の状態", "反太陽点から", "観察者からの距離"],
        [
          focus.id,
          focus.contributes ? selectedWavelengthLabel : "現在の虹帯には非寄与",
          `${focus.apparentRadiusDeg.toFixed(3)}°`,
          `${focus.distanceFromObserverM.toFixed(1)} m（標本内）`
        ]
      );
      setText(
        "#explanation-title",
        focus.contributes ? "全景の同じ見かけ方向に潜んでいた代表ID" : "光を目へ結ばないことも、選択結果の一部"
      );
      setText(
        "#explanation-body",
        focus.contributes
          ? "連続帯の下に、同じ観察者・太陽・虹角で分類した代表雨滴ID層を重ねています。選択点、拡大球、光路始点はすべて同じIDと世界座標です。同じ方向には近距離・遠距離の別IDもあり、虹角だけから固有距離は決まりません。"
          : `この滴の視線角は虹帯から ${Math.abs(focus.angularErrorDeg).toFixed(2)}°外れています。水滴自体は拡大できますが、虹の射出光を観察者の目へ偽って接続しません。`
      );
      break;
    case "droplet":
      setText("#scene-kicker", "SAME FIELD ID → LOCAL DROP MODEL");
      setText("#scene-title", "周囲の大量雨滴を残しながら、選択した1滴が見えてくる");
      setFacts(
        ["水滴模型", "入射角", "水中の屈折角", "内部反射"],
        [
          `直径${focus.diameterMm.toFixed(2)} mm・等価球`,
          `${ray.incidenceDeg.toFixed(2)}°`,
          `${ray.refractionDeg.toFixed(2)}°`,
          `${state.order}回（部分反射）`
        ]
      );
      setText("#explanation-title", `選択ID ${focus.id} は切り替わらない`);
      setText(
        "#explanation-body",
        "雨域のmスケールと水滴のmmスケールを同じ実寸座標へ無理に置かず、選択座標を中心とする局所模型へ連続的に再正規化します。点表示が消える前から同じ位置に水滴表面を重ねています。"
      );
      break;
    case "ray":
      setText("#scene-kicker", focus.contributes ? "ONE OBSERVER-REACHING CAUSTIC RAY" : "NEAREST CAUSTIC RAY MISSES THE EYE");
      setText(
        "#scene-title",
        focus.contributes ? "この実滴から目へ届く1本を、屈折・反射の順にたどる" : "最寄りの虹光路と視線の角度差を見る"
      );
      setFacts(
        ["表示光線", "空気→水", `内部反射（${reflectionEvents.length}面）`, "水→空気"],
        [
          selectedWavelengthLabel,
          `${entryEvent?.incidenceDeg.toFixed(3)}° → ${entryEvent?.outgoingDeg.toFixed(3)}°`,
          reflectionEvents
            .map(
              (event, index) =>
                `${index + 1}: ${event.incidenceDeg.toFixed(3)}° = ${event.outgoingDeg.toFixed(3)}°`
            )
            .join(" / "),
          `${exitEvent?.incidenceDeg.toFixed(3)}° → ${exitEvent?.outgoingDeg.toFixed(3)}°`
        ]
      );
      setText("#explanation-title", "白色入射 → Snell屈折 → 反射角＝入射角 → Snell射出");
      setText(
        "#explanation-body",
        focus.contributes
          ? `水滴の手前までは可視波長が重なった白色光1本です。界面以後は ${selectedWavelengthLabel} の水/空気相対屈折率 ${focus.refractiveIndex.toFixed(6)} を使い、各交点の法線からベクトル計算しています。射出方向は固定した観測者の目へ一致します。`
          : "虹帯外の滴にも太陽光は入りますが、この比較用停留光線の射出方向は観察者の目と一致しません。目への視線と虹光路を同一扱いしない表示です。"
      );
      break;
    case "dispersion":
      setText("#scene-kicker", "DISPERSION + PARTIAL TRANSMISSION");
      setText("#scene-title", "同じ白色入射光が、水面の境界から波長ごとに分かれる");
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
        "水滴の手前に色線は置かず、共通の入射位置までは白色光1本です。境界後の薄い7色は同じimpact parameterでSnellの法則を解いた分散比較、強い選択色は観測者へ届く停留経路です。破線は内部反射せず外へ透過する枝で、明るさは率に比例しません。"
      );
      break;
  }

  setText(
    "#fps-state",
    frame.chapter === "dispersion"
      ? "解析式 / 代表7波長"
      : `選択用代表ID ${formatCount(focus.visibleDroplets)}中 ${formatCount(focus.contributingDroplets)}候補`
  );
  setText(
    "#semantic-note",
    rainbowMode === "move"
      ? `物理観測者だけを固定3D雨域内で移動し、全${formatCount(focus.totalDroplets)} IDの寄与を新しい位置から再計算します。45 m制限は80–300 m球殻標本の境界影響を抑えるためです。`
      : rainbowMode === "external"
        ? `外側カメラは物理観測者を動かしません。主虹・副虹の赤／青紫は別々の実在ID、白線は水面までの入射光、色線は水面以後の屈折・内部反射・観測者への射出光です。太陽条件を変えると同じ60,000滴を再判定します。`
        : `遠景は未分解雨滴群の相対放射輝度近似です。固定seedの${formatCount(focus.totalDroplets)}代表IDから人が選んだ同じ1滴を、水滴内部まで追います。未選択では既定IDへ移動しません。`
  );
  setModelItems([
    "遠景は380–780 nmの波長別散乱を相対太陽スペクトルで重み付けした連続相対放射輝度です。接近すると固定した60,000滴の代表標本を解像し、選択点と外側3Dの点は同じID・同じ世界位置を保ちます。",
    "直径0.45–1.00 mmの等価球水滴・幾何光学です。水はIAPWS R9-97（20°C・998.2071 kg/m³）、空気はCiddor標準乾燥空気（20°C・1013.25 hPa・CO₂ 450 ppm）の圧縮係数込み分散式で計算し、その比を相対屈折率に使います。湿度・CO₂変動と大粒雨滴の扁平化は未実装です。",
    "各界面の交点・法線・入射方向からSnell屈折と鏡面反射をベクトル計算します。入射前は白色光1本、同一入射位置の境界後だけ代表7波長を分離します。",
    "遠景帯は約0.53°の太陽円盤と代表的な雨滴径広がりを等価幅で平滑化した表示用近似です。幾何光学の角度計算と、未実装のAiry／Lorenz–Mie・偏光・非球形雨滴を区別します。"
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
  if (isRainbowView(state.view)) cancelRainbowAnimation();
  const previousFocus = isRainbowView(state.view)
    ? rainbowJourney.getFocusSnapshot()
    : null;
  if (isRainbowView(state.view) && rainbowMode === "approach" && eyeViewTracksSun) {
    const direction = defaultObserverLookDirection(state.sunElevation, state.sunAzimuth);
    eyeLookDirection.set(direction.x, direction.y, direction.z).normalize();
    inspectionOverviewLookDirection.copy(eyeLookDirection);
    if (
      state.rainbowZoom <= EYE_LOOK_END &&
      inspectionFreeOffset.lengthSq() < 1e-12
    ) {
      inspectionLookDirection.copy(eyeLookDirection);
      inspectionPathDirection.copy(eyeLookDirection);
    }
  }
  if (isRainbowView(state.view)) detailOrbitDirection = null;
  syncCurrentScene();
  if (isRainbowView(state.view)) {
    applyRainbowProgress(state.rainbowZoom);
    updateRainbowExplanation();
    const nextFocus = rainbowJourney.getFocusSnapshot();
    if (previousFocus?.explicitlySelected && previousFocus.id !== nextFocus.id) {
      setText(
        "#zoom-status",
        `表示密度の変更により、表示中の実在水滴 ${nextFocus.id} へ選び直しました。`
      );
    } else if (
      previousFocus?.explicitlySelected &&
      previousFocus.contributes !== nextFocus.contributes
    ) {
      setText(
        "#zoom-status",
        nextFocus.contributes
          ? `${nextFocus.id}は新しい条件で虹へ寄与します。位置とIDは変わっていません。`
          : `${nextFocus.id}は新しい条件では虹帯外です。位置とIDは変わっていません。`
      );
    }
  } else {
    updateExplanation();
    requestRender();
  }
}

const CONDITION_UPDATE_INTERVAL_MS = 90;
let pendingConditionTimer = 0;
let lastConditionUpdateAt = 0;

function flushConditionUpdate(): void {
  if (pendingConditionTimer) {
    window.clearTimeout(pendingConditionTimer);
    pendingConditionTimer = 0;
  }
  lastConditionUpdateAt = performance.now();
  updateCurrentConditions();
}

function scheduleConditionUpdate(): void {
  const elapsed = performance.now() - lastConditionUpdateAt;
  if (elapsed >= CONDITION_UPDATE_INTERVAL_MS && !pendingConditionTimer) {
    flushConditionUpdate();
    return;
  }
  if (pendingConditionTimer) return;
  pendingConditionTimer = window.setTimeout(
    flushConditionUpdate,
    Math.max(0, CONDITION_UPDATE_INTERVAL_MS - elapsed)
  );
}

function updateCameraReadout(): void {
  const vector =
    isRainbowView(state.view) && isObserverViewMode()
      ? controls.target.clone().sub(camera.position)
      : camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(vector);
  const azimuth = normalizedDegrees(THREE.MathUtils.radToDeg(spherical.theta));
  const elevation = 90 - THREE.MathUtils.radToDeg(spherical.phi);
  setText(
    "#camera-readout",
    isRainbowView(state.view)
      ? `${rainbowModeLabel(rainbowMode)} / 方位 ${azimuth.toFixed(0)}° / 仰角 ${elevation.toFixed(0)}° / ${
          rainbowMode === "move"
            ? `移動 ${rainbowJourney.getObserverPositionM().distanceTo(INITIAL_RAINBOW_OBSERVER_POSITION_M).toFixed(1)} m`
            : canFreelyExploreRainField()
              ? `検査 ${inspectionDistanceFromObserverM().toFixed(0)} m`
            : `${Math.round(state.rainbowZoom * 100)}%`
        }`
      : `方位 ${azimuth.toFixed(0)}° / 仰角 ${elevation.toFixed(0)}° / 模型距離 ${spherical.radius.toFixed(1)}`
  );
}

function rotateCamera(deltaAzimuth: number, deltaPolar: number): void {
  if (
    isRainbowView(state.view) &&
    isObserverViewMode() &&
    (rainbowMode === "move" ||
      !rainbowJourney.hasExplicitSelection() ||
      state.rainbowZoom <= EYE_LOOK_END)
  ) {
    const activeLookDirection = rainbowMode === "approach"
      ? inspectionLookDirection
      : eyeLookDirection;
    const spherical = new THREE.Spherical().setFromVector3(activeLookDirection);
    spherical.theta += deltaAzimuth;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi + deltaPolar,
      controls.minPolarAngle,
      controls.maxPolarAngle
    );
    activeLookDirection.setFromSpherical(spherical).normalize();
    if (
      rainbowMode === "approach" &&
      state.rainbowZoom <= EYE_LOOK_END &&
      inspectionFreeOffset.lengthSq() < 1e-12
    ) {
      inspectionOverviewLookDirection.copy(inspectionLookDirection);
      inspectionPathDirection.copy(inspectionLookDirection);
    }
    eyeViewTracksSun = false;
    applyRainbowCameraPose(rainbowZoomFrame(state.rainbowZoom));
    updateCameraReadout();
    requestRender();
    return;
  }
  if (
    isRainbowView(state.view) &&
    rainbowMode === "approach" &&
    state.rainbowZoom < DETAIL_ORBIT_START
  ) {
    setText(
      "#zoom-status",
      "接近中はホイール・ピンチ・ズーム操作で同じ水滴を追います。70%以降は再び回転できます。"
    );
    return;
  }
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

function movePhysicalObserver(distanceM: number): void {
  if (rainbowMode !== "move" || !isRainbowView(state.view)) return;
  if (!Number.isFinite(distanceM) || Math.abs(distanceM) < 0.02) return;
  const current = rainbowJourney.getObserverPositionM();
  const movement = boundedHorizontalObserverMove(
    current,
    INITIAL_RAINBOW_OBSERVER_POSITION_M,
    eyeLookDirection,
    distanceM,
    FREE_MOVE_LIMIT_M
  );
  const candidate = new THREE.Vector3(
    movement.position.x,
    movement.position.y,
    movement.position.z
  );
  rainbowJourney.setObserverPositionM(candidate);
  state.rainbowZoom = 0;
  const frame = rainbowZoomFrame(0);
  rainbowJourney.setObserverView(true);
  rainbowJourney.applyZoom(frame);
  applyRainbowCameraPose(frame);
  updateRainbowProgressUi(frame);
  updateRainbowExplanation(frame);
  setText(
    "#zoom-status",
    movement.limited
      ? `代表雨域の境界影響を避けるため、開始位置から${FREE_MOVE_LIMIT_M}メートルで停止しました。`
      : `観測者を${Math.abs(distanceM).toFixed(1)}メートル${distanceM >= 0 ? "前進" : "後退"}。固定60,000滴の寄与判定を新しい位置で再計算しました。`
  );
  requestRender();
}

function resetPhysicalObserver(): void {
  cancelQueuedObserverMove();
  rainbowJourney.setObserverPositionM(INITIAL_RAINBOW_OBSERVER_POSITION_M);
  eyeViewTracksSun = true;
  resetEyeLookDirection();
  state.rainbowZoom = 0;
  applyRainbowProgress(0);
  updateRainbowExplanation(rainbowZoomFrame(0));
  setText("#zoom-status", "観測者を開始位置へ戻し、寄与する雨滴を再計算しました。");
}

function setRainbowMode(nextMode: RainbowMode): void {
  if (!isRainbowView(state.view)) setView("overview");
  if (nextMode === rainbowMode) {
    if (nextMode === "approach") {
      eyeViewTracksSun = true;
      resetEyeLookDirection();
      applyRainbowCameraPose(rainbowZoomFrame(state.rainbowZoom));
      requestRender();
    }
    return;
  }

  cancelRainbowAnimation();
  setRainbowDropSelectionArmed(false, false);
  selectionGesture.cancel();
  cancelQueuedObserverMove();
  rememberRainbowProgress();
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const startFov = camera.fov;
  if (nextMode === "external") {
    externalOpticalSnapshot = {
      observerPositionM: rainbowJourney.getObserverPositionM(),
      lookDirection: eyeLookDirection.clone()
    };
  } else if (rainbowMode === "external" && externalOpticalSnapshot) {
    eyeLookDirection.copy(externalOpticalSnapshot.lookDirection);
    rainbowJourney.setObserverPositionM(externalOpticalSnapshot.observerPositionM);
    rainbowJourney.setConditions(state.order, state.sunElevation, state.sunAzimuth);
    externalOpticalSnapshot = null;
  }
  rainbowMode = nextMode;
  state.rainbowZoom = nextMode === "move" ? 0 : rainbowProgressByMode[nextMode];
  if (nextMode === "approach") eyeViewTracksSun = false;
  rainbowJourney.setObserverView(isObserverViewMode());
  renderControlVisibility();
  updateRainbowModeUi();
  const frame = rainbowZoomFrame(availableRainbowProgress(state.rainbowZoom));
  state.rainbowZoom = frame.progress;
  rememberRainbowProgress();
  rainbowJourney.applyZoom(frame);
  updateRainbowProgressUi(frame);
  updateRainbowExplanation(frame);
  setText("#zoom-status", rainbowModeStatus(nextMode));
  const endPose = rainbowCameraPose(frame);
  if (prefersReducedMotion.matches) {
    applyRainbowCameraPose(frame);
    requestRender();
    return;
  }

  const startedAt = performance.now();
  const duration = 460;
  const step = (now: number): void => {
    const unit = THREE.MathUtils.clamp((now - startedAt) / duration, 0, 1);
    const eased = unit * unit * (3 - 2 * unit);
    applyingSemanticZoom = true;
    try {
      camera.position.lerpVectors(startPosition, endPose.position, eased);
      controls.target.lerpVectors(startTarget, endPose.target, eased);
      camera.fov = THREE.MathUtils.lerp(startFov, endPose.fov, eased);
      camera.updateProjectionMatrix();
      configureRainbowControls(frame);
      controls.update();
    } finally {
      applyingSemanticZoom = false;
    }
    updateCameraReadout();
    requestRender();
    if (unit < 1) {
      rainbowAnimationFrame = requestAnimationFrame(step);
    } else {
      rainbowAnimationFrame = 0;
      updateRainbowProgressUi(frame);
      updateRainbowExplanation(frame);
      setText("#zoom-status", rainbowModeStatus(nextMode));
    }
  };
  rainbowAnimationFrame = requestAnimationFrame(step);
}

document.querySelectorAll<HTMLButtonElement>(".mode-tab[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (view === "overview" || view === "chase" || view === "droplet" || view === "halo") {
      setView(view);
    }
  });
});

document
  .querySelectorAll<HTMLButtonElement>("[data-rainbow-mode]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.rainbowMode;
      if (mode === "approach" || mode === "move" || mode === "external") {
        setRainbowMode(mode);
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
    flushConditionUpdate();
  });
});

const sunElevationInput = requireElement<HTMLInputElement>("#sun-elevation");
sunElevationInput.addEventListener("input", () => {
  state.sunElevation = Number(sunElevationInput.value);
  requireElement<HTMLOutputElement>("#sun-elevation-value").value = `${state.sunElevation}°`;
  sunElevationInput.setAttribute("aria-valuetext", `${state.sunElevation}度`);
  scheduleConditionUpdate();
});
sunElevationInput.addEventListener("change", flushConditionUpdate);

const sunAzimuthInput = requireElement<HTMLInputElement>("#sun-azimuth");
sunAzimuthInput.addEventListener("input", () => {
  state.sunAzimuth = Number(sunAzimuthInput.value);
  requireElement<HTMLOutputElement>("#sun-azimuth-value").value = `${state.sunAzimuth}°`;
  sunAzimuthInput.setAttribute("aria-valuetext", `${state.sunAzimuth}度`);
  scheduleConditionUpdate();
});
sunAzimuthInput.addEventListener("change", flushConditionUpdate);

const densityInput = requireElement<HTMLInputElement>("#particle-density");
densityInput.addEventListener("input", () => {
  state.particleDensity = Number(densityInput.value) / 100;
  requireElement<HTMLOutputElement>("#particle-density-value").value = `${densityInput.value}%`;
  densityInput.setAttribute("aria-valuetext", `${densityInput.value}パーセント`);
  if (isRainbowView(state.view)) {
    rainbowJourney.setDensity(state.particleDensity);
    applyRainbowProgress(state.rainbowZoom);
    updateRainbowExplanation();
  } else if (state.view === "halo") {
    halo.setDensity(state.particleDensity);
  }
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
requireElement<HTMLButtonElement>("#previous-contributor").addEventListener("click", () =>
  selectAdjacentRainbowContributor(-1)
);
requireElement<HTMLButtonElement>("#next-contributor").addEventListener("click", () =>
  selectAdjacentRainbowContributor(1)
);
requireElement<HTMLButtonElement>("#mobile-previous-contributor").addEventListener("click", () =>
  selectAdjacentRainbowContributor(-1)
);
requireElement<HTMLButtonElement>("#mobile-next-contributor").addEventListener("click", () =>
  selectAdjacentRainbowContributor(1)
);
document.querySelectorAll<HTMLButtonElement>("[data-select-wavelength]").forEach((button) => {
  button.addEventListener("click", () => {
    const wavelengthNm = Number(button.dataset.selectWavelength);
    if (Number.isFinite(wavelengthNm)) selectRainbowContributorByWavelength(wavelengthNm);
  });
});
requireElement<HTMLButtonElement>("#clear-drop-selection").addEventListener(
  "click",
  clearRainbowDropSelection
);
requireElement<HTMLButtonElement>("#mobile-clear-drop-selection").addEventListener(
  "click",
  () => {
    if (rainbowJourney.hasExplicitSelection()) clearRainbowDropSelection();
    else focusCurrentParticle();
  }
);

function normalizedDropId(rawValue: string): string | null {
  const value = rawValue.trim().toLowerCase();
  const digits = /^\d{1,5}$/.exec(value);
  if (digits) return `drop-${Number(value).toString().padStart(6, "0")}`;
  return /^drop-\d{6}$/.test(value) ? value : null;
}

function selectDropByEnteredId(input: HTMLInputElement): void {
  if (!isRainbowView(state.view)) setView("overview");
  const id = normalizedDropId(input.value);
  if (!id) {
    setText("#zoom-status", "雨滴IDは0〜59999、または drop-000000 形式で入力してください。");
    input.setAttribute("aria-invalid", "true");
    return;
  }
  const startTarget = controls.target.clone();
  const startCameraPosition = camera.position.clone();
  const snapshot = rainbowJourney.selectById(id);
  if (!snapshot) {
    setText("#zoom-status", `${id}は固定雨域にありません。0〜59999を指定してください。`);
    input.setAttribute("aria-invalid", "true");
    return;
  }
  input.removeAttribute("aria-invalid");
  resetWavelengthSelectionCycle();
  requireElement<HTMLInputElement>("#drop-id-input").value = snapshot.id;
  requireElement<HTMLInputElement>("#mobile-drop-id-input").value = snapshot.id;
  resetOverlapPick();
  acceptRainDropSelection(
    snapshot,
    startTarget,
    startCameraPosition,
    "描画密度にかかわらず、固定された60,000滴の同じ位置を追跡します。"
  );
}

const desktopDropIdInput = requireElement<HTMLInputElement>("#drop-id-input");
const mobileDropIdInput = requireElement<HTMLInputElement>("#mobile-drop-id-input");
requireElement<HTMLButtonElement>("#select-drop-id").addEventListener("click", () =>
  selectDropByEnteredId(desktopDropIdInput)
);
requireElement<HTMLButtonElement>("#mobile-select-drop-id").addEventListener("click", () =>
  selectDropByEnteredId(mobileDropIdInput)
);
for (const input of [desktopDropIdInput, mobileDropIdInput]) {
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    selectDropByEnteredId(input);
  });
}
requireElement<HTMLButtonElement>("#zoom-in").addEventListener("click", () => setCameraDistance(0.9));
requireElement<HTMLButtonElement>("#zoom-out").addEventListener("click", () => setCameraDistance(1.1));

const semanticZoomInput = requireElement<HTMLInputElement>("#semantic-zoom");
const mobileSemanticZoomInput = requireElement<HTMLInputElement>("#mobile-semantic-zoom");
for (const input of [semanticZoomInput, mobileSemanticZoomInput]) {
  input.addEventListener("input", () => {
    if (!isRainbowView(state.view)) setView("overview");
    selectionGesture.cancel();
    cancelRainbowAnimation();
    applyRainbowProgress(Number(input.value) / 1_000);
  });
  input.addEventListener("change", () => {
    announceRainbowProgress(rainbowZoomFrame(state.rainbowZoom));
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
    selectionGesture.cancel();
    cancelRainbowAnimation();
    if (
      isObserverViewMode() &&
      (rainbowMode === "move" ||
        !rainbowJourney.hasExplicitSelection() ||
        state.rainbowZoom <= EYE_LOOK_END)
    ) {
      const nextDirection = controls.target.clone().sub(camera.position);
      if (nextDirection.lengthSq() > 1e-10) {
        const activeLookDirection = rainbowMode === "approach"
          ? inspectionLookDirection
          : eyeLookDirection;
        activeLookDirection.copy(nextDirection.normalize());
        if (
          rainbowMode === "approach" &&
          state.rainbowZoom <= EYE_LOOK_END &&
          inspectionFreeOffset.lengthSq() < 1e-12
        ) {
          inspectionOverviewLookDirection.copy(inspectionLookDirection);
          inspectionPathDirection.copy(inspectionLookDirection);
        }
        eyeViewTracksSun = false;
        applyRainbowCameraPose(rainbowZoomFrame(state.rainbowZoom));
      }
    } else if (
      rainbowMode === "approach" &&
      state.rainbowZoom >= DETAIL_ORBIT_START
    ) {
      const nextDirection = camera.position.clone().sub(controls.target);
      if (nextDirection.lengthSq() > 1e-10) {
        detailOrbitDirection = nextDirection.normalize();
      }
    } else if (rainbowMode === "external") {
      const nextDirection = camera.position.clone().sub(controls.target);
      if (nextDirection.lengthSq() > 1e-10) {
        structureDirection.copy(nextDirection.normalize());
      }
    }
    updateCameraReadout();
    requestRender();
    return;
  }
  updateCameraReadout();
  requestRender();
});

canvas.addEventListener(
  "wheel",
  (event) => {
    selectionGesture.cancel();
    if (event.ctrlKey || event.metaKey) {
      event.stopImmediatePropagation();
      return;
    }
    if (!isRainbowView(state.view)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelRainbowAnimation();
    const pixelDelta =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * Math.max(1, stage.clientHeight)
          : event.deltaY;
    const amount = zoomAmountFromWheelPixels(pixelDelta);
    const action = currentRainbowZoomAction(amount);
    if (action === "physical-observer-move") {
      queuePhysicalObserverMove(
        THREE.MathUtils.clamp(-pixelDelta * 0.025, -FREE_MOVE_STEP_M, FREE_MOVE_STEP_M)
      );
      return;
    }
    if (action === "inspection-forward") {
      moveInspectionCamera(
        THREE.MathUtils.clamp(-pixelDelta * 0.04, 0, INSPECTION_FREE_MOVE_STEP_M)
      );
      return;
    }
    applyRainbowProgress(state.rainbowZoom + amount);
  },
  { capture: true, passive: false }
);

const rainbowTouchPointers = new Map<number, { x: number; y: number }>();
let rainbowPinchPreviousDistance = 0;
let pinchingRainbow = false;

function currentRainbowPinchDistance(): number {
  const points = [...rainbowTouchPointers.values()];
  const first = points[0];
  const second = points[1];
  if (!first || !second) return 0;
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function endRainbowPinch(pointerId: number): void {
  rainbowTouchPointers.delete(pointerId);
  if (pinchingRainbow && rainbowTouchPointers.size < 2) {
    pinchingRainbow = false;
    rainbowPinchPreviousDistance = 0;
  }
  if (rainbowTouchPointers.size === 0) {
    controls.enabled = true;
  }
  if (rainbowTouchPointers.size === 0 && isRainbowView(state.view)) {
    configureRainbowControls(rainbowZoomFrame(state.rainbowZoom));
  }
}

canvas.addEventListener(
  "pointerdown",
  (event) => {
    if (event.pointerType !== "touch" || !isRainbowView(state.view)) return;
    rainbowTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (rainbowTouchPointers.size !== 2) return;
    rainbowPinchPreviousDistance = currentRainbowPinchDistance();
    pinchingRainbow = rainbowPinchPreviousDistance > 0;
    if (pinchingRainbow) {
      controls.enabled = false;
      selectionGesture.cancel();
    }
  },
  { capture: true, passive: true }
);

canvas.addEventListener(
  "pointermove",
  (event) => {
    if (event.pointerType !== "touch" || !rainbowTouchPointers.has(event.pointerId)) return;
    rainbowTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!pinchingRainbow || rainbowPinchPreviousDistance <= 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const currentDistance = currentRainbowPinchDistance();
    if (currentDistance <= 0) return;
    cancelRainbowAnimation();
    const previousDistance = rainbowPinchPreviousDistance;
    rainbowPinchPreviousDistance = currentDistance;
    const distanceRatioLog = Math.log(currentDistance / previousDistance);
    const amount = zoomAmountFromPinchDistances(currentDistance, previousDistance);
    const action = currentRainbowZoomAction(amount);
    if (action === "physical-observer-move") {
      queuePhysicalObserverMove(
        THREE.MathUtils.clamp(
          distanceRatioLog * 20,
          -FREE_MOVE_STEP_M * 2,
          FREE_MOVE_STEP_M * 2
        )
      );
      return;
    }
    if (action === "inspection-forward") {
      moveInspectionCamera(
        THREE.MathUtils.clamp(
          distanceRatioLog * 38,
          0,
          INSPECTION_FREE_MOVE_STEP_M
        )
      );
      return;
    }
    applyRainbowProgress(state.rainbowZoom + amount);
  },
  { capture: true, passive: false }
);

canvas.addEventListener("pointerup", (event) => endRainbowPinch(event.pointerId), {
  capture: true,
  passive: true
});
canvas.addEventListener("pointercancel", (event) => endRainbowPinch(event.pointerId), {
  capture: true,
  passive: true
});

let lastOverlapPick: {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerType: string;
  readonly candidateOffset: number;
  readonly candidateCount: number;
  readonly pickedAt: number;
} | null = null;

function updateOverlapPickButton(): void {
  const button = requireElement<HTMLButtonElement>("#next-overlap-candidate");
  const count = lastOverlapPick?.candidateCount ?? 0;
  button.disabled = count <= 1;
  button.textContent = count > 1
    ? `同じ場所の次の候補（${lastOverlapPick!.candidateOffset + 1}/${count}）`
    : "同じ場所の次の候補";
}

function resetOverlapPick(): void {
  lastOverlapPick = null;
  updateOverlapPickButton();
}

function pickRainDropAt(
  clientX: number,
  clientY: number,
  pointerType: string,
  forceNextCandidate = false
): void {
  const now = performance.now();
  const repeatsPrevious = Boolean(
    lastOverlapPick &&
    now - lastOverlapPick.pickedAt < 8_000 &&
    Math.hypot(clientX - lastOverlapPick.clientX, clientY - lastOverlapPick.clientY) <= 8
  );
  const candidateOffset = repeatsPrevious || forceNextCandidate
    ? (lastOverlapPick?.candidateOffset ?? -1) + 1
    : 0;
  const rect = canvas.getBoundingClientRect();
  camera.updateMatrixWorld();
  const startTarget = controls.target.clone();
  const startCameraPosition = camera.position.clone();
  const snapshot = rainbowJourney.pickDroplet(
    camera,
    clientX - rect.left,
    clientY - rect.top,
    rect.width,
    rect.height,
    pointerType === "touch" ? 24 : 15,
    candidateOffset,
    false
  );
  const candidateCount = rainbowJourney.getLastPickCandidateCount();
  if (!snapshot) {
    resetOverlapPick();
    setText("#zoom-status", "近くに選択できる代表雨滴がありません。全景では虹の帯を、接近後は雨滴の点を短くタップしてください。");
    return;
  }
  resetWavelengthSelectionCycle();
  const normalizedOffset = candidateCount > 0 ? candidateOffset % candidateCount : 0;
  lastOverlapPick = {
    clientX,
    clientY,
    pointerType,
    candidateOffset: normalizedOffset,
    candidateCount,
    pickedAt: now
  };
  updateOverlapPickButton();
  const candidateStatus = candidateCount > 1
    ? `この範囲には${candidateCount}滴あります。現在${normalizedOffset + 1}/${candidateCount}で、再タップまたは候補ボタンで奥の滴も順に選べます。`
    : "";
  setRainbowDropSelectionArmed(false, false);
  acceptRainDropSelection(snapshot, startTarget, startCameraPosition, candidateStatus);
}

requireElement<HTMLButtonElement>("#next-overlap-candidate").addEventListener("click", () => {
  if (!lastOverlapPick) return;
  pickRainDropAt(
    lastOverlapPick.clientX,
    lastOverlapPick.clientY,
    lastOverlapPick.pointerType,
    true
  );
});

canvas.addEventListener("pointerdown", (event) => {
  if (
    !rainbowDropSelectionArmed ||
    !event.isPrimary ||
    !isRainbowView(state.view) ||
    rainbowMode === "move" ||
    state.rainbowZoom < 0.22
  ) {
    selectionGesture.cancel();
    return;
  }
  selectionGesture.pointerDown({
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary
  });
}, { passive: true });

canvas.addEventListener("pointermove", (event) => {
  selectionGesture.pointerMove({
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary
  });
}, { passive: true });

canvas.addEventListener("pointerup", (event) => {
  const tap = selectionGesture.pointerUp({
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary
  });
  if (
    !tap ||
    !rainbowDropSelectionArmed ||
    !isRainbowView(state.view) ||
    rainbowMode === "move" ||
    state.rainbowZoom < 0.22
  ) return;
  pickRainDropAt(tap.clientX, tap.clientY, tap.pointerType);
}, { passive: true });

canvas.addEventListener("pointercancel", () => {
  selectionGesture.cancel();
}, { passive: true });

canvas.addEventListener("keydown", (event) => {
  const inspectionMoveKeys = ["KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE"];
  if (canFreelyExploreRainField() && inspectionMoveKeys.includes(event.code)) {
    const step = INSPECTION_FREE_MOVE_STEP_M;
    if (event.code === "KeyW") moveInspectionCamera(step);
    else if (event.code === "KeyS") moveInspectionCamera(-step);
    else if (event.code === "KeyA") moveInspectionCamera(0, -step);
    else if (event.code === "KeyD") moveInspectionCamera(0, step);
    else if (event.code === "KeyQ") moveInspectionCamera(0, 0, -step);
    else if (event.code === "KeyE") moveInspectionCamera(0, 0, step);
    selectionGesture.cancel();
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowLeft") rotateCamera(-0.1, 0);
  else if (event.key === "ArrowRight") rotateCamera(0.1, 0);
  else if (event.key === "ArrowUp") rotateCamera(0, -0.08);
  else if (event.key === "ArrowDown") rotateCamera(0, 0.08);
  else if (event.key === "+" || event.key === "=") setCameraDistance(0.9);
  else if (event.key === "-" || event.key === "_") setCameraDistance(1.1);
  else if (event.key === "PageUp" && isRainbowView(state.view)) {
    setCameraDistance(0.9);
  } else if (event.key === "PageDown" && isRainbowView(state.view)) {
    setCameraDistance(1.1);
  } else if (event.key === "Home" && isRainbowView(state.view)) {
    if (rainbowMode === "move") resetPhysicalObserver();
    else resetCamera();
  }
  else if (event.key === "End" && isRainbowView(state.view)) {
    if (rainbowMode === "move") movePhysicalObserver(FREE_MOVE_STEP_M);
    else animateRainbowProgress(1);
  }
  else if (event.key === "Enter" && isRainbowView(state.view)) focusCurrentParticle();
  else if (event.key === "Escape" && isRainbowView(state.view)) {
    if (rainbowMode === "move") resetPhysicalObserver();
    else resetCamera();
  }
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
    if (isRainbowView(state.view)) {
      camera.fov = rainbowCameraPose(rainbowZoomFrame(state.rainbowZoom)).fov;
    }
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
  if (pendingConditionTimer) window.clearTimeout(pendingConditionTimer);
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
cancelRainbowAnimation();
rainbowJourney.setObserverView(true);
eyeViewTracksSun = true;
resetEyeLookDirection();
renderControlVisibility();
updateRainbowModeUi();
applyRainbowProgress(0);
requestRender();
