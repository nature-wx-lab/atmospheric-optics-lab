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
  type RainbowOrder
} from "../physics/rainbow";
import { OBSERVER_OPTICAL_ORIGIN } from "../physics/semanticZoom";

const SKY_RADIUS = 14.5;
const METERS_TO_SCENE_UNITS = 0.046;

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

function opticalOrigin(): THREE.Vector3 {
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
  private rainMaterial: THREE.PointsMaterial | null = null;
  private contributorCoreMaterial: THREE.PointsMaterial | null = null;
  private contributorGlowMaterial: THREE.PointsMaterial | null = null;
  private contributorIndices: readonly number[] = [];
  private selectedIndex = -1;
  private visibleCount = 0;
  private order: RainbowOrder = 1;
  private sunElevation = 12;
  private sunAzimuth = 225;
  private density = 0.7;
  private journeyOpacity = 1;
  private observerView = true;
  private lastPickCandidateCount = 0;

  constructor() {
    this.group.name = "rainbow-overview";
    this.fixed.name = "fixed-rain-field-and-observer";
    this.optical.name = "observer-dependent-rainbow-contributors";
    this.group.add(this.fixed, this.optical);
    this.droplets = generateRainField();
    this.scenePositions = new Float32Array(this.droplets.length * 3);
    this.sightlineDirections = new Float32Array(this.droplets.length * 3);
    this.contributorMask = new Uint8Array(this.droplets.length);
    this.buildScenePositions();
    this.visibleCount = Math.round(this.droplets.length * this.density);
    this.addObserver();
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
  }

  setJourneyOpacity(opacity: number): void {
    this.journeyOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
    this.applyJourneyOpacity();
    this.group.visible = this.journeyOpacity > 0.001;
  }

  getSnapshot(): RainbowOverviewSnapshot {
    return {
      totalDroplets: this.droplets.length,
      visibleDroplets: this.visibleCount,
      contributingDroplets: this.visibleContributorIndices().length,
      selected: this.getSelected()
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

  private buildScenePositions(): void {
    const observerM = DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM;
    const origin = opticalOrigin();
    for (const droplet of this.droplets) {
      const offset = droplet.index * 3;
      this.scenePositions[offset] =
        origin.x + (droplet.positionM.x - observerM.x) * METERS_TO_SCENE_UNITS;
      this.scenePositions[offset + 1] =
        origin.y + (droplet.positionM.y - observerM.y) * METERS_TO_SCENE_UNITS;
      this.scenePositions[offset + 2] =
        origin.z + (droplet.positionM.z - observerM.z) * METERS_TO_SCENE_UNITS;
      const direction = new THREE.Vector3(
        droplet.positionM.x - observerM.x,
        droplet.positionM.y - observerM.y,
        droplet.positionM.z - observerM.z
      ).normalize();
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
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), bodyMaterial);
    head.position.y = 0.63;
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.72, 18), bodyMaterial);
    body.position.y = 0.2;
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
    this.fixed.add(observer);
  }

  private addHorizon(): void {
    const origin = opticalOrigin();
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
    this.fixed.add(horizon);
  }

  private addFixedRainField(): void {
    this.rainGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.scenePositions, 3)
    );
    this.rainGeometry.setDrawRange(0, this.visibleCount);
    this.rainMaterial = new THREE.PointsMaterial({
      color: 0x70868d,
      size: 1.05,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.09,
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
      DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM,
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
    const origin = opticalOrigin();
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
    const sun = this.sunDirection();
    const antisolar = sun.clone().negate();
    const [first, second] = perpendicularBasis(antisolar);
    this.addSun(sun);
    this.addAntisolarAxis(sun, antisolar);
    this.addCalculatedBandGuides(antisolar, first, second);
    this.addConeGuides(antisolar, first, second);
    this.addContributorGlints();
    this.addSampleContributorSightlines();
    this.ensureSelection();
    this.applyViewPresentation();
    this.applyJourneyOpacity();
  }

  private applyViewPresentation(): void {
    const rainOpacity = this.observerView ? 0.09 : 0.25;
    if (this.rainMaterial) {
      this.rainMaterial.size = this.observerView ? 1.05 : 0.068;
      this.rainMaterial.sizeAttenuation = !this.observerView;
      this.rainMaterial.fog = !this.observerView;
      this.rainMaterial.opacity = rainOpacity * this.journeyOpacity;
      this.rainMaterial.needsUpdate = true;
      this.baseOpacities.set(this.rainMaterial, rainOpacity);
    }

    const coreOpacity = 0.98;
    if (this.contributorCoreMaterial) {
      this.contributorCoreMaterial.size = this.observerView ? 3.8 : 2.7;
      this.contributorCoreMaterial.sizeAttenuation = false;
      this.contributorCoreMaterial.opacity = coreOpacity * this.journeyOpacity;
      this.contributorCoreMaterial.needsUpdate = true;
      this.baseOpacities.set(this.contributorCoreMaterial, coreOpacity);
    }

    const glowOpacity = this.observerView ? 0.42 : 0.26;
    if (this.contributorGlowMaterial) {
      this.contributorGlowMaterial.size = this.observerView ? 11.5 : 7.5;
      this.contributorGlowMaterial.sizeAttenuation = false;
      this.contributorGlowMaterial.opacity = glowOpacity * this.journeyOpacity;
      this.contributorGlowMaterial.needsUpdate = true;
      this.baseOpacities.set(this.contributorGlowMaterial, glowOpacity);
    }

    const observer = this.fixed.getObjectByName("observer");
    if (observer) observer.visible = !this.observerView;
    this.optical.traverse((object) => {
      if (
        object.name === "sun-disc-and-glow" ||
        object.name === "sun-direction-ray" ||
        object.name === "sun-to-eye-to-antisolar-axis" ||
        object.name.startsWith("calculated-rainbow-band-boundary-") ||
        object.name === "observer-centred-cone-direction-guide" ||
        object.name === "sample-eye-to-contributing-droplet-directions"
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
    const origin = opticalOrigin();
    sunGroup.position.copy(origin).addScaledVector(sun, SKY_RADIUS);
    sunGroup.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0xffd968 })
      ),
      new THREE.Mesh(
        new THREE.SphereGeometry(0.52, 20, 12),
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
    const origin = opticalOrigin();
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
    const radii = SPECTRAL_SAMPLES.map((sample) =>
      radians(findStationaryRay(sample.waterIndex, this.order).radiusDeg)
    );
    const boundaries = [Math.min(...radii), Math.max(...radii)];
    for (const [boundaryIndex, radius] of boundaries.entries()) {
      const points: THREE.Vector3[] = [];
      for (let step = 0; step < 256; step += 1) {
        const phase = (step / 256) * Math.PI * 2;
        points.push(
          opticalOrigin().addScaledVector(
            directionOnCone(antisolar, first, second, radius, phase),
            SKY_RADIUS
          )
        );
      }
      const guide = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineDashedMaterial({
          color: 0x9cb0b6,
          dashSize: 0.16,
          gapSize: 0.14,
          transparent: true,
          opacity: 0.16
        })
      );
      guide.computeLineDistances();
      guide.name = `calculated-rainbow-band-boundary-${boundaryIndex + 1}-not-a-physical-ring`;
      this.optical.add(guide);
    }
  }

  private addConeGuides(
    antisolar: THREE.Vector3,
    first: THREE.Vector3,
    second: THREE.Vector3
  ): void {
    const middle = SPECTRAL_SAMPLES[3];
    if (!middle) return;
    const radius = radians(findStationaryRay(middle.waterIndex, this.order).radiusDeg);
    for (let step = 0; step < 12; step += 1) {
      const direction = directionOnCone(
        antisolar,
        first,
        second,
        radius,
        (step / 12) * Math.PI * 2
      );
      const guide = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          opticalOrigin(),
          opticalOrigin().addScaledVector(direction, SKY_RADIUS)
        ]),
        new THREE.LineBasicMaterial({ color: 0x8ea5ab, transparent: true, opacity: 0.07 })
      );
      guide.name = "observer-centred-cone-direction-guide";
      this.optical.add(guide);
    }
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
      size: 11.5,
      sizeAttenuation: false,
      vertexColors: true,
      map: this.softPointTexture,
      transparent: true,
      opacity: 0.42,
      alphaTest: 0.004,
      depthTest: false,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending
    });
    this.contributorCoreMaterial = new THREE.PointsMaterial({
      size: 3.8,
      sizeAttenuation: false,
      vertexColors: true,
      map: this.softPointTexture,
      transparent: true,
      opacity: 0.98,
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
    const maximumLines = 30;
    const stride = Math.max(1, Math.floor(contributors.length / maximumLines));
    for (let position = 0; position < contributors.length && points.length < maximumLines * 2; position += stride) {
      const index = contributors[position];
      if (index === undefined) continue;
      points.push(opticalOrigin(), this.scenePosition(index));
    }
    const sightlines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x72dce4, transparent: true, opacity: 0.055 })
    );
    sightlines.name = "sample-eye-to-contributing-droplet-directions";
    this.optical.add(sightlines);
  }
}
