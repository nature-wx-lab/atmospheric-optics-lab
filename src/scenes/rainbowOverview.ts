import * as THREE from "three";
import {
  DEFAULT_RAIN_FIELD_OPTIONS,
  generateRainField,
  observeRainDroplet,
  type RainDropletObservation,
  type RainFieldDroplet
} from "../physics/rainField";
import {
  SPECTRAL_SAMPLES,
  findStationaryRay,
  rainbowAngleRange,
  radians,
  traceDropletRay,
  type RainbowOrder
} from "../physics/rainbow";
import { buildRainbowRadianceProfile } from "../physics/rainbowRadiance";
import {
  OBSERVER_OPTICAL_ORIGIN,
  RAIN_FIELD_METERS_TO_SCENE_UNITS,
  type RainbowZoomFrame
} from "../physics/semanticZoom";

const SKY_RADIUS = 14.5;

function createSoftPointTexture(size = 32): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center) / radius;
      const alpha = distance >= 1
        ? 0
        : Math.round(255 * Math.pow(1 - distance * distance, 2.4));
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function defaultOpticalOrigin(): THREE.Vector3 {
  return new THREE.Vector3(
    OBSERVER_OPTICAL_ORIGIN.x,
    OBSERVER_OPTICAL_ORIGIN.y,
    OBSERVER_OPTICAL_ORIGIN.z
  );
}

function perpendicularBasis(axis: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const helper = Math.abs(axis.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const first = new THREE.Vector3().crossVectors(axis, helper).normalize();
  const second = new THREE.Vector3().crossVectors(axis, first).normalize();
  return [first, second];
}

function directionOnCone(
  axis: THREE.Vector3,
  first: THREE.Vector3,
  second: THREE.Vector3,
  radius: number,
  phase: number
): THREE.Vector3 {
  return axis
    .clone()
    .multiplyScalar(Math.cos(radius))
    .add(first.clone().multiplyScalar(Math.sin(radius) * Math.cos(phase)))
    .add(second.clone().multiplyScalar(Math.sin(radius) * Math.sin(phase)))
    .normalize();
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothUnit(value: number): number {
  const unit = clamp01(value);
  return unit * unit * (3 - 2 * unit);
}

function disposeGroup(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      const drawable = object as THREE.Mesh;
      if (drawable.geometry) geometries.add(drawable.geometry);
      if (Array.isArray(drawable.material)) {
        drawable.material.forEach((material) => materials.add(material));
      } else if (drawable.material) {
        materials.add(drawable.material);
      }
    });
  }
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function addTubeSegment(
  parent: THREE.Object3D,
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: THREE.ColorRepresentation,
  radius: number,
  opacity: number,
  name: string
): THREE.Mesh | null {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 1e-8) return null;
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 8, 1, true),
    material
  );
  mesh.position.copy(start).lerp(end, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize()
  );
  mesh.name = name;
  mesh.renderOrder = 18;
  parent.add(mesh);
  return mesh;
}

function addTubeArrow(
  parent: THREE.Object3D,
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: THREE.ColorRepresentation,
  radius: number,
  opacity: number,
  name: string
): void {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < 1e-8) return;
  const unit = direction.clone().normalize();
  const headLength = Math.min(length * 0.18, Math.max(radius * 7, 0.18));
  const shaftEnd = end.clone().addScaledVector(unit, -headLength * 0.75);
  addTubeSegment(parent, start, shaftEnd, color, radius, opacity, `${name}-shaft`);
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 3.1, headLength, 12),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false
    })
  );
  head.position.copy(end).addScaledVector(unit, -headLength * 0.5);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), unit);
  head.name = `${name}-arrowhead`;
  head.renderOrder = 19;
  parent.add(head);
}

export interface RainbowOverviewSelection {
  readonly id: string;
  readonly index: number;
  readonly position: THREE.Vector3;
  readonly physicalPositionM: THREE.Vector3;
  readonly diameterMm: number;
  readonly observation: RainDropletObservation;
}

export interface RainbowOverviewSnapshot {
  readonly totalDroplets: number;
  readonly visibleDroplets: number;
  readonly contributingDroplets: number;
  readonly selected: RainbowOverviewSelection;
  readonly observerPositionM: THREE.Vector3;
  readonly observerScenePosition: THREE.Vector3;
  readonly representativePaths: readonly RainbowRepresentativePath[];
}

export interface RainbowRepresentativePath {
  readonly order: RainbowOrder;
  readonly dropletId: string;
  readonly dropletIndex: number;
  readonly wavelengthNm: number;
  readonly apparentRadiusDeg: number;
  readonly dropletPosition: THREE.Vector3;
  readonly observerPosition: THREE.Vector3;
}

interface PickCandidate {
  readonly index: number;
  readonly distancePx: number;
  readonly depth: number;
}

export class RainbowOverview {
  readonly group = new THREE.Group();
  private readonly fixed = new THREE.Group();
  private readonly optical = new THREE.Group();
  private readonly observerFrame = new THREE.Group();
  private readonly droplets: readonly RainFieldDroplet[];
  private readonly scenePositions: Float32Array;
  private readonly sightlineDirections: Float32Array;
  private readonly contributorMask: Uint8Array;
  private readonly contributorObservations = new Map<number, RainDropletObservation>();
  private readonly rainGeometry = new THREE.BufferGeometry();
  private readonly softPointTexture = createSoftPointTexture();
  private readonly baseOpacities = new WeakMap<THREE.Material, number>();
  private readonly baseTransparency = new WeakMap<THREE.Material, boolean>();
  private readonly baseDepthWrite = new WeakMap<THREE.Material, boolean>();
  private skyMaterial: THREE.MeshBasicMaterial | null = null;
  private readonly rainbowRadianceMaterials: THREE.ShaderMaterial[] = [];
  private rainMaterial: THREE.PointsMaterial | null = null;
  private contributorCoreMaterial: THREE.PointsMaterial | null = null;
  private contributorGlowMaterial: THREE.PointsMaterial | null = null;
  private contributorIndices: readonly number[] = [];
  private selectedIndex = -1;
  private representativePaths: readonly RainbowRepresentativePath[] = [];
  private visibleCount = 0;
  private order: RainbowOrder = 1;
  private sunElevation = 12;
  private sunAzimuth = 225;
  private density = 0.7;
  private journeyOpacity = 1;
  private skyOpacity = 1;
  private radianceOpacity = 1;
  private resolvedFieldOpacity = 0;
  private resolvedContributorOpacity = 0;
  private observerView = true;
  private lastPickCandidateCount = 0;
  private readonly observerPositionM = new THREE.Vector3(
    DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM.x,
    DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM.y,
    DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM.z
  );

