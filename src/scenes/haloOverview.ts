import * as THREE from "three";
import {
  HALO_SPECTRAL_SAMPLES,
  haloAngleRange,
  haloPhenomenonById,
  haloVisibleAtSunElevation,
  prismMinimumDeviationDeg,
  projectedSundogOffsetDeg,
  referenceAngleRangeForPhenomenon,
  type CrystalOrientation,
  type HaloAngleRange,
  type HaloPhenomenon,
  type HaloPhenomenonId,
  type HaloRingId
} from "../physics/halo";
import { radians } from "../physics/rainbow";

const SKY_RADIUS = 14.5;
const CRYSTAL_CAPACITY = 320;

export interface HaloSceneSnapshot {
  readonly phenomenon: HaloPhenomenon;
  readonly sunElevationDeg: number;
  readonly sunAzimuthDeg: number;
  readonly visibleAtCurrentSun: boolean;
  readonly referenceMinimumDeviation: HaloAngleRange;
  readonly referenceAngleNoticeJa: string;
  readonly representativeRayGuideNoticeJa: string;
  readonly availabilityNoticeJa: string;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let output = value;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function disposeGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
      else mesh.material?.dispose();
    });
  }
}

function directionAtOffset(
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

function spectralOpacity(available: boolean): number {
  return available ? 0.88 : 0.16;
}

export class HaloOverview {
  readonly group = new THREE.Group();
  private readonly skyDynamic = new THREE.Group();
  private readonly crystalDynamic = new THREE.Group();
  private phenomenonId: HaloPhenomenonId = "halo-22";
  private sunElevation = 18;
  private sunAzimuth = 225;
  private density = 0.68;
  private crystalField: THREE.InstancedMesh | null = null;

  constructor() {
    this.group.name = "halo-overview";
    this.group.visible = false;
    this.skyDynamic.name = "halo-overview-sky-dynamic";
    this.crystalDynamic.name = "halo-overview-crystal-dynamic";
    this.group.add(this.skyDynamic, this.crystalDynamic);
    this.addObserver();
    this.addHorizon();
    this.rebuild();
  }

  setConditions(
    phenomenonId: HaloPhenomenonId,
    sunElevationDeg: number,
    sunAzimuthDeg: number
  ): void {
    haloPhenomenonById(phenomenonId);
    if (!(sunElevationDeg >= 0 && sunElevationDeg <= 90)) {
      throw new RangeError("sun elevation must be between 0 and 90 degrees");
    }
    const normalizedAzimuth = ((sunAzimuthDeg % 360) + 360) % 360;
    const phenomenonChanged = phenomenonId !== this.phenomenonId;
    const sunChanged =
      sunElevationDeg !== this.sunElevation || normalizedAzimuth !== this.sunAzimuth;
    this.phenomenonId = phenomenonId;
    this.sunElevation = sunElevationDeg;
    this.sunAzimuth = normalizedAzimuth;
    if (phenomenonChanged) this.rebuild();
    else if (sunChanged) this.rebuildSky();
  }

  setDensity(density: number): void {
    this.density = THREE.MathUtils.clamp(density, 0.15, 1);
    if (this.crystalField) {
      this.crystalField.count = Math.round(CRYSTAL_CAPACITY * this.density);
      this.crystalField.instanceMatrix.needsUpdate = true;
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  getSnapshot(): HaloSceneSnapshot {
    const visibleAtCurrentSun = haloVisibleAtSunElevation(this.phenomenonId, this.sunElevation);
    return {
      phenomenon: haloPhenomenonById(this.phenomenonId),
      sunElevationDeg: this.sunElevation,
      sunAzimuthDeg: this.sunAzimuth,
      visibleAtCurrentSun,
      referenceMinimumDeviation: referenceAngleRangeForPhenomenon(this.phenomenonId),
      referenceAngleNoticeJa:
        "この角度は60°または90°氷プリズムの基準最小偏角で、模式アーク自体の角半径ではありません。",
      representativeRayGuideNoticeJa:
        "氷晶内の黄色い経路は光路模式。屈折点・入射角・射出角は未計算です。",
      availabilityNoticeJa: visibleAtCurrentSun
        ? "現在の太陽高度は、この現象の代表的な出現条件内です。"
        : "現在の太陽高度は出現条件外です。形を薄く残して比較しています。"
    };
  }

  dispose(): void {
    disposeGroup(this.group);
    this.crystalField = null;
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

  private skyBasis(): {
    readonly sun: THREE.Vector3;
    readonly right: THREE.Vector3;
    readonly up: THREE.Vector3;
  } {
    const elevation = radians(this.sunElevation);
    const azimuth = radians(this.sunAzimuth);
    return {
      sun: this.sunDirection(),
      right: new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)).normalize(),
      up: new THREE.Vector3(
        -Math.sin(elevation) * Math.sin(azimuth),
        Math.cos(elevation),
        -Math.sin(elevation) * Math.cos(azimuth)
      ).normalize()
    };
  }

  private addObserver(): void {
    const observer = new THREE.Group();
    observer.name = "halo-observer";
    const material = new THREE.MeshBasicMaterial({ color: 0xeafcfd });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), material);
    head.position.y = 0.63;
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.72, 18), material);
    body.position.y = 0.2;
    observer.add(head, body);
    this.group.add(observer);
  }

  private addHorizon(): void {
    const points: THREE.Vector3[] = [];
    for (let step = 0; step <= 160; step += 1) {
      const angle = (step / 160) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * SKY_RADIUS, 0, Math.sin(angle) * SKY_RADIUS));
    }
    const horizon = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x33474f, transparent: true, opacity: 0.55 })
    );
    horizon.name = "halo-horizon";
    this.group.add(horizon);
  }

  private rebuild(): void {
    this.rebuildSky();
    this.rebuildCrystals();
  }

  private rebuildSky(): void {
    disposeGroup(this.skyDynamic);
    const phenomenon = haloPhenomenonById(this.phenomenonId);
    const available = haloVisibleAtSunElevation(this.phenomenonId, this.sunElevation);
    const basis = this.skyBasis();
    this.addSun(basis.sun);
    this.addSunAxis(basis.sun);
    this.addPhenomenon(phenomenon, basis, available);
  }

  private rebuildCrystals(): void {
    disposeGroup(this.crystalDynamic);
    this.crystalField = null;
    const phenomenon = haloPhenomenonById(this.phenomenonId);
    this.addCrystalField(phenomenon.orientation, phenomenon.crystalHabit);
    this.addRepresentativeCrystal(phenomenon);
  }

  private addSun(sun: THREE.Vector3): void {
    const sunGroup = new THREE.Group();
    sunGroup.position.copy(sun).multiplyScalar(SKY_RADIUS);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd968 })
    );
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 20, 12),
      new THREE.MeshBasicMaterial({ color: 0xffbd43, transparent: true, opacity: 0.12 })
    );
    sunGroup.add(orb, glow);
    this.skyDynamic.add(sunGroup);
  }

  private addSunAxis(sun: THREE.Vector3): void {
    const axis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        sun.clone().multiplyScalar(SKY_RADIUS)
      ]),
      new THREE.LineDashedMaterial({
        color: 0xffd968,
        dashSize: 0.28,
        gapSize: 0.2,
        transparent: true,
        opacity: 0.36
      })
    );
    axis.computeLineDistances();
    axis.name = "observer-to-sun-axis";
    this.skyDynamic.add(axis);
  }

  private addPhenomenon(
    phenomenon: HaloPhenomenon,
    basis: { readonly sun: THREE.Vector3; readonly right: THREE.Vector3; readonly up: THREE.Vector3 },
    available: boolean
  ): void {
    switch (phenomenon.displayShape) {
      case "ring":
        this.addComputedRing(phenomenon.id as HaloRingId, basis, available);
        break;
      case "paired-patches":
        this.addSundogs(basis, available);
        break;
      case "zenith-arc":
        this.addCircumzenithalArc(available);
        break;
      case "tangent-arc":
        this.addUpperTangentArc(basis, available);
        break;
      case "horizon-arc":
        this.addCircumhorizontalArc(available);
        break;
    }
  }

  private addComputedRing(
    ringId: HaloRingId,
    basis: { readonly sun: THREE.Vector3; readonly right: THREE.Vector3; readonly up: THREE.Vector3 },
    available: boolean
  ): void {
    const prismApexDeg = ringId === "halo-22" ? 60 : 90;
    for (const sample of HALO_SPECTRAL_SAMPLES) {
      const radius = radians(prismMinimumDeviationDeg(sample.iceIndex, prismApexDeg));
      const points: THREE.Vector3[] = [];
      for (let step = 0; step < 256; step += 1) {
        const phase = (step / 256) * Math.PI * 2;
        points.push(
          directionAtOffset(basis.sun, basis.right, basis.up, radius, phase).multiplyScalar(SKY_RADIUS)
        );
      }
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: sample.color,
          transparent: true,
          opacity: spectralOpacity(available)
        })
      );
      ring.name = `${ringId}-${sample.wavelengthNm}nm-computed`;
      this.skyDynamic.add(ring);
    }
  }

  private addSundogs(
    basis: { readonly sun: THREE.Vector3; readonly right: THREE.Vector3; readonly up: THREE.Vector3 },
    available: boolean
  ): void {
    for (const sample of HALO_SPECTRAL_SAMPLES) {
      const offset = projectedSundogOffsetDeg(sample.iceIndex, this.sunElevation);
      if (offset === null) continue;
      for (const side of [-1, 1] as const) {
        const points: THREE.Vector3[] = [];
        for (let step = 0; step <= 32; step += 1) {
          const localPhase = THREE.MathUtils.lerp(-0.075, 0.075, step / 32);
          const phase = side > 0 ? localPhase : Math.PI + localPhase;
          const radius = radians(offset + Math.abs(localPhase) * 9);
          points.push(
            directionAtOffset(basis.sun, basis.right, basis.up, radius, phase).multiplyScalar(SKY_RADIUS)
          );
        }
        const patch = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({
            color: sample.color,
            transparent: true,
            opacity: spectralOpacity(available)
          })
        );
        patch.name = `sundog-${side > 0 ? "right" : "left"}-${sample.wavelengthNm}nm-projected`;
        this.skyDynamic.add(patch);
      }
    }
  }

  private addCircumzenithalArc(available: boolean): void {
    const zenith = new THREE.Vector3(0, 1, 0);
    const towardSun = new THREE.Vector3(
      Math.sin(radians(this.sunAzimuth)),
      0,
      Math.cos(radians(this.sunAzimuth))
    ).normalize();
    const transverse = new THREE.Vector3().crossVectors(zenith, towardSun).normalize();
    const schematicRadius = radians(THREE.MathUtils.clamp(this.sunElevation, 7, 29));
    this.addSchematicSpectralArc(
      "circumzenithal-arc",
      zenith,
      towardSun,
      transverse,
      schematicRadius,
      -0.72,
      0.72,
      available
    );
  }

  private addUpperTangentArc(
    basis: { readonly sun: THREE.Vector3; readonly right: THREE.Vector3; readonly up: THREE.Vector3 },
    available: boolean
  ): void {
    const baseRadius = radians(haloAngleRange("halo-22").minimumDeg);
    for (const sample of HALO_SPECTRAL_SAMPLES) {
      const sampleIndex = HALO_SPECTRAL_SAMPLES.indexOf(sample);
      const spectralShift = radians(sampleIndex * 0.13);
      const points: THREE.Vector3[] = [];
      for (let step = 0; step <= 80; step += 1) {
        const local = THREE.MathUtils.lerp(-0.62, 0.62, step / 80);
        const radius = baseRadius + spectralShift + local * local * 0.055;
        points.push(
          directionAtOffset(
            basis.sun,
            basis.right,
            basis.up,
            radius,
            Math.PI / 2 + local
          ).multiplyScalar(SKY_RADIUS)
        );
      }
      const arc = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: sample.color,
          transparent: true,
          opacity: spectralOpacity(available)
        })
      );
      arc.name = `upper-tangent-arc-${sample.wavelengthNm}nm-schematic`;
      this.skyDynamic.add(arc);
    }
  }

  private addCircumhorizontalArc(available: boolean): void {
    const zenith = new THREE.Vector3(0, 1, 0);
    const towardSun = new THREE.Vector3(
      Math.sin(radians(this.sunAzimuth)),
      0,
      Math.cos(radians(this.sunAzimuth))
    ).normalize();
    const transverse = new THREE.Vector3().crossVectors(zenith, towardSun).normalize();
    const representativeAltitude = THREE.MathUtils.clamp(this.sunElevation - 46, 8, 42);
    this.addSchematicSpectralArc(
      "circumhorizontal-arc",
      zenith,
      towardSun,
      transverse,
      radians(90 - representativeAltitude),
      -0.64,
      0.64,
      available
    );
  }

  private addSchematicSpectralArc(
    name: string,
    axis: THREE.Vector3,
    first: THREE.Vector3,
    second: THREE.Vector3,
    baseRadius: number,
    phaseStart: number,
    phaseEnd: number,
    available: boolean
  ): void {
    HALO_SPECTRAL_SAMPLES.forEach((sample, sampleIndex) => {
      const points: THREE.Vector3[] = [];
      const spectralShift = radians(sampleIndex * 0.14);
      for (let step = 0; step <= 96; step += 1) {
        const phase = THREE.MathUtils.lerp(phaseStart, phaseEnd, step / 96);
        points.push(
          directionAtOffset(axis, first, second, baseRadius + spectralShift, phase).multiplyScalar(SKY_RADIUS)
        );
      }
      const arc = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: sample.color,
          transparent: true,
          opacity: spectralOpacity(available)
        })
      );
      arc.name = `${name}-${sample.wavelengthNm}nm-schematic`;
      this.skyDynamic.add(arc);
    });
  }

  private addCrystalField(
    orientation: CrystalOrientation,
    habit: HaloPhenomenon["crystalHabit"]
  ): void {
    const isColumn = habit === "column";
    const geometry = new THREE.CylinderGeometry(
      isColumn ? 0.055 : 0.09,
      isColumn ? 0.055 : 0.09,
      isColumn ? 0.5 : 0.11,
      6
    );
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xa6dbe4,
      transparent: true,
      opacity: 0.42,
      roughness: 0.18,
      transmission: 0.22,
      depthWrite: false
    });
    const crystals = new THREE.InstancedMesh(geometry, material, CRYSTAL_CAPACITY);
    crystals.name = `ice-crystal-field-${orientation}`;
    const seedText = `${this.phenomenonId}|${orientation}|${habit}`;
    let seed = 0x1ce5eed;
    for (let index = 0; index < seedText.length; index += 1) {
      seed = Math.imul(seed ^ seedText.charCodeAt(index), 16_777_619);
    }
    const random = seededRandom(seed);
    const transform = new THREE.Object3D();
    const yAxis = new THREE.Vector3(0, 1, 0);

    for (let index = 0; index < CRYSTAL_CAPACITY; index += 1) {
      const azimuth = random() * Math.PI * 2;
      const elevation = THREE.MathUtils.lerp(radians(4), radians(78), Math.pow(random(), 0.72));
      const radius = THREE.MathUtils.lerp(5.2, SKY_RADIUS - 0.9, Math.pow(random(), 0.5));
      transform.position.set(
        Math.cos(elevation) * Math.sin(azimuth) * radius,
        Math.sin(elevation) * radius,
        Math.cos(elevation) * Math.cos(azimuth) * radius
      );
      transform.scale.setScalar(THREE.MathUtils.lerp(0.72, 1.35, random()));

      if (orientation === "random") {
        transform.rotation.set(random() * Math.PI, random() * Math.PI * 2, random() * Math.PI);
        transform.quaternion.setFromEuler(transform.rotation);
      } else if (orientation === "horizontal-column") {
        const orientationAzimuth = random() * Math.PI * 2;
        const axis = new THREE.Vector3(
          Math.sin(orientationAzimuth),
          0,
          Math.cos(orientationAzimuth)
        );
        transform.quaternion.setFromUnitVectors(yAxis, axis);
      } else {
        transform.quaternion.identity();
        transform.rotateY(random() * Math.PI * 2);
      }
      transform.updateMatrix();
      crystals.setMatrixAt(index, transform.matrix);
    }

    crystals.count = Math.round(CRYSTAL_CAPACITY * this.density);
    crystals.instanceMatrix.needsUpdate = true;
    this.crystalField = crystals;
    this.crystalDynamic.add(crystals);
  }

  private addRepresentativeCrystal(phenomenon: HaloPhenomenon): void {
    const guide = new THREE.Group();
    guide.name = `representative-${phenomenon.crystalHabit}-crystal-${phenomenon.prismApexDeg}deg-path`;
    guide.position.set(3.8, 2.35, 1.2);
    if (phenomenon.orientation === "horizontal-column") guide.rotation.z = Math.PI / 2;
    if (phenomenon.orientation === "random") guide.rotation.set(0.35, 0.5, -0.24);

    const crystal = new THREE.Mesh(
      new THREE.CylinderGeometry(
        phenomenon.crystalHabit === "column" ? 0.38 : 0.64,
        phenomenon.crystalHabit === "column" ? 0.38 : 0.64,
        phenomenon.crystalHabit === "column" ? 1.7 : 0.34,
        6
      ),
      new THREE.MeshPhysicalMaterial({
        color: 0x9fd9e8,
        transparent: true,
        opacity: 0.26,
        roughness: 0.08,
        transmission: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    guide.add(crystal);

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(crystal.geometry, 10),
      new THREE.LineBasicMaterial({ color: 0xaed7df, transparent: true, opacity: 0.64 })
    );
    guide.add(outline);

    const pathPoints = phenomenon.prismApexDeg === 60
      ? [
          new THREE.Vector3(-1.5, 0.14, 0.16),
          new THREE.Vector3(-0.48, 0.06, 0.08),
          new THREE.Vector3(0.35, -0.08, -0.18),
          new THREE.Vector3(1.38, -0.58, -0.55)
        ]
      : [
          new THREE.Vector3(-0.2, 1.42, 0.1),
          new THREE.Vector3(-0.12, 0.18, 0.05),
          new THREE.Vector3(0.43, -0.04, -0.2),
          new THREE.Vector3(1.45, -0.62, -0.62)
        ];
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pathPoints),
      new THREE.LineBasicMaterial({ color: 0xffdf78, transparent: true, opacity: 0.9, depthTest: false })
    );
    ray.name = `${phenomenon.prismApexDeg}deg-prism-ray-schematic`;
    ray.renderOrder = 5;
    guide.add(ray);
    this.crystalDynamic.add(guide);
  }
}
