import * as THREE from "three";
import {
  SPECTRAL_SAMPLES,
  findStationaryRay,
  radians,
  type RainbowOrder
} from "../physics/rainbow";
import { OBSERVER_OPTICAL_ORIGIN } from "../physics/semanticZoom";

const PARTICLE_CAPACITY = 5_000;
const SKY_RADIUS = 14.5;

function opticalOrigin(): THREE.Vector3 {
  return new THREE.Vector3(
    OBSERVER_OPTICAL_ORIGIN.x,
    OBSERVER_OPTICAL_ORIGIN.y,
    OBSERVER_OPTICAL_ORIGIN.z
  );
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

function perpendicularBasis(axis: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const helper = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
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

export class RainbowOverview {
  readonly group = new THREE.Group();
  private readonly dynamic = new THREE.Group();
  private readonly baseOpacities = new WeakMap<THREE.Material, number>();
  private readonly baseTransparency = new WeakMap<THREE.Material, boolean>();
  private readonly baseDepthWrite = new WeakMap<THREE.Material, boolean>();
  private particleGeometry: THREE.BufferGeometry | null = null;
  private order: RainbowOrder = 1;
  private sunElevation = 12;
  private sunAzimuth = 225;
  private density = 0.7;
  private journeyOpacity = 1;

  constructor() {
    this.group.name = "rainbow-overview";
    this.dynamic.name = "rainbow-overview-dynamic";
    this.group.add(this.dynamic);
    this.addObserver();
    this.addHorizon();
    this.rebuild();
  }

  setConditions(order: RainbowOrder, sunElevation: number, sunAzimuth: number): void {
    const changed =
      order !== this.order || sunElevation !== this.sunElevation || sunAzimuth !== this.sunAzimuth;
    this.order = order;
    this.sunElevation = sunElevation;
    this.sunAzimuth = sunAzimuth;
    if (changed) this.rebuild();
  }

  setDensity(density: number): void {
    this.density = THREE.MathUtils.clamp(density, 0.15, 1);
    this.particleGeometry?.setDrawRange(0, Math.round(PARTICLE_CAPACITY * this.density));
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setJourneyOpacity(opacity: number): void {
    this.journeyOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
    this.applyJourneyOpacity();
    this.group.visible = this.journeyOpacity > 0.001;
  }

  dispose(): void {
    disposeGroup(this.group);
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
    this.group.add(observer);
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
    this.group.add(horizon);
  }

  private rebuild(): void {
    disposeGroup(this.dynamic);
    const sun = this.sunDirection();
    const antisolar = sun.clone().negate();
    const [first, second] = perpendicularBasis(antisolar);
    this.addSun(sun);
    this.addAntisolarAxis(sun, antisolar);
    this.addRainbowRings(antisolar, first, second);
    this.addConeGuides(antisolar, first, second);
    this.addParticles(antisolar, first, second);
    this.applyJourneyOpacity();
  }

  private applyJourneyOpacity(): void {
    this.group.traverse((object) => {
      const candidate = object as THREE.Mesh;
      const materials = Array.isArray(candidate.material)
        ? candidate.material
        : candidate.material
          ? [candidate.material]
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
    const origin = opticalOrigin();
    sunGroup.position.copy(origin).addScaledVector(sun, SKY_RADIUS);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd968 })
    );
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.76, 20, 12),
      new THREE.MeshBasicMaterial({ color: 0xffbd43, transparent: true, opacity: 0.12 })
    );
    sunGroup.add(orb, glow);
    this.dynamic.add(sunGroup);

    const rayPoints = [
      origin.clone().addScaledVector(sun, SKY_RADIUS - 0.8),
      origin.clone().addScaledVector(sun, 1.2)
    ];
    this.dynamic.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(rayPoints),
        new THREE.LineDashedMaterial({ color: 0xffd968, dashSize: 0.35, gapSize: 0.22, opacity: 0.6, transparent: true })
      ).computeLineDistances()
    );
  }

  private addAntisolarAxis(sun: THREE.Vector3, antisolar: THREE.Vector3): void {
    const origin = opticalOrigin();
    const axis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        origin.clone().addScaledVector(sun, SKY_RADIUS),
        origin,
        opticalOrigin().addScaledVector(antisolar, SKY_RADIUS)
      ]),
      new THREE.LineDashedMaterial({ color: 0x8ea5ab, dashSize: 0.28, gapSize: 0.2, transparent: true, opacity: 0.42 })
    );
    axis.computeLineDistances();
    this.dynamic.add(axis);

    const antiMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.38, 32),
      new THREE.MeshBasicMaterial({ color: 0xeafcfd, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
    );
    antiMarker.position.copy(opticalOrigin()).addScaledVector(antisolar, SKY_RADIUS);
    antiMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), antisolar);
    this.dynamic.add(antiMarker);
  }

  private addRainbowRings(
    antisolar: THREE.Vector3,
    first: THREE.Vector3,
    second: THREE.Vector3
  ): void {
    for (const sample of SPECTRAL_SAMPLES) {
      const radius = radians(findStationaryRay(sample.waterIndex, this.order).radiusDeg);
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
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: sample.color, transparent: true, opacity: 0.86 })
      );
      ring.name = `${sample.label}-${this.order}`;
      this.dynamic.add(ring);
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
        new THREE.LineBasicMaterial({ color: 0x8ea5ab, transparent: true, opacity: 0.12 })
      );
      this.dynamic.add(guide);
    }
  }

  private addParticles(
    antisolar: THREE.Vector3,
    first: THREE.Vector3,
    second: THREE.Vector3
  ): void {
    // Keep the representative field stable while the Sun moves; only the
    // observer-centred geometry rotates. The chase experiment uses its own
    // fixed world positions and IDs for quantitative comparisons.
    const random = seededRandom(0x7a11ce + this.order * 301);
    const positions = new Float32Array(PARTICLE_CAPACITY * 3);
    const colors = new Float32Array(PARTICLE_CAPACITY * 3);
    const spectralRadii = SPECTRAL_SAMPLES.map((sample) => ({
      sample,
      radius: radians(findStationaryRay(sample.waterIndex, this.order).radiusDeg)
    }));
    const lower = Math.min(...spectralRadii.map((item) => item.radius));
    const upper = Math.max(...spectralRadii.map((item) => item.radius));

    for (let index = 0; index < PARTICLE_CAPACITY; index += 1) {
      const phase = random() * Math.PI * 2;
      const onBow = random() < 0.42;
      const angle = onBow
        ? THREE.MathUtils.lerp(lower - 0.015, upper + 0.015, random())
        : THREE.MathUtils.lerp(radians(7), radians(82), Math.pow(random(), 0.72));
      const radialDistance = THREE.MathUtils.lerp(6, SKY_RADIUS - 0.7, Math.pow(random(), 0.45));
      const direction = directionOnCone(antisolar, first, second, angle, phase);
      const position = opticalOrigin().addScaledVector(direction, radialDistance);
      positions[index * 3] = position.x;
      positions[index * 3 + 1] = position.y;
      positions[index * 3 + 2] = position.z;

      let nearest = spectralRadii[0];
      for (const candidate of spectralRadii) {
        if (!nearest || Math.abs(candidate.radius - angle) < Math.abs(nearest.radius - angle)) {
          nearest = candidate;
        }
      }
      const rainbowDistance = nearest ? Math.abs(nearest.radius - angle) : Infinity;
      const color =
        onBow && nearest && rainbowDistance < 0.018
          ? new THREE.Color(nearest.sample.color)
          : new THREE.Color(0x64777d).multiplyScalar(THREE.MathUtils.lerp(0.28, 0.62, random()));
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, Math.round(PARTICLE_CAPACITY * this.density));
    const particles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.09,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    particles.name = "rain-droplet-field";
    this.particleGeometry = geometry;
    this.dynamic.add(particles);
  }
}