  constructor() {
    this.group.name = "rainbow-overview";
    this.fixed.name = "fixed-rain-field-and-observer";
    this.optical.name = "observer-dependent-rainbow-contributors";
    this.group.add(this.fixed, this.optical);
    this.observerFrame.name = "physical-observer-frame";
    this.fixed.add(this.observerFrame);
    this.droplets = generateRainField();
    this.scenePositions = new Float32Array(this.droplets.length * 3);
    this.sightlineDirections = new Float32Array(this.droplets.length * 3);
    this.contributorMask = new Uint8Array(this.droplets.length);
    this.buildScenePositions();
    this.visibleCount = Math.round(this.droplets.length * this.density);
    this.addObserver();
    this.addObserverSkyDome();
    this.addHorizon();
    this.addFixedRainField();
    this.reclassify();
  }

  setConditions(order: RainbowOrder, sunElevation: number, sunAzimuth: number): void {
    const changed =
      order !== this.order || sunElevation !== this.sunElevation || sunAzimuth !== this.sunAzimuth;
    this.order = order;
    this.sunElevation = sunElevation;
    this.sunAzimuth = sunAzimuth;
    if (changed) this.reclassify();
  }

  setObserverPositionM(positionM: THREE.Vector3): void {
    if (
      !Number.isFinite(positionM.x) ||
      !Number.isFinite(positionM.y) ||
      !Number.isFinite(positionM.z)
    ) {
      throw new RangeError("observer position must be finite");
    }
    if (this.observerPositionM.distanceToSquared(positionM) < 1e-12) return;
    this.observerPositionM.copy(positionM);
    this.updateSightlineDirections();
    this.observerFrame.position.copy(this.opticalOrigin()).sub(defaultOpticalOrigin());
    this.reclassify();
  }

  getObserverPositionM(): THREE.Vector3 {
    return this.observerPositionM.clone();
  }

  getObserverScenePosition(): THREE.Vector3 {
    return this.opticalOrigin();
  }

