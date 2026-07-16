import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "./styles.css";
import {
  SPECTRAL_SAMPLES,
  findStationaryRay,
  rainbowAngleRange,
  type RainbowOrder
} from "./physics/rainbow";
import { DropletDetail } from "./scenes/dropletDetail";
import { RainbowOverview } from "./scenes/rainbowOverview";

type ViewName = "overview" | "droplet";

interface AppState {
  view: ViewName;
  order: RainbowOrder;
  sunElevation: number;
  sunAzimuth: number;
  particleDensity: number;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`required element not found: ${selector}`);
  return element;
}

function normalizedDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

const state: AppState = {
  view: "overview",
  order: 1,
  sunElevation: 12,
  sunAzimuth: 225,
  particleDensity: 0.7
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
controls.enableDamping = true;
controls.dampingFactor = 0.07;
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
const droplet = new DropletDetail();
scene.add(overview.group, droplet.group);

function setCameraDistance(multiplier: number): void {
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
  } else {
    camera.position.set(0.8, 0.7, 12.8);
    controls.target.set(0, 0, 0);
    controls.minDistance = 4.7;
    controls.maxDistance = 28;
  }
  controls.update();
  updateCameraReadout();
}

function setView(view: ViewName): void {
  state.view = view;
  overview.setVisible(view === "overview");
  droplet.setVisible(view === "droplet");
  document.querySelectorAll<HTMLButtonElement>(".mode-tab[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const title = requireElement<HTMLElement>("#scene-title");
  const kicker = requireElement<HTMLElement>("#scene-kicker");
  const scale = requireElement<HTMLElement>("#scale-readout");
  const viewState = requireElement<HTMLElement>("#view-state");
  if (view === "overview") {
    kicker.textContent = "RAIN FIELD → RAINBOW";
    title.textContent = "無数の水滴がつくる「見える角度」";
    scale.textContent = "雨域：数百m";
    viewState.textContent = "観察者を中心にした虹の円錐";
  } else {
    kicker.textContent = "ONE DROPLET → LIGHT PATH";
    title.textContent = "1粒の中で、光はどう曲がる？";
    scale.textContent = "代表水滴：数mm";
    viewState.textContent = `屈折 → ${state.order}回の部分反射 → 屈折`;
  }
  resetCamera();
  updateExplanation();
}

function updateConditions(): void {
  overview.setConditions(state.order, state.sunElevation, state.sunAzimuth);
  overview.setDensity(state.particleDensity);
  droplet.setOrder(state.order);
  updateExplanation();
}

function updateExplanation(): void {
  const range = rainbowAngleRange(state.order);
  const isPrimary = state.order === 1;
  requireElement<HTMLElement>("#angle-label").textContent = `${isPrimary ? "一次" : "二次"}虹の角半径`;
  requireElement<HTMLElement>("#angle-value").textContent =
    `${range.minimumDeg.toFixed(1)}°–${range.maximumDeg.toFixed(1)}°`;
  requireElement<HTMLElement>("#red-angle-value").textContent = `${range.redDeg.toFixed(1)}°`;
  requireElement<HTMLElement>("#violet-angle-value").textContent = `${range.violetDeg.toFixed(1)}°`;
  requireElement<HTMLElement>("#reflection-value").textContent = `${state.order}回`;
  requireElement<HTMLElement>("#reflection-note").textContent = isPrimary
    ? "水滴内で1回の部分反射。赤が外側、紫が内側。"
    : "水滴内で2回の部分反射。色順が逆になり、赤が内側。";
  requireElement<HTMLElement>("#angle-context").textContent = isPrimary
    ? "反太陽点を中心に、赤が外側・紫が内側。"
    : "反太陽点を中心に一次虹より外側。赤が内側・紫が外側。";

  const explanationTitle = requireElement<HTMLElement>("#explanation-title");
  const explanationBody = requireElement<HTMLElement>("#explanation-body");
  if (state.view === "overview") {
    explanationTitle.textContent = "虹は空に貼り付いた物体ではない";
    explanationBody.textContent =
      "観察者から見て反太陽方向へ特定の角度で光を返す水滴だけが、虹の一部として見えます。観察者が動けば、条件を満たす水滴の集合も変わります。";
  } else {
    const middle = SPECTRAL_SAMPLES[3];
    const ray = middle ? findStationaryRay(middle.waterIndex, state.order) : null;
    explanationTitle.textContent = `${state.order}回反射する代表光路`;
    explanationBody.textContent = ray
      ? `緑 ${middle?.wavelengthNm ?? 530} nmでは、入射角${ray.incidenceDeg.toFixed(1)}°、水中の屈折角${ray.refractionDeg.toFixed(1)}°付近で光が集中します。内部反射は全反射ではなく部分反射です。`
      : "代表波長の光路を計算できませんでした。";
  }
}

function updateCameraReadout(): void {
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  const azimuth = normalizedDegrees(THREE.MathUtils.radToDeg(spherical.theta));
  const elevation = 90 - THREE.MathUtils.radToDeg(spherical.phi);
  requireElement<HTMLElement>("#camera-readout").textContent =
    `方位 ${azimuth.toFixed(0)}° / 仰角 ${elevation.toFixed(0)}° / 距離 ${spherical.radius.toFixed(1)}`;
}

document.querySelectorAll<HTMLButtonElement>(".mode-tab[data-view]").forEach((button) => {
  if (button.disabled) return;
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (view === "overview" || view === "droplet") setView(view);
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
    updateConditions();
    requireElement<HTMLElement>("#view-state").textContent =
      state.view === "overview"
        ? "観察者を中心にした虹の円錐"
        : `屈折 → ${state.order}回の部分反射 → 屈折`;
  });
});

