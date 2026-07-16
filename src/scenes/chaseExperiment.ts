import * as THREE from "three";
import {
  RainbowChaseModel,
  compareChaseSnapshots,
  observerPathDirectionForChase,
  sunDirectionForChase,
  type ChaseDroplet,
  type ChaseSnapshot,
  type ChaseTransition,
  type ChaseVec3,
  type RainbowChaseOptions
} from "../physics/chase";
import { radians, type RainbowOrder } from "../physics/rainbow";

export interface ChaseExperimentOptions extends RainbowChaseOptions {
  /** Linear world-to-scene conversion. The default maps 1 km to 3 scene units. */
  readonly sceneMetersScale?: number;
}

export interface ChaseExperimentState {
  readonly snapshot: ChaseSnapshot;
  readonly transition: ChaseTransition | null;
}

function disposeGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      const drawable = object as THREE.Mesh;
      drawable.geometry?.dispose();
      if (Array.isArray(drawable.material)) {
        drawable.material.forEach((material) => material.dispose());
      } else {
        drawable.material?.dispose();
      }
    });
  }
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

/**
 * Three.js view for RainbowChaseModel. UI code can read the returned snapshot
 * and transition directly, so displayed counts and the scene share one source.
 */
export class ChaseExperiment {
  readonly group = new THREE.Group();
  private readonly staticGroup = new THREE.Group();
  private readonly dynamicGroup = new THREE.Group();
  private model: RainbowChaseModel;
  private currentSnapshot: ChaseSnapshot;
  private currentTransition: ChaseTransition | null = null;
  private readonly sceneMetersScale: number;

  constructor(options: ChaseExperimentOptions = {}) {
    const { sceneMetersScale = 0.003, ...modelOptions } = options;
    if (!Number.isFinite(sceneMetersScale) || sceneMetersScale <= 0) {
      throw new RangeError("sceneMetersScale must be positive");
    }
    this.sceneMetersScale = sceneMetersScale;
    this.model = new RainbowChaseModel(modelOptions);
    this.currentSnapshot = this.model.snapshot(0);

    this.group.name = "rainbow-chase-experiment";
    this.staticGroup.name = "rainbow-chase-static";
    this.dynamicGroup.name = "rainbow-chase-dynamic";
    this.group.add(this.staticGroup, this.dynamicGroup);
    this.addStaticRainField();
    this.addObserverPath();
    this.rebuildDynamic(null);
  }

  setObserverDistance(observerDistanceM: number): ChaseExperimentState {
    const previous = this.currentSnapshot;
    this.currentSnapshot = this.model.snapshot(observerDistanceM);
    this.currentTransition = compareChaseSnapshots(previous, this.currentSnapshot);
    this.rebuildDynamic(previous);
    return this.getState();
  }

  setOrder(order: RainbowOrder): ChaseExperimentState {
    if (order === this.model.options.order) return this.getState();
    const observerDistanceM = this.currentSnapshot.observerDistanceM;
    this.model = new RainbowChaseModel({ ...this.model.options, order });
    this.currentSnapshot = this.model.snapshot(observerDistanceM);
    this.currentTransition = null;
    this.rebuildDynamic(null);
    return this.getState();
  }

  getState(): ChaseExperimentState {
    return {
      snapshot: this.currentSnapshot,
      transition: this.currentTransition
    };
  }

