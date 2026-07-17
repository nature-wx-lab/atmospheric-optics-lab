import * as THREE from "three";
import {
  RAIN_FIELD_APPROACH_END,
  RAIN_FIELD_METERS_TO_SCENE_UNITS,
  fieldApproachBlend,
  fieldInspectionTravelM,
  selectedDropTravelBlend,
  selectedDropTurnBlend
} from "./semanticZoom";

export interface InspectionCameraPath {
  readonly origin: THREE.Vector3;
  readonly pathDirection: THREE.Vector3;
  readonly freeOffset: THREE.Vector3;
  readonly overviewGazeDirection: THREE.Vector3;
  readonly fieldGazeDirection: THREE.Vector3;
}

export interface SelectedDropCameraTarget {
  readonly endPosition: THREE.Vector3;
  readonly endForward: THREE.Vector3;
  readonly anchorPosition?: THREE.Vector3 | null;
  readonly anchorForward?: THREE.Vector3 | null;
}

export interface RainbowApproachPathPose {
  readonly position: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly turnBlend: number;
  readonly travelBlend: number;
}

export function shouldCaptureDropApproachAnchor(progress: number): boolean {
  return Math.abs(progress - RAIN_FIELD_APPROACH_END) <= 1e-6;
}

function normalized(vector: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 {
  return vector.lengthSq() > 1e-12 ? vector.clone().normalize() : fallback.clone().normalize();
}

export function slerpCameraDirection(
  start: THREE.Vector3,
  end: THREE.Vector3,
  progress: number
): THREE.Vector3 {
  const forward = new THREE.Vector3(0, 0, -1);
  const startQuaternion = new THREE.Quaternion().setFromUnitVectors(
    forward,
    normalized(start, forward)
  );
  const endQuaternion = new THREE.Quaternion().setFromUnitVectors(
    forward,
    normalized(end, forward)
  );
  startQuaternion.slerp(endQuaternion, THREE.MathUtils.clamp(progress, 0, 1));
  return forward.applyQuaternion(startQuaternion).normalize();
}

export function inspectionCameraPosition(
  path: InspectionCameraPath,
  progress: number
): THREE.Vector3 {
  return path.origin
    .clone()
    .addScaledVector(
      normalized(path.pathDirection, path.overviewGazeDirection),
      fieldInspectionTravelM(progress) * RAIN_FIELD_METERS_TO_SCENE_UNITS
    )
    .addScaledVector(path.freeOffset, fieldApproachBlend(progress));
}

/**
 * Every selected and unselected camera shares exactly the same rain-field path
 * through 47%. A selected ID can influence the camera only after that boundary.
 */
export function rainbowApproachPathPose(
  path: InspectionCameraPath,
  progress: number,
  selected: SelectedDropCameraTarget | null
): RainbowApproachPathPose {
  const value = THREE.MathUtils.clamp(progress, 0, 1);
  const overviewGaze = normalized(path.overviewGazeDirection, path.pathDirection);
  const fieldGaze = normalized(path.fieldGazeDirection, overviewGaze);
  const gaze = slerpCameraDirection(
    overviewGaze,
    fieldGaze,
    fieldApproachBlend(value)
  );
  const fieldPosition = inspectionCameraPosition(path, value);
  if (!selected || value <= RAIN_FIELD_APPROACH_END) {
    return {
      position: fieldPosition,
      forward: gaze,
      turnBlend: 0,
      travelBlend: 0
    };
  }

  const turnBlend = selectedDropTurnBlend(value);
  const travelBlend = selectedDropTravelBlend(value);
  const anchorPosition = selected.anchorPosition?.clone() ??
    inspectionCameraPosition(path, RAIN_FIELD_APPROACH_END);
  const anchorForward = selected.anchorForward ?? gaze;
  return {
    position: anchorPosition.lerp(selected.endPosition, travelBlend),
    forward: slerpCameraDirection(anchorForward, selected.endForward, turnBlend),
    turnBlend,
    travelBlend
  };
}
