import * as THREE from "three";
import {
  SPECTRAL_SAMPLES,
  traceDropletRay,
  type DropletRayTrace,
  type RainbowOrder
} from "../physics/rainbow";
import {
  progressiveDrawCount,
  rainbowZoomFrame,
  type RainbowZoomFrame
} from "../physics/semanticZoom";

const DROPLET_RADIUS = 3.1;
const REPRESENTATIVE_SAMPLE_INDEX = 3;
const SEGMENT_SUBDIVISIONS = 22;

function disposeGroup(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (Array.isArray(mesh.material)) mesh.material.forEach((material) => materials.add(material));
      else if (mesh.material) materials.add(mesh.material);
    });
  }
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function rayPoints(trace: DropletRayTrace, depth: number): THREE.Vector3[] {
  return trace.points.map(
    (point) => new THREE.Vector3(point.x * DROPLET_RADIUS, point.y * DROPLET_RADIUS, depth)
  );
}

function resamplePolyline(points: readonly THREE.Vector3[]): {
  readonly points: THREE.Vector3[];
  readonly segmentIndices: number[];
} {
  const sampled: THREE.Vector3[] = [];
  const segmentIndices: number[] = [];
  for (let segment = 0; segment < points.length - 1; segment += 1) {
    const start = points[segment];
    const end = points[segment + 1];
    if (!start || !end) continue;
    for (let step = 0; step < SEGMENT_SUBDIVISIONS; step += 1) {
      sampled.push(start.clone().lerp(end, step / SEGMENT_SUBDIVISIONS));
      segmentIndices.push(segment);
    }
  }
  const finalPoint = points[points.length - 1];
  if (finalPoint) {
    sampled.push(finalPoint.clone());
    segmentIndices.push(Math.max(0, points.length - 2));
  }
  return { points: sampled, segmentIndices };
}

export class DropletDetail {
  readonly group = new THREE.Group();
  private order: RainbowOrder = 1;
  private frame: RainbowZoomFrame = rainbowZoomFrame(0);
  private readonly surfaceMaterials: Array<{ material: THREE.Material; baseOpacity: number }> = [];
  private representativeGeometry: THREE.BufferGeometry | null = null;
  private representativeMaterial: THREE.LineBasicMaterial | null = null;
  private representativeVertexCount = 0;
  private readonly spectralMaterials: THREE.LineBasicMaterial[] = [];
  private readonly normalMaterials: THREE.LineDashedMaterial[] = [];
  private readonly lossBranchMaterials: THREE.LineDashedMaterial[] = [];

