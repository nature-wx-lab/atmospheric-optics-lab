import * as THREE from "three";
import { rainbowAngleRange, type RainbowOrder } from "../physics/rainbow";
import { sunDirectionFromAngles } from "../physics/semanticZoom";

export interface RainbowCursorBand {
  readonly order: RainbowOrder;
  readonly apparentRadiusDeg: number;
}

/** Convert one canvas position into the exact world-space viewing direction. */
export function viewDirectionFromCanvasPoint(
  camera: THREE.PerspectiveCamera,
  pointerX: number,
  pointerY: number,
  viewportWidth: number,
  viewportHeight: number
): THREE.Vector3 | null {
  if (
    !(viewportWidth > 0) ||
    !(viewportHeight > 0) ||
    !Number.isFinite(pointerX) ||
    !Number.isFinite(pointerY)
  ) {
    return null;
  }
  camera.updateMatrixWorld();
  const worldPoint = new THREE.Vector3(
    (pointerX / viewportWidth) * 2 - 1,
    1 - (pointerY / viewportHeight) * 2,
    0.5
  ).unproject(camera);
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
  const direction = worldPoint.sub(cameraPosition);
  return direction.lengthSq() > 1e-12 ? direction.normalize() : null;
}

/**
 * Classify the cursor ray against the observer-centred primary/secondary
 * caustic bands. A point outside both bands must not be assigned a rainbow
 * droplet merely because some projected particle happens to be nearby.
 */
export function rainbowBandAtViewDirection(
  viewDirection: THREE.Vector3,
  sunElevationDeg: number,
  sunAzimuthDeg: number,
  paddingDeg = 0.45
): RainbowCursorBand | null {
  if (viewDirection.lengthSq() < 1e-12 || !Number.isFinite(paddingDeg)) return null;
  const sun = sunDirectionFromAngles(sunElevationDeg, sunAzimuthDeg);
  const antisolar = new THREE.Vector3(-sun.x, -sun.y, -sun.z).normalize();
  const apparentRadiusDeg = THREE.MathUtils.radToDeg(
    Math.acos(THREE.MathUtils.clamp(viewDirection.clone().normalize().dot(antisolar), -1, 1))
  );
  const candidates = ([1, 2] as const)
    .map((order) => {
      const range = rainbowAngleRange(order);
      const distanceDeg = apparentRadiusDeg < range.minimumDeg
        ? range.minimumDeg - apparentRadiusDeg
        : apparentRadiusDeg > range.maximumDeg
          ? apparentRadiusDeg - range.maximumDeg
          : 0;
      return { order, distanceDeg };
    })
    .filter((candidate) => candidate.distanceDeg <= Math.max(0, paddingDeg))
    .sort((first, second) => first.distanceDeg - second.distanceDeg || first.order - second.order);
  const selected = candidates[0];
  return selected ? { order: selected.order, apparentRadiusDeg } : null;
}
