import * as THREE from "three";
import {
  SPECTRAL_SAMPLES,
  findStationaryRay,
  traceDropletRay,
  type RainbowOrder
} from "../physics/rainbow";
import {
  OBSERVER_OPTICAL_ORIGIN,
  focusDropletDirection,
  sunDirectionFromAngles,
  type RainbowZoomFrame
} from "../physics/semanticZoom";
import { DropletDetail } from "./dropletDetail";
import { RainbowOverview } from "./rainbowOverview";

const FOCUS_DISTANCE_MODEL_UNITS = 10.6;
const REPRESENTATIVE_SAMPLE_INDEX = 3;

function opticalOrigin(): THREE.Vector3 {
  return new THREE.Vector3(
    OBSERVER_OPTICAL_ORIGIN.x,
    OBSERVER_OPTICAL_ORIGIN.y,
    OBSERVER_OPTICAL_ORIGIN.z
  );
}

export interface FocusDropletSnapshot {
  readonly id: string;
  readonly position: THREE.Vector3;
  readonly incomingDirection: THREE.Vector3;
  readonly outgoingDirection: THREE.Vector3;
  readonly wavelengthNm: number;
  readonly rainbowRadiusDeg: number;
  readonly illustrativeDistanceModelUnits: number;
}

export class RainbowJourney {
  readonly group = new THREE.Group();
  private readonly overview = new RainbowOverview();
  private readonly detail = new DropletDetail();
  private readonly marker = new THREE.Group();
  private readonly markerMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly focusGuideGeometry = new THREE.BufferGeometry();
  private readonly focusGuideMaterial = new THREE.LineDashedMaterial({
    color: 0x9ce9eb,
    dashSize: 0.22,
    gapSize: 0.16,
    transparent: true,
    opacity: 0
  });
  private readonly focusGuide = new THREE.Line(
    this.focusGuideGeometry,
    this.focusGuideMaterial
  );
  private order: RainbowOrder = 1;
  private sunElevationDeg = 12;
  private sunAzimuthDeg = 225;
  private focusPosition = new THREE.Vector3();
  private incomingDirection = new THREE.Vector3(1, 0, 0);
  private outgoingDirection = new THREE.Vector3(-1, 0, 0);
  private focusId = "";

  constructor() {
    this.group.name = "rainbow-seamless-journey";
    this.marker.name = "selected-contributing-droplet";
    this.focusGuide.name = "selected-droplet-sightline";
    this.addMarker();
    this.group.add(this.overview.group, this.focusGuide, this.marker, this.detail.group);
    this.detail.setVisible(true);
    this.updateFocusDroplet();
  }

  setConditions(order: RainbowOrder, sunElevationDeg: number, sunAzimuthDeg: number): void {
    this.order = order;
    this.sunElevationDeg = sunElevationDeg;
    this.sunAzimuthDeg = sunAzimuthDeg;
    this.overview.setConditions(order, sunElevationDeg, sunAzimuthDeg);
    this.detail.setOrder(order);
    this.updateFocusDroplet();
  }

  setDensity(density: number): void {
    this.overview.setDensity(density);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  applyZoom(frame: RainbowZoomFrame): void {
    this.overview.setJourneyOpacity(frame.overviewOpacity);
    this.detail.setJourneyFrame(frame);
    this.markerMaterials[0]!.opacity = 0.92 * frame.focusMarkerOpacity;
    this.markerMaterials[1]!.opacity = 0.2 * frame.focusMarkerOpacity;
    this.focusGuideMaterial.opacity = 0.42 * frame.focusMarkerOpacity;
  }

  getFocusPosition(): THREE.Vector3 {
    return this.focusPosition.clone();
  }

  getFocusSnapshot(): FocusDropletSnapshot {
    const sample = SPECTRAL_SAMPLES[REPRESENTATIVE_SAMPLE_INDEX];
    if (!sample) throw new Error("representative spectral sample is missing");
    const ray = findStationaryRay(sample.waterIndex, this.order);
    return {
      id: this.focusId,
      position: this.focusPosition.clone(),
      incomingDirection: this.incomingDirection.clone(),
      outgoingDirection: this.outgoingDirection.clone(),
      wavelengthNm: sample.wavelengthNm,
      rainbowRadiusDeg: ray.radiusDeg,
      illustrativeDistanceModelUnits: FOCUS_DISTANCE_MODEL_UNITS
    };
  }

  dispose(): void {
    this.overview.dispose();
    this.detail.dispose();
    this.marker.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
      else mesh.material?.dispose();
    });
    this.focusGuideGeometry.dispose();
    this.focusGuideMaterial.dispose();
    this.group.clear();
  }

  private addMarker(): void {
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xe8ffff,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x61d6da,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 12), coreMaterial);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.23, 18, 12), glowMaterial);
    core.name = "focus-droplet-core";
    glow.name = "focus-droplet-glow";
    this.marker.add(core, glow);
    this.markerMaterials.push(coreMaterial, glowMaterial);
  }

  private updateFocusDroplet(): void {
    const sample = SPECTRAL_SAMPLES[REPRESENTATIVE_SAMPLE_INDEX];
    if (!sample) throw new Error("representative spectral sample is missing");
    const ray = findStationaryRay(sample.waterIndex, this.order);
    const focus = focusDropletDirection(
      this.sunElevationDeg,
      this.sunAzimuthDeg,
      ray.radiusDeg
    );
    const sun = sunDirectionFromAngles(this.sunElevationDeg, this.sunAzimuthDeg);
    this.focusPosition
      .copy(opticalOrigin())
      .addScaledVector(new THREE.Vector3(focus.x, focus.y, focus.z), FOCUS_DISTANCE_MODEL_UNITS);
    this.incomingDirection.set(-sun.x, -sun.y, -sun.z).normalize();
    this.outgoingDirection.copy(opticalOrigin()).sub(this.focusPosition).normalize();
    this.focusId = [
      "drop",
      `o${this.order}`,
      `e${Math.round(this.sunElevationDeg)}`,
      `a${Math.round(this.sunAzimuthDeg)}`,
      `${sample.wavelengthNm}nm`
    ].join("-");

    this.marker.position.copy(this.focusPosition);
    this.detail.group.position.copy(this.focusPosition);
    this.orientDetailToWorld();
    this.focusGuideGeometry.setFromPoints([opticalOrigin(), this.focusPosition]);
    this.focusGuideGeometry.computeBoundingSphere();
    this.focusGuide.computeLineDistances();
  }

  private orientDetailToWorld(): void {
    const sample = SPECTRAL_SAMPLES[REPRESENTATIVE_SAMPLE_INDEX];
    if (!sample) return;
    const trace = traceDropletRay(sample.waterIndex, this.order);
    const worldX = this.incomingDirection.clone().normalize();
    const worldPerpendicular = this.outgoingDirection
      .clone()
      .addScaledVector(worldX, -this.outgoingDirection.dot(worldX))
      .normalize();
    const localYSign = Math.sign(trace.outgoing.y) || 1;
    const worldY = worldPerpendicular.multiplyScalar(localYSign);
    const worldZ = new THREE.Vector3().crossVectors(worldX, worldY).normalize();
    const basis = new THREE.Matrix4().makeBasis(worldX, worldY, worldZ);
    this.detail.group.quaternion.setFromRotationMatrix(basis);
  }
}
