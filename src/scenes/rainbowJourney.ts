import * as THREE from "three";
import {
  SPECTRAL_SAMPLES,
  traceDropletRay,
  type RainbowOrder
} from "../physics/rainbow";
import {
  rainbowZoomFrame,
  sunDirectionFromAngles,
  type RainbowZoomFrame
} from "../physics/semanticZoom";
import { DropletDetail } from "./dropletDetail";
import {
  RainbowOverview,
  type RainbowOverviewSelection,
  type RainbowRepresentativePath
} from "./rainbowOverview";

export interface FocusDropletSnapshot {
  readonly id: string;
  readonly index: number;
  readonly position: THREE.Vector3;
  readonly physicalPositionM: THREE.Vector3;
  readonly incomingDirection: THREE.Vector3;
  /** Exact direction from the selected drop to the fixed observer eye. */
  readonly outgoingDirection: THREE.Vector3;
  /** Direction of the caustic ray rendered inside the enlarged drop. */
  readonly representativeRayDirection: THREE.Vector3;
  readonly contributes: boolean;
  readonly rayReachesObserver: boolean;
  readonly dominantWavelengthNm: number | null;
  readonly referenceWavelengthNm: number;
  readonly refractiveIndex: number;
  readonly apparentRadiusDeg: number;
  readonly rainbowRadiusDeg: number;
  readonly angularErrorDeg: number;
  readonly distanceFromObserverM: number;
  readonly diameterMm: number;
  readonly totalDroplets: number;
  readonly visibleDroplets: number;
  readonly contributingDroplets: number;
  readonly observerPositionM: THREE.Vector3;
  readonly observerScenePosition: THREE.Vector3;
  /** True only after the visitor selected a wavelength, point, adjacent ID, or direct ID. */
  readonly explicitlySelected: boolean;
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
  private readonly incomingWorldGeometry = new THREE.BufferGeometry();
  private readonly incomingWorldMaterial = new THREE.LineBasicMaterial({
    color: 0xfffbf2,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  private readonly incomingWorldRay = new THREE.Line(
    this.incomingWorldGeometry,
    this.incomingWorldMaterial
  );
  private order: RainbowOrder = 1;
  private sunElevationDeg = 12;
  private sunAzimuthDeg = 225;
  private frame: RainbowZoomFrame = rainbowZoomFrame(0);
  private focusPosition = new THREE.Vector3();
  private incomingDirection = new THREE.Vector3(1, 0, 0);
  private outgoingDirection = new THREE.Vector3(-1, 0, 0);
  private representativeRayDirection = new THREE.Vector3(-1, 0, 0);
  private selection: RainbowOverviewSelection;
  private explicitlySelected = false;
  private referenceWavelengthNm = 530;
  private referenceRefractiveIndex = 1.3352;
  private observerView = true;

  constructor() {
    this.group.name = "rainbow-seamless-journey-through-real-rain-field";
    this.marker.name = "selected-existing-rain-field-droplet";
    this.focusGuide.name = "observer-sightline-to-selected-existing-droplet";
    this.incomingWorldRay.name = "white-sunlight-before-selected-rain-drop";
    this.addMarker();
    this.group.add(
      this.overview.group,
      this.incomingWorldRay,
      this.focusGuide,
      this.marker,
      this.detail.group
    );
    this.detail.setVisible(false);
    this.selection = this.overview.getSelected();
    this.updateSelectedDroplet();
  }

  setConditions(order: RainbowOrder, sunElevationDeg: number, sunAzimuthDeg: number): void {
    this.order = order;
    this.sunElevationDeg = sunElevationDeg;
    this.sunAzimuthDeg = sunAzimuthDeg;
    this.overview.setConditions(order, sunElevationDeg, sunAzimuthDeg);
    this.detail.setOrder(order);
    this.selection = this.overview.getSelected();
    this.updateSelectedDroplet();
  }

  setDensity(density: number): void {
    this.overview.setDensity(density);
    this.selection = this.overview.getSelected();
    this.updateSelectedDroplet();
  }

  setObserverPositionM(positionM: THREE.Vector3): void {
    this.overview.setObserverPositionM(positionM);
    this.selection = this.overview.getSelected();
    this.updateSelectedDroplet();
    this.applyZoom(this.frame);
  }

  getObserverPositionM(): THREE.Vector3 {
    return this.overview.getObserverPositionM();
  }

  getObserverScenePosition(): THREE.Vector3 {
    return this.overview.getObserverScenePosition();
  }

  getRepresentativeWorldPaths(): readonly RainbowRepresentativePath[] {
    return this.overview.getSnapshot().representativePaths;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setObserverView(observerView: boolean): void {
    this.observerView = observerView;
    this.overview.setObserverView(observerView);
    this.applyZoom(this.frame);
  }

  applyZoom(frame: RainbowZoomFrame): void {
    this.frame = frame;
    const presentationFrame = this.explicitlySelected
      ? frame
      : {
          ...frame,
          overviewOpacity: 1,
          focusMarkerOpacity: 0,
          surfaceOpacity: 0,
          representativeRayOpacity: 0,
          representativeRayReveal: 0,
          spectralOpacity: 0,
          normalOpacity: 0,
          lossBranchOpacity: 0
        };
    this.overview.setSemanticFrame(presentationFrame);
    this.overview.setJourneyOpacity(presentationFrame.overviewOpacity);
    this.detail.setVisible(this.explicitlySelected);
    this.detail.setJourneyFrame(presentationFrame);
    this.marker.visible = this.explicitlySelected;
    this.focusGuide.visible = this.explicitlySelected;
    this.incomingWorldRay.visible = this.explicitlySelected && !this.observerView;
    this.markerMaterials[0]!.opacity = 0.76 * presentationFrame.focusMarkerOpacity;
    this.markerMaterials[1]!.opacity = 0.16 * presentationFrame.focusMarkerOpacity;
    this.focusGuideMaterial.opacity = this.selection.observation.contributes
      ? 0.3 * Math.max(
          presentationFrame.focusMarkerOpacity,
          presentationFrame.representativeRayOpacity
        )
      : 0.26 * presentationFrame.focusMarkerOpacity;
    this.incomingWorldMaterial.opacity = this.observerView
      ? 0
      : 0.72 * Math.max(
          presentationFrame.focusMarkerOpacity,
          presentationFrame.representativeRayOpacity
        );
  }

  getFocusPosition(): THREE.Vector3 {
    return this.focusPosition.clone();
  }

  getFocusSnapshot(): FocusDropletSnapshot {
    const field = this.overview.getSnapshot();
    const observation = this.selection.observation;
    const droplet = this.selection;
    return {
      id: droplet.id,
      index: droplet.index,
      position: this.focusPosition.clone(),
      physicalPositionM: droplet.physicalPositionM.clone(),
      incomingDirection: this.incomingDirection.clone(),
      outgoingDirection: this.outgoingDirection.clone(),
      representativeRayDirection: this.representativeRayDirection.clone(),
      contributes: observation.contributes,
      rayReachesObserver: observation.contributes,
      dominantWavelengthNm: observation.dominantWavelengthNm,
      referenceWavelengthNm: this.referenceWavelengthNm,
      refractiveIndex: this.referenceRefractiveIndex,
      apparentRadiusDeg: observation.apparentRadiusDeg,
      rainbowRadiusDeg: observation.targetRadiusDeg,
      angularErrorDeg: observation.angularErrorDeg,
      distanceFromObserverM: observation.distanceFromObserverM,
      diameterMm: droplet.diameterMm,
      totalDroplets: field.totalDroplets,
      visibleDroplets: field.visibleDroplets,
      contributingDroplets: field.contributingDroplets,
      observerPositionM: field.observerPositionM.clone(),
      observerScenePosition: field.observerScenePosition.clone(),
      explicitlySelected: this.explicitlySelected
    };
  }

  hasExplicitSelection(): boolean {
    return this.explicitlySelected;
  }

  clearSelection(): FocusDropletSnapshot {
    this.explicitlySelected = false;
    this.applyZoom(this.frame);
    return this.getFocusSnapshot();
  }

  selectById(id: string): FocusDropletSnapshot | null {
    const selected = this.overview.selectById(id);
    return selected ? this.acceptSelection(selected) : null;
  }

  selectAdjacentContributor(direction: -1 | 1): FocusDropletSnapshot | null {
    const selected = this.overview.selectAdjacentContributor(direction);
    return selected ? this.acceptSelection(selected) : null;
  }

  selectContributorNearestWavelength(
    targetWavelengthNm: number,
    candidateOffset = 0
  ): FocusDropletSnapshot | null {
    const selected = this.overview.selectContributorNearestWavelength(
      targetWavelengthNm,
      candidateOffset
    );
    return selected ? this.acceptSelection(selected) : null;
  }

  selectContributorForViewDirection(
    viewDirection: THREE.Vector3,
    bandPaddingDeg = 0.45
  ): FocusDropletSnapshot | null {
    const selected = this.overview.selectContributorForViewDirection(
      viewDirection,
      bandPaddingDeg
    );
    return selected ? this.acceptSelection(selected) : null;
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
  ): FocusDropletSnapshot | null {
    const selected = this.overview.pickDroplet(
      camera,
      pointerX,
      pointerY,
      viewportWidth,
      viewportHeight,
      maximumDistancePx,
      candidateOffset,
      preferContributors
    );
    return selected ? this.acceptSelection(selected) : null;
  }

  getLastPickCandidateCount(): number {
    return this.overview.getLastPickCandidateCount();
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
    this.incomingWorldGeometry.dispose();
    this.incomingWorldMaterial.dispose();
    this.group.clear();
  }

  private acceptSelection(selection: RainbowOverviewSelection): FocusDropletSnapshot {
    this.selection = selection;
    this.explicitlySelected = true;
    this.updateSelectedDroplet();
    this.applyZoom(this.frame);
    return this.getFocusSnapshot();
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
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 12), coreMaterial);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 12), glowMaterial);
    core.name = "selected-drop-exact-field-position-core";
    glow.name = "selected-drop-exact-field-position-glow";
    this.marker.add(core, glow);
    this.markerMaterials.push(coreMaterial, glowMaterial);
  }

  private updateSelectedDroplet(): void {
    const observation = this.selection.observation;
    const sun = sunDirectionFromAngles(this.sunElevationDeg, this.sunAzimuthDeg);
    this.focusPosition.copy(this.selection.position);
    this.incomingDirection.set(-sun.x, -sun.y, -sun.z).normalize();
    const observerOrigin = this.overview.getObserverScenePosition();
    this.outgoingDirection.copy(observerOrigin).sub(this.focusPosition).normalize();

    this.referenceWavelengthNm =
      observation.dominantWavelengthNm ?? observation.nearestWavelengthNm;
    this.referenceRefractiveIndex =
      observation.refractiveIndex ?? observation.nearestRefractiveIndex;
    const lower = SPECTRAL_SAMPLES[observation.lowerSampleIndex];
    const upper = SPECTRAL_SAMPLES[observation.upperSampleIndex];
    const rayColor = observation.contributes
      ? new THREE.Color(lower?.color ?? "#ffffff").lerp(
          new THREE.Color(upper?.color ?? lower?.color ?? "#ffffff"),
          observation.colorMix
        )
      : new THREE.Color(0x98a9ae);

    this.detail.setRepresentative({
      wavelengthNm: this.referenceWavelengthNm,
      refractiveIndex: this.referenceRefractiveIndex,
      color: `#${rayColor.getHexString()}`,
      reachesObserver: observation.contributes
    });
    if (observation.contributes) {
      this.markerMaterials[0]?.color.copy(rayColor).lerp(new THREE.Color(0xffffff), 0.25);
    } else {
      this.markerMaterials[0]?.color.set(0xc4cdd0);
    }
    this.markerMaterials[1]?.color.copy(rayColor);
    this.focusGuideMaterial.color.set(observation.contributes ? rayColor : 0x7f9095);
    this.focusGuide.name = observation.contributes
      ? "selected-drop-to-fixed-observer-ray-direction-guide"
      : "observer-sightline-selected-drop-does-not-send-rainbow-ray";

    this.marker.position.copy(this.focusPosition);
    this.detail.group.position.copy(this.focusPosition);
    this.orientDetailToWorld();
    this.focusGuideGeometry.setFromPoints([observerOrigin, this.focusPosition]);
    this.focusGuideGeometry.computeBoundingSphere();
    this.focusGuide.computeLineDistances();
    this.incomingWorldGeometry.setFromPoints([
      this.focusPosition.clone().addScaledVector(this.incomingDirection, -5.5),
      this.focusPosition
    ]);
    this.incomingWorldGeometry.computeBoundingSphere();
  }

  private orientDetailToWorld(): void {
    const trace = traceDropletRay(this.referenceRefractiveIndex, this.order);
    const worldX = this.incomingDirection.clone().normalize();
    let worldPerpendicular = this.outgoingDirection
      .clone()
      .addScaledVector(worldX, -this.outgoingDirection.dot(worldX));
    if (worldPerpendicular.lengthSq() < 1e-12) {
      const helper = Math.abs(worldX.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      worldPerpendicular = new THREE.Vector3().crossVectors(worldX, helper);
    }
    worldPerpendicular.normalize();
    const localYSign = Math.sign(trace.outgoing.y) || 1;
    const worldY = worldPerpendicular.multiplyScalar(localYSign);
    const worldZ = new THREE.Vector3().crossVectors(worldX, worldY).normalize();
    const basis = new THREE.Matrix4().makeBasis(worldX, worldY, worldZ);
    this.detail.group.quaternion.setFromRotationMatrix(basis);
    this.representativeRayDirection
      .set(trace.outgoing.x, trace.outgoing.y, 0)
      .applyQuaternion(this.detail.group.quaternion)
      .normalize();
  }
}