const sunElevationInput = requireElement<HTMLInputElement>("#sun-elevation");
sunElevationInput.addEventListener("input", () => {
  state.sunElevation = Number(sunElevationInput.value);
  requireElement<HTMLOutputElement>("#sun-elevation-value").value = `${state.sunElevation}°`;
  updateConditions();
});

const sunAzimuthInput = requireElement<HTMLInputElement>("#sun-azimuth");
sunAzimuthInput.addEventListener("input", () => {
  state.sunAzimuth = Number(sunAzimuthInput.value);
  requireElement<HTMLOutputElement>("#sun-azimuth-value").value = `${state.sunAzimuth}°`;
  updateConditions();
});

const densityInput = requireElement<HTMLInputElement>("#particle-density");
densityInput.addEventListener("input", () => {
  state.particleDensity = Number(densityInput.value) / 100;
  requireElement<HTMLOutputElement>("#particle-density-value").value = densityInput.value + "%";
  overview.setDensity(state.particleDensity);
});

requireElement<HTMLButtonElement>("#reset-view").addEventListener("click", resetCamera);
requireElement<HTMLButtonElement>("#focus-particle").addEventListener("click", () => setView("droplet"));
requireElement<HTMLButtonElement>("#zoom-in").addEventListener("click", () => setCameraDistance(0.8));
requireElement<HTMLButtonElement>("#zoom-out").addEventListener("click", () => setCameraDistance(1.25));
controls.addEventListener("change", updateCameraReadout);

const resizeObserver = new ResizeObserver(() => {
  if (!renderer) return;
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});
resizeObserver.observe(stage);

let animationFrame = 0;
function render(): void {
  animationFrame = requestAnimationFrame(render);
  controls.update();
  renderer?.render(scene, camera);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(animationFrame);
  } else {
    render();
  }
});

window.addEventListener("beforeunload", () => {
  resizeObserver.disconnect();
  cancelAnimationFrame(animationFrame);
  controls.dispose();
  overview.dispose();
  droplet.dispose();
  renderer?.dispose();
});

requireElement<HTMLElement>("#fps-state").textContent = renderer ? "WebGL 2 / 代表7波長" : "数値表示のみ";
updateConditions();
updateCameraReadout();
render();