  constructor() {
    this.group.name = "droplet-detail";
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

  setJourneyFrame(frame: RainbowZoomFrame): void {
    this.frame = frame;
    this.group.scale.setScalar(frame.detailScale);
    for (const surface of this.surfaceMaterials) {
      surface.material.opacity = surface.baseOpacity * frame.surfaceOpacity;
    }
    if (this.representativeGeometry && this.representativeMaterial) {
      this.representativeGeometry.setDrawRange(
        0,
        progressiveDrawCount(frame.representativeRayReveal, this.representativeVertexCount)
      );
      this.representativeMaterial.opacity = 0.96 * frame.representativeRayOpacity;
    }
    for (const material of this.spectralMaterials) {
      material.opacity = 0.78 * frame.spectralOpacity;
    }
    for (const material of this.normalMaterials) {
      material.opacity = 0.56 * frame.normalOpacity;
    }
    for (const material of this.lossBranchMaterials) {
      material.opacity = 0.5 * frame.lossBranchOpacity;
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  private rebuild(): void {
    disposeGroup(this.group);
    this.surfaceMaterials.length = 0;
    this.representativeGeometry = null;
    this.representativeMaterial = null;
    this.representativeVertexCount = 0;
    this.spectralMaterials.length = 0;
    this.normalMaterials.length = 0;
    this.lossBranchMaterials.length = 0;
    this.addDroplet();
    this.addRepresentativeRay();
    this.addSpectralRays();
    this.addReferenceNormal();
    this.addPartialTransmissionBranches();
    this.setJourneyFrame(this.frame);
  }

  private addDroplet(): void {
    const sphereMaterial = new THREE.MeshPhysicalMaterial({
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
    });
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(DROPLET_RADIUS, 64, 40),
      sphereMaterial
    );
    sphere.name = "representative-water-droplet-2mm-normalized";
    sphere.renderOrder = 1;
    this.group.add(sphere);
    this.surfaceMaterials.push({ material: sphereMaterial, baseOpacity: 0.2 });

    const outlineSource = new THREE.SphereGeometry(DROPLET_RADIUS + 0.02, 48, 30);
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: 0x8bb9c4,
      transparent: true,
      opacity: 0.24
    });
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(outlineSource, 16),
      outlineMaterial
    );
    outlineSource.dispose();
    outline.name = "droplet-surface-outline";
    outline.renderOrder = 2;
    this.group.add(outline);
    this.surfaceMaterials.push({ material: outlineMaterial, baseOpacity: 0.24 });
  }

  private addRepresentativeRay(): void {
    const sample = SPECTRAL_SAMPLES[REPRESENTATIVE_SAMPLE_INDEX];
    if (!sample) return;
    const trace = traceDropletRay(sample.waterIndex, this.order);
    const sampled = resamplePolyline(rayPoints(trace, 0));
    const geometry = new THREE.BufferGeometry().setFromPoints(sampled.points);
    const incomingColor = new THREE.Color(0xffdd73);
    const selectedColor = new THREE.Color(sample.color);
    const colors = new Float32Array(sampled.points.length * 3);
    sampled.segmentIndices.forEach((segment, index) => {
      const color = segment === 0 ? incomingColor : selectedColor;
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    });
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, 2);
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthTest: false
    });
    const line = new THREE.Line(geometry, material);
    line.name = `representative-caustic-ray-${sample.wavelengthNm}nm-order-${this.order}`;
    line.renderOrder = 5;
    this.group.add(line);
    this.representativeGeometry = geometry;
    this.representativeMaterial = material;
    this.representativeVertexCount = sampled.points.length;
  }

  private addSpectralRays(): void {
    SPECTRAL_SAMPLES.forEach((sample, index) => {
      if (index === REPRESENTATIVE_SAMPLE_INDEX) return;
      const trace = traceDropletRay(sample.waterIndex, this.order);
      const depth = (index - (SPECTRAL_SAMPLES.length - 1) / 2) * 0.035;
      const material = new THREE.LineBasicMaterial({
        color: sample.color,
        transparent: true,
        opacity: 0,
        depthTest: false
      });
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(rayPoints(trace, depth)),
        material
      );
      line.name = `${sample.label}-${sample.wavelengthNm}nm-order-${this.order}`;
      line.renderOrder = 4;
      this.group.add(line);
      this.spectralMaterials.push(material);
    });
  }

  private addReferenceNormal(): void {
    const sample = SPECTRAL_SAMPLES[REPRESENTATIVE_SAMPLE_INDEX];
    if (!sample) return;
    const trace = traceDropletRay(sample.waterIndex, this.order);
    const entry = trace.points[1];
    if (!entry) return;
    const origin = new THREE.Vector3(entry.x * DROPLET_RADIUS, entry.y * DROPLET_RADIUS, 0.2);
    const normal = new THREE.Vector3(entry.x, entry.y, 0).normalize();
    const material = new THREE.LineDashedMaterial({
      color: 0xf3f8f9,
      dashSize: 0.14,
      gapSize: 0.1,
      transparent: true,
      opacity: 0,
      depthTest: false
    });
    const normalLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        origin.clone().addScaledVector(normal, -1.1),
        origin.clone().addScaledVector(normal, 1.1)
      ]),
      material
    );
    normalLine.name = "surface-normal-at-entry";
    normalLine.computeLineDistances();
    normalLine.renderOrder = 6;
    this.group.add(normalLine);
    this.normalMaterials.push(material);
  }

  private addPartialTransmissionBranches(): void {
    const sample = SPECTRAL_SAMPLES[REPRESENTATIVE_SAMPLE_INDEX];
    if (!sample) return;
    const trace = traceDropletRay(sample.waterIndex, this.order);
    for (const branch of trace.lossBranches) {
      const material = new THREE.LineDashedMaterial({
        color: 0xffc777,
        dashSize: 0.13,
        gapSize: 0.09,
        transparent: true,
        opacity: 0,
        depthTest: false
      });
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(
            branch.start.x * DROPLET_RADIUS,
            branch.start.y * DROPLET_RADIUS,
            -0.08
          ),
          new THREE.Vector3(
            branch.end.x * DROPLET_RADIUS,
            branch.end.y * DROPLET_RADIUS,
            -0.08
          )
        ]),
        material
      );
      line.name = `partial-transmission-loss-${branch.reflectionIndex}`;
      line.computeLineDistances();
      line.renderOrder = 6;
      this.group.add(line);
      this.lossBranchMaterials.push(material);
    }
  }
}