  setDensity(density: number): void {
    const nextDensity = THREE.MathUtils.clamp(density, 0.15, 1);
    const nextVisibleCount = Math.round(this.droplets.length * nextDensity);
    if (nextVisibleCount === this.visibleCount) return;
    this.density = nextDensity;
    this.visibleCount = nextVisibleCount;
    this.rainGeometry.setDrawRange(0, this.visibleCount);
    this.rebuildOpticalVisuals();
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setObserverView(observerView: boolean): void {
    this.observerView = observerView;
    this.applyViewPresentation();
    this.applyJourneyOpacity();
  }

  setJourneyOpacity(opacity: number): void {
    this.journeyOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
    this.applyViewPresentation();
    this.applyJourneyOpacity();
    this.group.visible = this.journeyOpacity > 0.001;
  }

  setSemanticFrame(frame: RainbowZoomFrame): void {
    this.skyOpacity = frame.skyOpacity;
    this.radianceOpacity = frame.radianceOpacity;
    this.resolvedFieldOpacity = frame.resolvedFieldOpacity;
    this.resolvedContributorOpacity = frame.resolvedContributorOpacity;
    this.applyViewPresentation();
    this.applyJourneyOpacity();
  }

  getSnapshot(): RainbowOverviewSnapshot {
    return {
      totalDroplets: this.droplets.length,
      visibleDroplets: this.visibleCount,
      contributingDroplets: this.visibleContributorIndices().length,
      selected: this.getSelected(),
      observerPositionM: this.getObserverPositionM(),
      observerScenePosition: this.getObserverScenePosition(),
      representativePaths: this.representativePaths.map((path) => ({
        ...path,
        dropletPosition: path.dropletPosition.clone(),
        observerPosition: path.observerPosition.clone()
      }))
    };
  }

  getSelected(): RainbowOverviewSelection {
    this.ensureSelection();
    const droplet = this.droplets[this.selectedIndex];
    if (!droplet) throw new Error("selected rain droplet is unavailable");
    const observation = this.observationForIndex(this.selectedIndex);
    return {
      id: droplet.id,
      index: droplet.index,
      position: this.scenePosition(this.selectedIndex),
      physicalPositionM: new THREE.Vector3(
        droplet.positionM.x,
        droplet.positionM.y,
        droplet.positionM.z
      ),
      diameterMm: droplet.diameterMm,
      observation
    };
  }

  selectByIndex(index: number): RainbowOverviewSelection | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.droplets.length) return null;
    this.selectedIndex = index;
    return this.getSelected();
  }

  selectById(id: string): RainbowOverviewSelection | null {
    const match = /^drop-(\d{6})$/.exec(id.trim());
    if (!match) return null;
    const index = Number(match[1]);
    const droplet = this.droplets[index];
    return droplet?.id === id.trim() ? this.selectByIndex(index) : null;
  }

  selectAdjacentContributor(direction: -1 | 1): RainbowOverviewSelection | null {
    const contributors = this.visibleContributorIndices();
    if (contributors.length === 0) return null;
    const current = contributors.indexOf(this.selectedIndex);
    const next = current < 0
      ? direction > 0 ? 0 : contributors.length - 1
      : (current + direction + contributors.length) % contributors.length;
    const index = contributors[next];
    return index === undefined ? null : this.selectByIndex(index);
  }

  selectContributorNearestWavelength(
    targetWavelengthNm: number,
    candidateOffset = 0
  ): RainbowOverviewSelection | null {
    if (!Number.isFinite(targetWavelengthNm) || targetWavelengthNm < 380 || targetWavelengthNm > 780) {
      return null;
    }
    const candidates = this.visibleContributorIndices()
      .map((index) => ({ index, observation: this.contributorObservations.get(index) }))
      .filter(
        (candidate): candidate is { index: number; observation: RainDropletObservation } =>
          candidate.observation?.contributes === true &&
          candidate.observation.dominantWavelengthNm !== null
      )
      .sort((first, second) =>
        Math.abs(first.observation.dominantWavelengthNm! - targetWavelengthNm) -
          Math.abs(second.observation.dominantWavelengthNm! - targetWavelengthNm) ||
        Math.abs(first.observation.distanceFromObserverM - 180) -
          Math.abs(second.observation.distanceFromObserverM - 180) ||
        first.index - second.index
      );
    if (candidates.length === 0) return null;
    const offset =
      ((Math.trunc(candidateOffset) % candidates.length) + candidates.length) % candidates.length;
    const selected = candidates[offset];
    return selected ? this.selectByIndex(selected.index) : null;
  }

  pickDroplet(
    camera: THREE.Camera,
    pointerX: number,
    pointerY: number,
    viewportWidth: number,
    viewportHeight: number,
    maximumDistancePx: number,
    candidateOffset = 0,
    preferContributors = false
  ): RainbowOverviewSelection | null {
    if (!(viewportWidth > 0) || !(viewportHeight > 0) || !(maximumDistancePx > 0)) return null;
    const projected = new THREE.Vector3();
    const candidates: PickCandidate[] = [];
    for (let index = 0; index < this.visibleCount; index += 1) {
      const offset = index * 3;
      projected
        .set(
          this.scenePositions[offset] ?? 0,
          this.scenePositions[offset + 1] ?? 0,
          this.scenePositions[offset + 2] ?? 0
        )
        .project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const screenX = (projected.x * 0.5 + 0.5) * viewportWidth;
      const screenY = (-projected.y * 0.5 + 0.5) * viewportHeight;
      const distancePx = Math.hypot(screenX - pointerX, screenY - pointerY);
      if (distancePx > maximumDistancePx) continue;
      candidates.push({ index, distancePx, depth: projected.z });
    }
    candidates.sort((first, second) =>
      first.distancePx - second.distancePx || first.depth - second.depth || first.index - second.index
    );
    const preferred = preferContributors
      ? candidates.filter((candidate) => this.contributorMask[candidate.index] === 1)
      : [];
    const rankedCandidates = preferred.length > 0 ? preferred : candidates;
    this.lastPickCandidateCount = rankedCandidates.length;
    const normalizedOffset = rankedCandidates.length === 0
      ? 0
      : ((Math.trunc(candidateOffset) % rankedCandidates.length) + rankedCandidates.length) %
        rankedCandidates.length;
    const picked = rankedCandidates[normalizedOffset] ?? null;
    return picked ? this.selectByIndex(picked.index) : null;
  }

  getLastPickCandidateCount(): number {
    return this.lastPickCandidateCount;
  }

  dispose(): void {
    disposeGroup(this.group);
    this.softPointTexture.dispose();
  }

  private sunDirection(): THREE.Vector3 {
    const elevation = radians(this.sunElevation);
    const azimuth = radians(this.sunAzimuth);
    return new THREE.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth)
    ).normalize();
  }

  private opticalOrigin(): THREE.Vector3 {
    const initial = DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM;
    return defaultOpticalOrigin().add(
      new THREE.Vector3(
        this.observerPositionM.x - initial.x,
        this.observerPositionM.y - initial.y,
        this.observerPositionM.z - initial.z
      ).multiplyScalar(RAIN_FIELD_METERS_TO_SCENE_UNITS)
    );
  }

  private buildScenePositions(): void {
    const observerM = DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM;
    const origin = defaultOpticalOrigin();
    for (const droplet of this.droplets) {
      const offset = droplet.index * 3;
      this.scenePositions[offset] =
        origin.x + (droplet.positionM.x - observerM.x) * RAIN_FIELD_METERS_TO_SCENE_UNITS;
      this.scenePositions[offset + 1] =
        origin.y + (droplet.positionM.y - observerM.y) * RAIN_FIELD_METERS_TO_SCENE_UNITS;
      this.scenePositions[offset + 2] =
        origin.z + (droplet.positionM.z - observerM.z) * RAIN_FIELD_METERS_TO_SCENE_UNITS;
    }
    this.updateSightlineDirections();
  }

  private updateSightlineDirections(): void {
    for (const droplet of this.droplets) {
      const offset = droplet.index * 3;
      const direction = new THREE.Vector3(
        droplet.positionM.x - this.observerPositionM.x,
        droplet.positionM.y - this.observerPositionM.y,
        droplet.positionM.z - this.observerPositionM.z
      );
      if (direction.lengthSq() < 1e-12) direction.set(0, 1, 0);
      else direction.normalize();
      this.sightlineDirections[offset] = direction.x;
      this.sightlineDirections[offset + 1] = direction.y;
      this.sightlineDirections[offset + 2] = direction.z;
    }
  }

  private scenePosition(index: number): THREE.Vector3 {
    const offset = index * 3;
    return new THREE.Vector3(
      this.scenePositions[offset] ?? 0,
      this.scenePositions[offset + 1] ?? 0,
      this.scenePositions[offset + 2] ?? 0
    );
  }

  private addObserver(): void {
    const observer = new THREE.Group();
    observer.name = "observer";
    const bodyMaterial = new THREE.MeshBasicMaterial({ color: 0xeafcfd });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), bodyMaterial);
    head.position.y = 0.74;
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.92, 20), bodyMaterial);
    body.position.y = 0.18;
    observer.add(head, body);

    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x61d6da })
    );
    eye.position.set(
      OBSERVER_OPTICAL_ORIGIN.x,
      OBSERVER_OPTICAL_ORIGIN.y,
      OBSERVER_OPTICAL_ORIGIN.z
    );
    eye.name = "observer-optical-origin";
    observer.add(eye);
    this.observerFrame.add(observer);
  }

  private addHorizon(): void {
    const origin = defaultOpticalOrigin();
    const points: THREE.Vector3[] = [];
    for (let step = 0; step <= 160; step += 1) {
      const angle = (step / 160) * Math.PI * 2;
      points.push(
        origin.clone().add(
          new THREE.Vector3(Math.cos(angle) * SKY_RADIUS, 0, Math.sin(angle) * SKY_RADIUS)
        )
      );
    }
    const horizon = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x33474f, transparent: true, opacity: 0.55 })
    );
    horizon.name = "observer-celestial-horizon";
    this.observerFrame.add(horizon);
  }

  private addObserverSkyDome(): void {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS * 4.5, 64, 36);
    const position = geometry.getAttribute("position");
    const colors = new Float32Array(position.count * 3);
    const direction = new THREE.Vector3();
    const lower = new THREE.Color(0x071116);
    const horizon = new THREE.Color(0x70858d);
    const zenith = new THREE.Color(0x244b66);
    const color = new THREE.Color();
    for (let index = 0; index < position.count; index += 1) {
      direction.fromBufferAttribute(position, index).normalize();
      if (direction.y >= 0) {
        const blend = Math.pow(clamp01(direction.y), 0.58);
        color.lerpColors(horizon, zenith, blend);
      } else {
        const blend = Math.pow(clamp01(-direction.y), 0.38);
        color.lerpColors(horizon, lower, blend);
      }
      const offset = index * 3;
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.skyMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false
    });
    const sky = new THREE.Mesh(geometry, this.skyMaterial);
    sky.name = "observer-sky-radiance-background";
    sky.position.copy(defaultOpticalOrigin());
    sky.renderOrder = -100;
    this.observerFrame.add(sky);
  }

  private addFixedRainField(): void {
    this.rainGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.scenePositions, 3)
    );
    this.rainGeometry.setDrawRange(0, this.visibleCount);
    this.rainMaterial = new THREE.PointsMaterial({
      color: 0x5a747d,
      size: 1.2,
      sizeAttenuation: false,
      map: this.softPointTexture,
      transparent: true,
      opacity: 0.022,
      alphaTest: 0.004,
      depthWrite: false,
      fog: false
    });
    const particles = new THREE.Points(this.rainGeometry, this.rainMaterial);
    particles.name = "fixed-rain-field-60000-selectable-droplets";
    this.fixed.add(particles);
    this.applyViewPresentation();
  }

  private reclassify(): void {
    const sun = this.sunDirection();
    const antisolarX = -sun.x;
    const antisolarY = -sun.y;
    const antisolarZ = -sun.z;
    const range = rainbowAngleRange(this.order);
    const minimumDot = Math.cos(radians(range.maximumDeg));
    const maximumDot = Math.cos(radians(range.minimumDeg));
    const contributors: number[] = [];
    this.contributorMask.fill(0);
    this.contributorObservations.clear();
    for (let index = 0; index < this.droplets.length; index += 1) {
      const offset = index * 3;
      const dot =
        (this.sightlineDirections[offset] ?? 0) * antisolarX +
        (this.sightlineDirections[offset + 1] ?? 0) * antisolarY +
        (this.sightlineDirections[offset + 2] ?? 0) * antisolarZ;
      if (dot < minimumDot || dot > maximumDot) continue;
      const observation = this.observationForIndex(index, sun);
      if (!observation.contributes) continue;
      contributors.push(index);
      this.contributorMask[index] = 1;
      this.contributorObservations.set(index, observation);
    }
    this.contributorIndices = contributors;
    this.rebuildOpticalVisuals();
  }

  private observationForIndex(index: number, sun = this.sunDirection()): RainDropletObservation {
    const cached = this.contributorObservations.get(index);
    if (cached) return cached;
    const droplet = this.droplets[index];
    if (!droplet) throw new Error("rain droplet is unavailable");
    return observeRainDroplet(
      droplet,
      {
        x: this.observerPositionM.x,
        y: this.observerPositionM.y,
        z: this.observerPositionM.z
      },
      { x: sun.x, y: sun.y, z: sun.z },
      this.order
    );
  }

  private visibleContributorIndices(): readonly number[] {
    return this.contributorIndices.filter((index) => index < this.visibleCount);
  }

  private ensureSelection(): void {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.droplets.length) return;
    const contributors = this.visibleContributorIndices();
    if (contributors.length === 0) {
      this.selectedIndex = 0;
      return;
    }
    const origin = this.opticalOrigin();
    let bestIndex = contributors[0] ?? 0;
    let bestScore = -Infinity;
    for (const index of contributors) {
      const observation = this.contributorObservations.get(index);
      if (!observation?.contributes || observation.dominantWavelengthNm === null) continue;
      const position = this.scenePosition(index);
      const directionY = position.clone().sub(origin).normalize().y;
      const score =
        directionY * 4 -
        Math.abs(observation.dominantWavelengthNm - 530) / 120 -
        Math.abs(observation.distanceFromObserverM - 180) / 500;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    this.selectedIndex = bestIndex;
  }

  private rebuildOpticalVisuals(): void {
    disposeGroup(this.optical);
    this.rainbowRadianceMaterials.length = 0;
    this.representativePaths = [];
    const sun = this.sunDirection();
    const antisolar = sun.clone().negate();
    const [first, second] = perpendicularBasis(antisolar);
    this.addSun(sun);
    this.addAntisolarAxis(sun, antisolar);
    this.addCalculatedBandGuides(antisolar, first, second);
    this.addConeGuides(antisolar, first, second);
    this.addRainbowConeSurfaces(antisolar, first, second);
    this.addIntegratedRainbowRadiance(antisolar, first, second, 1, 1);
    this.addIntegratedRainbowRadiance(antisolar, first, second, 2, 0.46);
    this.addAlexandersDarkBand(antisolar, first, second);
    this.addContributorGlints();
    this.addSampleContributorSightlines();
    this.addRepresentativePhysicalPaths(sun, antisolar, first, second);
    this.ensureSelection();
    this.applyViewPresentation();
    this.applyJourneyOpacity();
  }

  private applyViewPresentation(): void {
    const skyBaseOpacity = this.observerView ? this.skyOpacity : 0;
    if (this.skyMaterial) {
      this.skyMaterial.opacity = skyBaseOpacity * this.journeyOpacity;
      this.baseOpacities.set(this.skyMaterial, skyBaseOpacity);
    }
    const sky = this.fixed.getObjectByName("observer-sky-radiance-background");
    if (sky) sky.visible = this.observerView && this.skyOpacity > 0.001;

    for (const material of this.rainbowRadianceMaterials) {
      const uniform = material.uniforms.uOpacity;
      if (uniform) {
        uniform.value =
          (this.observerView ? this.radianceOpacity : 0) * this.journeyOpacity;
      }
    }
    for (const order of [1, 2] as const) {
      const radiance = this.optical.getObjectByName(
        `continuous-relative-radiance-order-${order}-from-unresolved-rain-field`
      );
      if (radiance) {
        radiance.visible = this.observerView && this.radianceOpacity > 0.001;
      }
    }

    const rainOpacity = this.observerView
      ? (0.022 + 0.058 * this.resolvedFieldOpacity) * this.resolvedFieldOpacity
      : 0.1;
    if (this.rainMaterial) {
      this.rainMaterial.size = this.observerView
        ? 1.2 + 1.5 * this.resolvedFieldOpacity
        : 1.1;
      this.rainMaterial.sizeAttenuation = false;
      this.rainMaterial.fog = !this.observerView;
      this.rainMaterial.opacity = rainOpacity * this.journeyOpacity;
      this.rainMaterial.needsUpdate = true;
      this.baseOpacities.set(this.rainMaterial, rainOpacity);
    }
    const rain = this.fixed.getObjectByName(
      "fixed-rain-field-60000-selectable-droplets"
    );
    if (rain) {
      rain.visible = !this.observerView || this.resolvedFieldOpacity > 0.001;
    }

    const coreOpacity = this.observerView
      ? 0.56 * this.resolvedContributorOpacity
      : 0.98;
    if (this.contributorCoreMaterial) {
      this.contributorCoreMaterial.size = this.observerView
        ? 1.5 + 0.9 * this.resolvedContributorOpacity
        : 2.7;
      this.contributorCoreMaterial.sizeAttenuation = false;
      this.contributorCoreMaterial.opacity = coreOpacity * this.journeyOpacity;
      this.contributorCoreMaterial.needsUpdate = true;
      this.baseOpacities.set(this.contributorCoreMaterial, coreOpacity);
    }
    const contributorCore = this.optical.getObjectByName(
      "rainbow-made-only-from-contributing-real-droplet-ids"
    );
    if (contributorCore) {
      contributorCore.visible =
        !this.observerView || this.resolvedContributorOpacity > 0.001;
    }

    const glowOpacity = this.observerView
      ? 0.1 * this.resolvedContributorOpacity
      : 0.26;
    if (this.contributorGlowMaterial) {
      this.contributorGlowMaterial.size = this.observerView ? 3.6 : 7.5;
      this.contributorGlowMaterial.sizeAttenuation = false;
      this.contributorGlowMaterial.opacity = glowOpacity * this.journeyOpacity;
      this.contributorGlowMaterial.needsUpdate = true;
      this.baseOpacities.set(this.contributorGlowMaterial, glowOpacity);
    }
    const contributorGlow = this.optical.getObjectByName(
      "rainbow-glow-made-only-from-contributing-real-droplet-ids"
    );
    if (contributorGlow) {
      contributorGlow.visible =
        !this.observerView || this.resolvedContributorOpacity > 0.001;
    }

    const observer = this.fixed.getObjectByName("observer");
    if (observer) observer.visible = !this.observerView;
    const horizon = this.fixed.getObjectByName("observer-celestial-horizon");
    if (horizon) horizon.visible = !this.observerView;
    this.optical.traverse((object) => {
      if (
        object.name === "sun-disc-and-glow" ||
        object.name === "sun-direction-ray" ||
        object.name === "sun-to-eye-to-antisolar-axis" ||
        object.name.startsWith("calculated-rainbow-band-boundary-") ||
        object.name === "observer-centred-cone-direction-guide" ||
        object.name.startsWith("observer-centred-rainbow-cone-surface-") ||
        object.name === "sample-eye-to-contributing-droplet-directions" ||
        object.name.startsWith("representative-physical-ray-paths-order-")
      ) {
        object.visible = !this.observerView;
      }
    });
  }

  private applyJourneyOpacity(): void {
    this.group.traverse((object) => {
      const drawable = object as THREE.Mesh;
      const materials = Array.isArray(drawable.material)
        ? drawable.material
        : drawable.material
          ? [drawable.material]
          : [];
      for (const material of materials) {
        if (!this.baseOpacities.has(material)) {
          this.baseOpacities.set(material, material.opacity);
          this.baseTransparency.set(material, material.transparent);
          this.baseDepthWrite.set(material, material.depthWrite);
        }
        material.opacity = (this.baseOpacities.get(material) ?? 1) * this.journeyOpacity;
        const transparent =
          (this.baseTransparency.get(material) ?? false) || this.journeyOpacity < 0.999;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.needsUpdate = true;
        }
        material.depthWrite =
          (this.baseDepthWrite.get(material) ?? true) && this.journeyOpacity >= 0.999;
      }
    });
  }

  private addSun(sun: THREE.Vector3): void {
    const sunGroup = new THREE.Group();
    sunGroup.name = "sun-disc-and-glow";
    const origin = this.opticalOrigin();
    sunGroup.position.copy(origin).addScaledVector(sun, SKY_RADIUS);
    sunGroup.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.52, 28, 18),
        new THREE.MeshBasicMaterial({ color: 0xffd968 })
      ),
      new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 24, 14),
        new THREE.MeshBasicMaterial({ color: 0xffbd43, transparent: true, opacity: 0.12 })
      )
    );
    this.optical.add(sunGroup);

    const sunRay = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        origin.clone().addScaledVector(sun, SKY_RADIUS - 0.8),
        origin.clone().addScaledVector(sun, 1.2)
      ]),
      new THREE.LineDashedMaterial({
        color: 0xffd968,
        dashSize: 0.35,
        gapSize: 0.22,
        opacity: 0.6,
        transparent: true
      })
    );
    sunRay.computeLineDistances();
    sunRay.name = "sun-direction-ray";
    this.optical.add(sunRay);
  }

  private addAntisolarAxis(sun: THREE.Vector3, antisolar: THREE.Vector3): void {
    const origin = this.opticalOrigin();
    const axis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        origin.clone().addScaledVector(sun, SKY_RADIUS),
        origin,
        origin.clone().addScaledVector(antisolar, SKY_RADIUS)
      ]),
      new THREE.LineDashedMaterial({
        color: 0x8ea5ab,
        dashSize: 0.28,
        gapSize: 0.2,
        transparent: true,
        opacity: 0.34
      })
    );
    axis.computeLineDistances();
    axis.name = "sun-to-eye-to-antisolar-axis";
    this.optical.add(axis);
  }

  private addCalculatedBandGuides(
    antisolar: THREE.Vector3,
    first: THREE.Vector3,
    second: THREE.Vector3
  ): void {
    for (const order of [1, 2] as const) {
      const radii = SPECTRAL_SAMPLES.map((sample) =>
        radians(findStationaryRay(sample.waterIndex, order).radiusDeg)
      );
      const boundaries = [Math.min(...radii), Math.max(...radii)];
      for (const [boundaryIndex, radius] of boundaries.entries()) {
        const points: THREE.Vector3[] = [];
        for (let step = 0; step < 256; step += 1) {
          const phase = (step / 256) * Math.PI * 2;
          points.push(
            this.opticalOrigin().addScaledVector(
              directionOnCone(antisolar, first, second, radius, phase),
              SKY_RADIUS
            )
          );
        }
        const guide = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineDashedMaterial({
            color: order === this.order ? 0xb4c6ca : 0x7f9298,
            dashSize: 0.16,
            gapSize: 0.14,
            transparent: true,
            opacity: order === this.order ? 0.24 : 0.12
          })
        );
        guide.computeLineDistances();
        guide.name = `calculated-rainbow-band-boundary-order-${order}-${boundaryIndex + 1}-not-a-physical-ring`;
        this.optical.add(guide);
      }
    }
  }

  private addConeGuides(
    antisolar: THREE.Vector3,
    first: THREE.Vector3,
    second: THREE.Vector3
  ): void {
    const middle = SPECTRAL_SAMPLES[3];
    if (!middle) return;
    for (const order of [1, 2] as const) {
      const radius = radians(findStationaryRay(middle.waterIndex, order).radiusDeg);
      for (let step = 0; step < 10; step += 1) {
        const direction = directionOnCone(
          antisolar,
          first,
          second,
          radius,
          (step / 10) * Math.PI * 2
        );
        const guide = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            this.opticalOrigin(),
            this.opticalOrigin().addScaledVector(direction, SKY_RADIUS)
          ]),
          new THREE.LineBasicMaterial({
            color: order === this.order ? 0xa9bdc2 : 0x778d93,
            transparent: true,
            opacity: order === this.order ? 0.13 : 0.065
          })
        );
        guide.name = "observer-centred-cone-direction-guide";
        this.optical.add(guide);
      }
    }
  }

  private addRainbowConeSurfaces(
    antisolar: THREE.Vector3,
    first: THREE.Vector3,
    second: THREE.Vector3
  ): void {
    const edgeSamples = [SPECTRAL_SAMPLES[0], SPECTRAL_SAMPLES.at(-1)].filter(
      (sample): sample is (typeof SPECTRAL_SAMPLES)[number] => sample !== undefined
    );
    const origin = this.opticalOrigin();
    const length = SKY_RADIUS * 0.92;
    for (const order of [1, 2] as const) {
      for (const sample of edgeSamples) {
        const angle = radians(findStationaryRay(sample.waterIndex, order).radiusDeg);
        const positions: THREE.Vector3[] = [origin.clone()];
        const indices: number[] = [];
        for (let step = 0; step <= 128; step += 1) {
          const phase = (step / 128) * Math.PI * 2;
          positions.push(
            origin.clone().addScaledVector(
              directionOnCone(antisolar, first, second, angle, phase),
              length
            )
          );
          if (step > 0) indices.push(0, step, step + 1);
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(positions);
        geometry.setIndex(indices);
        const surface = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: sample.color,
            transparent: true,
            opacity: order === this.order ? 0.022 : 0.009,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            fog: false
          })
        );
        surface.name = `observer-centred-rainbow-cone-surface-order-${order}-${sample.wavelengthNm}-nm`;
        surface.renderOrder = 1;
        this.optical.add(surface);
      }
    }
  }

  private addIntegratedRainbowRadiance(
    antisolar: THREE.Vector3,
    first: THREE.Vector3,
    second: THREE.Vector3,
    order: RainbowOrder,
    opacityScale: number
  ): void {
    const profile = buildRainbowRadianceProfile(order, 144);
    const radialCount = profile.samples.length;
    const phaseSegments = 360;
    const vertexCount = (phaseSegments + 1) * radialCount;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const alphas = new Float32Array(vertexCount);
    const indices: number[] = [];
    const origin = this.opticalOrigin();

    for (let phaseIndex = 0; phaseIndex <= phaseSegments; phaseIndex += 1) {
      const phase = (phaseIndex / phaseSegments) * Math.PI * 2;
      const continuity =
        0.97 +
        0.018 * Math.sin(phase * 3 + 0.7) +
        0.012 * Math.sin(phase * 7 - 1.1);
      for (let radialIndex = 0; radialIndex < radialCount; radialIndex += 1) {
        const sample = profile.samples[radialIndex];
        if (!sample) continue;
        const direction = directionOnCone(
          antisolar,
          first,
          second,
          radians(sample.radiusDeg),
          phase
        );
        const vertexIndex = phaseIndex * radialCount + radialIndex;
        const offset = vertexIndex * 3;
        positions[offset] = origin.x + direction.x * SKY_RADIUS;
        positions[offset + 1] = origin.y + direction.y * SKY_RADIUS;
        positions[offset + 2] = origin.z + direction.z * SKY_RADIUS;
        colors[offset] = sample.r;
        colors[offset + 1] = sample.g;
        colors[offset + 2] = sample.b;
        const horizonVisibility = smoothUnit((direction.y + 0.012) / 0.04);
        alphas[vertexIndex] = sample.alpha * horizonVisibility * continuity;
      }
    }

    for (let phaseIndex = 0; phaseIndex < phaseSegments; phaseIndex += 1) {
      for (let radialIndex = 0; radialIndex < radialCount - 1; radialIndex += 1) {
        const topLeft = phaseIndex * radialCount + radialIndex;
        const topRight = topLeft + 1;
        const bottomLeft = (phaseIndex + 1) * radialCount + radialIndex;
        const bottomRight = bottomLeft + 1;
        indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("radianceAlpha", new THREE.BufferAttribute(alphas, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: this.observerView ? this.radianceOpacity : 0 },
        uOpacityScale: { value: opacityScale }
      },
      vertexShader: `
        attribute float radianceAlpha;
        varying vec3 vRadianceColor;
        varying float vRadianceAlpha;

        void main() {
          vRadianceColor = color;
          vRadianceAlpha = radianceAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        uniform float uOpacityScale;
        varying vec3 vRadianceColor;
        varying float vRadianceAlpha;

        void main() {
          float alpha = clamp(vRadianceAlpha * uOpacity * uOpacityScale, 0.0, 1.0);
          if (alpha <= 0.001) discard;
          gl_FragColor = vec4(vRadianceColor, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      fog: false,
      toneMapped: true
    });
    this.rainbowRadianceMaterials.push(material);
    const bow = new THREE.Mesh(geometry, material);
    bow.name = `continuous-relative-radiance-order-${order}-from-unresolved-rain-field`;
    bow.renderOrder = order === 1 ? 4 : 3;
    this.optical.add(bow);
  }

  private addAlexandersDarkBand(
    antisolar: THREE.Vector3,
    first: THREE.Vector3,
    second: THREE.Vector3
  ): void {
    const primary = rainbowAngleRange(1);
    const secondary = rainbowAngleRange(2);
    const innerRadius = radians(primary.maximumDeg);
    const outerRadius = radians(secondary.minimumDeg);
    const phaseSegments = 256;
    const radialSegments = 18;
    const radius = SKY_RADIUS - 0.04;
    const positions: number[] = [];
    const indices: number[] = [];
    const origin = this.opticalOrigin();

    for (let phaseIndex = 0; phaseIndex <= phaseSegments; phaseIndex += 1) {
      const phase = (phaseIndex / phaseSegments) * Math.PI * 2;
      for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
        const blend = radialIndex / radialSegments;
        const angularRadius = THREE.MathUtils.lerp(innerRadius, outerRadius, blend);
        const direction = directionOnCone(
          antisolar,
          first,
          second,
          angularRadius,
          phase
        );
        positions.push(
          origin.x + direction.x * radius,
          origin.y + direction.y * radius,
          origin.z + direction.z * radius
        );
      }
    }
    const row = radialSegments + 1;
    for (let phaseIndex = 0; phaseIndex < phaseSegments; phaseIndex += 1) {
      for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
        const topLeft = phaseIndex * row + radialIndex;
        const topRight = topLeft + 1;
        const bottomLeft = (phaseIndex + 1) * row + radialIndex;
        const bottomRight = bottomLeft + 1;
        indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const band = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x00080c,
        transparent: true,
        opacity: 0.16,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false
      })
    );
    band.name = "alexanders-dark-band-between-primary-and-secondary-cones";
    band.renderOrder = 2;
    this.optical.add(band);
  }

  private representativeContributor(
    order: RainbowOrder,
    targetWavelengthNm: number,
    targetPhase: number,
    first: THREE.Vector3,
    second: THREE.Vector3,
    excludedIndices: ReadonlySet<number>
  ): { index: number; observation: RainDropletObservation } | null {
    const sun = this.sunDirection();
    let best: { index: number; observation: RainDropletObservation; score: number } | null = null;
    for (let index = 0; index < this.visibleCount; index += 1) {
      if (excludedIndices.has(index)) continue;
      const observation = order === this.order
        ? this.contributorObservations.get(index) ?? this.observationForIndex(index, sun)
        : this.observationForIndexAtOrder(index, order, sun);
      if (!observation.contributes || observation.dominantWavelengthNm === null) continue;
      const direction = this.scenePosition(index).sub(this.opticalOrigin()).normalize();
      const phase = Math.atan2(direction.dot(second), direction.dot(first));
      const phaseError = Math.abs(Math.atan2(
        Math.sin(phase - targetPhase),
        Math.cos(phase - targetPhase)
      ));
      const score =
        Math.abs(observation.dominantWavelengthNm - targetWavelengthNm) / 36 +
        phaseError * 1.6 +
        Math.abs(observation.distanceFromObserverM - 175) / 260;
      if (!best || score < best.score) best = { index, observation, score };
    }
    return best ? { index: best.index, observation: best.observation } : null;
  }

  private observationForIndexAtOrder(
    index: number,
    order: RainbowOrder,
    sun = this.sunDirection()
  ): RainDropletObservation {
    const droplet = this.droplets[index];
    if (!droplet) throw new Error("rain droplet is unavailable");
    return observeRainDroplet(
      droplet,
      {
        x: this.observerPositionM.x,
        y: this.observerPositionM.y,
        z: this.observerPositionM.z
      },
      { x: sun.x, y: sun.y, z: sun.z },
      order
    );
  }

  private addRepresentativePhysicalPaths(
    sun: THREE.Vector3,
    _antisolar: THREE.Vector3,
    first: THREE.Vector3,
    second: THREE.Vector3
  ): void {
    const targetPhase = Math.atan2(second.y, first.y);
    const usedIndices = new Set<number>();
    const observer = this.opticalOrigin();
    const paths: RainbowRepresentativePath[] = [];
    const edgeSamples = [SPECTRAL_SAMPLES[0], SPECTRAL_SAMPLES.at(-1)].filter(
      (sample): sample is (typeof SPECTRAL_SAMPLES)[number] => sample !== undefined
    );

    for (const order of [1, 2] as const) {
      const orderGroup = new THREE.Group();
      orderGroup.name = `representative-physical-ray-paths-order-${order}`;
      const emphasized = order === this.order;
      for (const sample of edgeSamples) {
        const representative = this.representativeContributor(
          order,
          sample.wavelengthNm,
          targetPhase,
          first,
          second,
          usedIndices
        );
        if (!representative) continue;
        usedIndices.add(representative.index);
        const dropletPosition = this.scenePosition(representative.index);
        const trace = traceDropletRay(
          representative.observation.refractiveIndex ?? sample.waterIndex,
          order
        );
        const propagation = sun.clone().negate().normalize();
        const outgoingToObserver = observer.clone().sub(dropletPosition).normalize();
        let worldY = outgoingToObserver
          .clone()
          .addScaledVector(propagation, -outgoingToObserver.dot(propagation));
        if (worldY.lengthSq() < 1e-12) worldY.copy(first);
        worldY.normalize().multiplyScalar(Math.sign(trace.outgoing.y) || 1);
        const worldZ = new THREE.Vector3().crossVectors(propagation, worldY).normalize();
        const basis = new THREE.Matrix4().makeBasis(propagation, worldY, worldZ);
        const displayRadius = emphasized ? 0.38 : 0.29;
        const opacity = emphasized ? 0.94 : 0.46;
        const transformPoint = (point: { x: number; y: number }): THREE.Vector3 =>
          new THREE.Vector3(point.x, point.y, 0)
            .multiplyScalar(displayRadius)
            .applyMatrix4(basis)
            .add(dropletPosition);
        const entryPoint = trace.points[1];
        const exitPoint = trace.points[trace.points.length - 2];
        if (!entryPoint || !exitPoint) continue;

        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(displayRadius, 28, 18),
          new THREE.MeshPhysicalMaterial({
            color: 0x8fd8ee,
            transmission: 0.72,
            transparent: true,
            opacity: emphasized ? 0.34 : 0.2,
            roughness: 0.08,
            ior: 1.333,
            thickness: 0.5,
            depthWrite: false
          })
        );
        sphere.position.copy(dropletPosition);
        sphere.name = `actual-rain-field-drop-${representative.index}-order-${order}-${sample.label}`;
        orderGroup.add(sphere);

        const incomingEnd = transformPoint(entryPoint);
        const incomingStart = incomingEnd.clone().addScaledVector(sun, emphasized ? 4.8 : 3.6);
        addTubeArrow(
          orderGroup,
          incomingStart,
          incomingEnd,
          0xfffcf2,
          emphasized ? 0.034 : 0.022,
          opacity,
          "white-sunlight-before-water-boundary"
        );

        const internalPoints = trace.points
          .slice(1, -1)
          .map((point) => transformPoint(point));
        const internal = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(internalPoints),
          new THREE.LineBasicMaterial({
            color: sample.color,
            transparent: true,
            opacity,
            depthTest: false,
            depthWrite: false
          })
        );
        internal.name = `snell-refraction-and-${order}-internal-reflection-${sample.wavelengthNm}-nm`;
        internal.renderOrder = 20;
        orderGroup.add(internal);
        for (let segment = 0; segment < internalPoints.length - 1; segment += 1) {
          const start = internalPoints[segment];
          const end = internalPoints[segment + 1];
          if (!start || !end) continue;
          addTubeSegment(
            orderGroup,
            start,
            end,
            sample.color,
            emphasized ? 0.026 : 0.017,
            opacity,
            `internal-colored-path-${sample.wavelengthNm}-nm-${segment + 1}`
          );
        }

        const outgoingStart = transformPoint(exitPoint);
        const outgoingDirection = observer.clone().sub(outgoingStart);
        addTubeArrow(
          orderGroup,
          outgoingStart,
          observer,
          sample.color,
          emphasized ? 0.042 : 0.026,
          opacity,
          `colored-ray-${sample.wavelengthNm}-nm-from-drop-to-observer-eye`
        );

        const sightline = dropletPosition.clone().sub(observer).normalize();
        const arcAxis = new THREE.Vector3().crossVectors(sun.clone().negate(), sightline);
        if (arcAxis.lengthSq() > 1e-10) {
          arcAxis.normalize();
          const angle = radians(representative.observation.apparentRadiusDeg);
          const arcPoints: THREE.Vector3[] = [];
          for (let step = 0; step <= 40; step += 1) {
            arcPoints.push(
              sun.clone().negate().applyAxisAngle(arcAxis, angle * step / 40)
                .multiplyScalar(emphasized ? 1.3 : 1.05)
                .add(observer)
            );
          }
          const arc = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(arcPoints),
            new THREE.LineBasicMaterial({
              color: sample.color,
              transparent: true,
              opacity: emphasized ? 0.72 : 0.3,
              depthTest: false,
              depthWrite: false
            })
          );
          arc.name = `observer-angle-${representative.observation.apparentRadiusDeg.toFixed(3)}-deg-order-${order}`;
          orderGroup.add(arc);
        }

        const droplet = this.droplets[representative.index];
        if (!droplet) continue;
        paths.push({
          order,
          dropletId: droplet.id,
          dropletIndex: representative.index,
          wavelengthNm: representative.observation.dominantWavelengthNm ?? sample.wavelengthNm,
          apparentRadiusDeg: representative.observation.apparentRadiusDeg,
          dropletPosition: dropletPosition.clone(),
          observerPosition: observer.clone()
        });
      }
      this.optical.add(orderGroup);
    }
    this.representativePaths = paths;
  }

  private addContributorGlints(): void {
    const contributors = this.visibleContributorIndices();
    const positions = new Float32Array(contributors.length * 3);
    const colors = new Float32Array(contributors.length * 3);
    contributors.forEach((dropletIndex, contributorIndex) => {
      const sourceOffset = dropletIndex * 3;
      const targetOffset = contributorIndex * 3;
      positions[targetOffset] = this.scenePositions[sourceOffset] ?? 0;
      positions[targetOffset + 1] = this.scenePositions[sourceOffset + 1] ?? 0;
      positions[targetOffset + 2] = this.scenePositions[sourceOffset + 2] ?? 0;
      const observation = this.contributorObservations.get(dropletIndex);
      const lower = observation ? SPECTRAL_SAMPLES[observation.lowerSampleIndex] : undefined;
      const upper = observation ? SPECTRAL_SAMPLES[observation.upperSampleIndex] : undefined;
      const color = new THREE.Color(lower?.color ?? "#ffffff").lerp(
        new THREE.Color(upper?.color ?? lower?.color ?? "#ffffff"),
        observation?.colorMix ?? 0
      );
      colors[targetOffset] = color.r;
      colors[targetOffset + 1] = color.g;
      colors[targetOffset + 2] = color.b;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.contributorGlowMaterial = new THREE.PointsMaterial({
      size: 4.8,
      sizeAttenuation: false,
      vertexColors: true,
      map: this.softPointTexture,
      transparent: true,
      opacity: 0,
      alphaTest: 0.004,
      depthTest: false,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending
    });
    this.contributorCoreMaterial = new THREE.PointsMaterial({
      size: 1.9,
      sizeAttenuation: false,
      vertexColors: true,
      map: this.softPointTexture,
      transparent: true,
      opacity: 0,
      alphaTest: 0.025,
      depthTest: false,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending
    });
    const glow = new THREE.Points(geometry, this.contributorGlowMaterial);
    glow.name = "rainbow-glow-made-only-from-contributing-real-droplet-ids";
    glow.renderOrder = 8;
    const core = new THREE.Points(geometry, this.contributorCoreMaterial);
    core.name = "rainbow-made-only-from-contributing-real-droplet-ids";
    core.renderOrder = 9;
    this.optical.add(glow, core);
  }

  private addSampleContributorSightlines(): void {
    const contributors = this.visibleContributorIndices();
    const points: THREE.Vector3[] = [];
    const colors: number[] = [];
    const maximumLines = 48;
    const stride = Math.max(1, Math.floor(contributors.length / maximumLines));
    for (let position = 0; position < contributors.length && points.length < maximumLines * 2; position += stride) {
      const index = contributors[position];
      if (index === undefined) continue;
      points.push(this.opticalOrigin(), this.scenePosition(index));
      const observation = this.contributorObservations.get(index);
      const lower = observation ? SPECTRAL_SAMPLES[observation.lowerSampleIndex] : undefined;
      const upper = observation ? SPECTRAL_SAMPLES[observation.upperSampleIndex] : undefined;
      const color = new THREE.Color(lower?.color ?? "#ffffff").lerp(
        new THREE.Color(upper?.color ?? lower?.color ?? "#ffffff"),
        observation?.colorMix ?? 0
      );
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const sightlines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.2 })
    );
    sightlines.name = "sample-eye-to-contributing-droplet-directions";
    this.optical.add(sightlines);
  }
}
