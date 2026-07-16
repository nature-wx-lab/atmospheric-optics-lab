import * as THREE from "three";
import {
  SPECTRAL_SAMPLES,
  traceDropletRay,
  type DropletRayTrace,
  type RainbowOrder
} from "../physics/rainbow";

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

function rayPoints(trace: DropletRayTrace, depth: number): THREE.Vector3[] {
  return trace.points.map((point) => new THREE.Vector3(point.x * 3.1, point.y * 3.1, depth));
}

export class DropletDetail {
  readonly group = new THREE.Group();
  private order: RainbowOrder = 1;

  constructor() {
    this.group.name = "droplet-detail";
    this.group.visible = false;
    this.rebuild();
  }

  setOrder(order: RainbowOrder): void {
    if (order === this.order) return;
    this.order = order;
    this.rebuild();
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  private rebuild(): void {
    disposeGroup(this.group);
    this.addDroplet();
    this.addSunlightGuide();
    this.addSpectralRays();
    this.addReferenceNormal();
  }

  private addDroplet(): void {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(3.1, 64, 40),
      new THREE.MeshPhysicalMaterial({
        color: 0x9fd9e8,
        roughness: 0.08,
        metalness: 0,
        transmission: 0.88,
        transparent: true,
        opacity: 0.2,
        thickness: 0.7,
        ior: 1.333,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    sphere.name = "representative-water-droplet";
    this.group.add(sphere);

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.SphereGeometry(3.12, 48, 30), 16),
      new THREE.LineBasicMaterial({ color: 0x8bb9c4, transparent: true, opacity: 0.24 })
    );
    this.group.add(outline);
  }

  private addSunlightGuide(): void {
    const points = [new THREE.Vector3(-7.4, -2.7, -0.2), new THREE.Vector3(-3.3, -2.7, -0.2)];
    const guide = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xffdd73, transparent: true, opacity: 0.8 })
    );
    this.group.add(guide);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.42, 16),
      new THREE.MeshBasicMaterial({ color: 0xffdd73 })
    );
    cone.rotation.z = -Math.PI / 2;
    cone.position.set(-3.45, -2.7, -0.2);
    this.group.add(cone);
  }

  private addSpectralRays(): void {
    SPECTRAL_SAMPLES.forEach((sample, index) => {
      const trace = traceDropletRay(sample.waterIndex, this.order);
      const depth = (index - (SPECTRAL_SAMPLES.length - 1) / 2) * 0.035;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(rayPoints(trace, depth)),
        new THREE.LineBasicMaterial({
          color: sample.color,
          transparent: true,
          opacity: 0.92,
          depthTest: false
        })
      );
      line.name = `${sample.label}-${sample.wavelengthNm}nm-${this.order}`;
      line.renderOrder = 4;
      this.group.add(line);
    });
  }

  private addReferenceNormal(): void {
    const middle = SPECTRAL_SAMPLES[3];
    if (!middle) return;
    const trace = traceDropletRay(middle.waterIndex, this.order);
    const entry = trace.points[1];
    if (!entry) return;
    const origin = new THREE.Vector3(entry.x * 3.1, entry.y * 3.1, 0.2);
    const normal = new THREE.Vector3(entry.x, entry.y, 0).normalize();
    const normalLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        origin.clone().addScaledVector(normal, -1.1),
        origin.clone().addScaledVector(normal, 1.1)
      ]),
      new THREE.LineDashedMaterial({ color: 0xf3f8f9, dashSize: 0.14, gapSize: 0.1, transparent: true, opacity: 0.55 })
    );
    normalLine.computeLineDistances();
    this.group.add(normalLine);
  }
}
