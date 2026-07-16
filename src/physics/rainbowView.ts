import { degrees, radians, rainbowAngleRange, type RainbowOrder } from "./rainbow.ts";
import {
  sunDirectionFromAngles,
  type Vec3Like
} from "./semanticZoom.ts";

const DEFAULT_RAINBOW_PADDING_DEG = 8;
const DEFAULT_MAX_VERTICAL_FOV_DEG = 92;
const MIN_OBSERVER_HORIZONTAL_FOV_DEG = 78;
const MAX_OBSERVER_HORIZONTAL_FOV_DEG = 112;

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

/**
 * Returns the observer's default view direction toward the antisolar sky.
 *
 * `aimElevationDeg` is measured above the astronomical horizon. The horizontal
 * component is derived from the current Sun vector so it follows the same
 * azimuth convention as the rest of the simulation.
 */
export function defaultObserverLookDirection(
  sunElevationDeg: number,
  sunAzimuthDeg: number,
  aimElevationDeg = 14
): Vec3Like {
  const sun = sunDirectionFromAngles(
    requireFinite(sunElevationDeg, "sun elevation"),
    requireFinite(sunAzimuthDeg, "sun azimuth")
  );
  const aimElevation = radians(requireFinite(aimElevationDeg, "aim elevation"));
  const horizontalLength = Math.hypot(sun.x, sun.z);
  const fallbackAzimuth = radians(sunAzimuthDeg);
  const antisolarX =
    horizontalLength > 1e-12 ? -sun.x / horizontalLength : -Math.sin(fallbackAzimuth);
  const antisolarZ =
    horizontalLength > 1e-12 ? -sun.z / horizontalLength : -Math.cos(fallbackAzimuth);
  const horizontalScale = Math.cos(aimElevation);

  return {
    x: antisolarX * horizontalScale,
    y: Math.sin(aimElevation),
    z: antisolarZ * horizontalScale
  };
}

/**
 * Horizontal field of view needed to contain the above-horizon rainbow arc.
 *
 * The horizon intersections obey cos(radius) = cos(sun elevation) cos(azimuth
 * offset). Padding is the total extra field of view, shared by both sides.
 */
export function horizontalRainbowFovDeg(
  order: RainbowOrder,
  sunElevationDeg: number,
  paddingDeg = DEFAULT_RAINBOW_PADDING_DEG
): number {
  const sunElevation = requireFinite(sunElevationDeg, "sun elevation");
  const padding = requireFinite(paddingDeg, "padding");
  if (sunElevation < 0 || sunElevation > 90) {
    throw new RangeError("sun elevation must be between 0 and 90 degrees");
  }
  if (padding < 0) throw new RangeError("padding must not be negative");

  const radius = rainbowAngleRange(order).maximumDeg;
  if (sunElevation >= radius) return MIN_OBSERVER_HORIZONTAL_FOV_DEG;

  const horizonRatio = Math.cos(radians(radius)) / Math.cos(radians(sunElevation));
  const halfSpanDeg = degrees(Math.acos(Math.min(1, Math.max(-1, horizonRatio))));
  return Math.min(
    MAX_OBSERVER_HORIZONTAL_FOV_DEG,
    Math.max(MIN_OBSERVER_HORIZONTAL_FOV_DEG, 2 * halfSpanDeg + padding)
  );
}

/**
 * Converts a perspective camera's horizontal field of view to vertical field
 * of view. An invalid aspect ratio falls back to the conservative vertical cap
 * so a transient zero-sized viewport cannot produce NaN camera state.
 */
export function verticalFovFromHorizontal(
  horizontalFovDeg: number,
  aspect: number,
  maxVerticalDeg = DEFAULT_MAX_VERTICAL_FOV_DEG
): number {
  const horizontal = requireFinite(horizontalFovDeg, "horizontal field of view");
  const maximum = requireFinite(maxVerticalDeg, "maximum vertical field of view");
  if (!(horizontal > 0 && horizontal < 180)) {
    throw new RangeError("horizontal field of view must be between 0 and 180 degrees");
  }
  if (!(maximum > 0 && maximum < 180)) {
    throw new RangeError("maximum vertical field of view must be between 0 and 180 degrees");
  }
  if (!(aspect > 0) || !Number.isFinite(aspect)) return maximum;

  const vertical = degrees(
    2 * Math.atan(Math.tan(radians(horizontal) / 2) / aspect)
  );
  return Math.min(maximum, vertical);
}

export function observerRainbowVerticalFovDeg(
  order: RainbowOrder,
  sunElevationDeg: number,
  aspect: number
): number {
  return verticalFovFromHorizontal(
    horizontalRainbowFovDeg(order, sunElevationDeg),
    aspect
  );
}