  getDropletField(): readonly ChaseDroplet[] {
    return this.model.droplets;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  private toScenePosition(positionM: ChaseVec3): THREE.Vector3 {
    const pathDirection = observerPathDirectionForChase(this.model.options.sunAzimuthDeg);
    return new THREE.Vector3(
      (positionM.x - pathDirection.x * this.model.options.pathLengthM / 2) *
        this.sceneMetersScale,
      (positionM.y - this.model.options.observerHeightM) * this.sceneMetersScale,
      (positionM.z - pathDirection.z * this.model.options.pathLengthM / 2) *
        this.sceneMetersScale
    );
  }

  private addStaticRainField(): void {
    const positions = new Float32Array(this.model.droplets.length * 3);
    for (let index = 0; index < this.model.droplets.length; index += 1) {
      const droplet = this.model.droplets[index];
      if (!droplet) continue;
      const position = this.toScenePosition(droplet.positionM);
      positions[index * 3] = position.x;
      positions[index * 3 + 1] = position.y;
      positions[index * 3 + 2] = position.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0x52686e,
        size: 0.025,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.26,
        depthWrite: false
      })
    );
    particles.name = "fixed-chase-rain-field";
    this.staticGroup.add(particles);
  }

  private addObserverPath(): void {
    const pathDirection = observerPathDirectionForChase(this.model.options.sunAzimuthDeg);
    const start = this.toScenePosition({
      x: 0,
      y: this.model.options.observerHeightM,
      z: 0
    });
    const end = this.toScenePosition({
      x: pathDirection.x * this.model.options.pathLengthM,
      y: this.model.options.observerHeightM,
      z: pathDirection.z * this.model.options.pathLengthM
    });
    const path = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([start, end]),
      new THREE.LineDashedMaterial({
        color: 0xeafcfd,
        dashSize: 0.12,
        gapSize: 0.08,
        transparent: true,
        opacity: 0.72
      })
    );
    path.computeLineDistances();
    path.name = "observer-500m-path";
    this.staticGroup.add(path);

    for (const position of [start, end]) {
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.09, 0.13, 24),
        new THREE.MeshBasicMaterial({
          color: 0xeafcfd,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7
        })
      );
      marker.position.copy(position);
      marker.rotation.x = Math.PI / 2;
      this.staticGroup.add(marker);
    }
  }

  private rebuildDynamic(previous: ChaseSnapshot | null): void {
    disposeGroup(this.dynamicGroup);
    this.addObserver();
    this.addObserverCentredAngleRing();
    this.addContributors(previous);
  }

  private addObserver(): void {
    const observer = new THREE.Group();
    observer.name = "moving-observer";
    observer.position.copy(this.toScenePosition(this.currentSnapshot.observerPositionM));
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.105, 0.36, 16),
      new THREE.MeshBasicMaterial({ color: 0xeafcfd })
    );
    body.position.y = 0.12;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0xeafcfd })
    );
    head.position.y = 0.35;
    observer.add(body, head);
    this.dynamicGroup.add(observer);
  }

  private addObserverCentredAngleRing(): void {
    const sun = sunDirectionForChase(
      this.model.options.sunElevationDeg,
      this.model.options.sunAzimuthDeg
    );
    const antisolar = new THREE.Vector3(-sun.x, -sun.y, -sun.z).normalize();
    const [first, second] = perpendicularBasis(antisolar);
    const radius = radians(this.currentSnapshot.rainbowRadiusDeg);
    const observer = this.toScenePosition(this.currentSnapshot.observerPositionM);
    const guideDistance = 3.2;
    const points: THREE.Vector3[] = [];
    for (let step = 0; step < 192; step += 1) {
      const phase = (step / 192) * Math.PI * 2;
      points.push(
        observer
          .clone()
          .add(directionOnCone(antisolar, first, second, radius, phase).multiplyScalar(guideDistance))
      );
    }
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x7be8f0, transparent: true, opacity: 0.74 })
    );
    ring.name = "observer-centred-rainbow-angle";
    this.dynamicGroup.add(ring);
  }

  private addContributors(previous: ChaseSnapshot | null): void {
    const previousIds = new Set(previous?.contributingDropletIds ?? []);
    const currentIds = new Set(this.currentSnapshot.contributingDropletIds);
    const positions = new Float32Array(this.currentSnapshot.contributingDroplets.length * 3);
    const colors = new Float32Array(this.currentSnapshot.contributingDroplets.length * 3);
    const retainedColor = new THREE.Color(0x62e1ff);
    const enteredColor = new THREE.Color(0xffd768);

    this.currentSnapshot.contributingDroplets.forEach((droplet, index) => {
      const position = this.toScenePosition(droplet.positionM);
      const color = previous && !previousIds.has(droplet.id) ? enteredColor : retainedColor;
      positions[index * 3] = position.x;
      positions[index * 3 + 1] = position.y;
      positions[index * 3 + 2] = position.z;
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    });

    const contributorGeometry = new THREE.BufferGeometry();
    contributorGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    contributorGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const contributors = new THREE.Points(
      contributorGeometry,
      new THREE.PointsMaterial({
        size: 0.13,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    contributors.name = "currently-contributing-droplets";
    this.dynamicGroup.add(contributors);

    if (previous) {
      const exited = previous.contributingDroplets.filter((droplet) => !currentIds.has(droplet.id));
      const exitedPositions = new Float32Array(exited.length * 3);
      exited.forEach((droplet, index) => {
        const position = this.toScenePosition(droplet.positionM);
        exitedPositions[index * 3] = position.x;
        exitedPositions[index * 3 + 1] = position.y;
        exitedPositions[index * 3 + 2] = position.z;
      });
      const exitedGeometry = new THREE.BufferGeometry();
      exitedGeometry.setAttribute("position", new THREE.BufferAttribute(exitedPositions, 3));
      const exitedPoints = new THREE.Points(
        exitedGeometry,
        new THREE.PointsMaterial({
          color: 0xff5f9d,
          size: 0.075,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.42,
          depthWrite: false
        })
      );
      exitedPoints.name = "previously-contributing-droplets";
      this.dynamicGroup.add(exitedPoints);
    }

    const observer = this.toScenePosition(this.currentSnapshot.observerPositionM);
    const sightlinePoints: THREE.Vector3[] = [];
    const maximumSightlines = 28;
    const stride = Math.max(
      1,
      Math.floor(this.currentSnapshot.contributingDroplets.length / maximumSightlines)
    );
    for (
      let index = 0;
      index < this.currentSnapshot.contributingDroplets.length && sightlinePoints.length < maximumSightlines * 2;
      index += stride
    ) {
      const droplet = this.currentSnapshot.contributingDroplets[index];
      if (!droplet) continue;
      sightlinePoints.push(observer, this.toScenePosition(droplet.positionM));
    }
    const sightlines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(sightlinePoints),
      new THREE.LineBasicMaterial({ color: 0x62e1ff, transparent: true, opacity: 0.09 })
    );
    sightlines.name = "sample-contributing-sightlines";
    this.dynamicGroup.add(sightlines);
  }
}
