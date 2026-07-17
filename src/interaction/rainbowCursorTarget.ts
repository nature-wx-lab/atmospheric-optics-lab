import * as THREE from "three";
import { rainbowAngleRange, type RainbowOrder } from "../physics/rainbow";
import { rainbowSpectrumMatch } from "../physics/rainField";
import {
  buildRainbowRadianceProfile,
  type RainbowRadianceProfile,
  type RainbowRadianceSample
} from "../physics/rainbowRadiance";
import { sunDirectionFromAngles } from "../physics/semanticZoom";

export interface RainbowCursorBand {
  readonly order: RainbowOrder;
  readonly apparentRadiusDeg: number;
  /** Radius of the real stationary-ray contributor represented by this pixel. */
  readonly targetRadiusDeg: number;
  /** Wavelength of that contributor, not the colour of the water drop itself. */
  readonly targetWavelengthNm: number;
  /** Same display alpha used by the rendered far-field bow. */
  readonly effectiveRadianceAlpha: number;
}

export interface CanvasViewportRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const RADIANCE_SAMPLE_COUNT = 144;
const MINIMUM_INTERACTIVE_RADIANCE_ALPHA = 0.018;
const radianceProfiles = new Map<RainbowOrder, RainbowRadianceProfile>();

function radianceProfile(order: RainbowOrder): RainbowRadianceProfile {
  const cached = radianceProfiles.get(order);
  if (cached) return cached;
  const profile = buildRainbowRadianceProfile(order, RADIANCE_SAMPLE_COUNT);
  radianceProfiles.set(order, profile);
  return profile;
}

function nearestRadianceSample(
  profile: RainbowRadianceProfile,
  radiusDeg: number
): RainbowRadianceSample | null {
  if (
    radiusDeg < profile.minimumRadiusDeg ||
    radiusDeg > profile.maximumRadiusDeg
  ) {
    return null;
  }
  let nearest = profile.samples[0];
  if (!nearest) return null;
  for (const sample of profile.samples) {
    if (Math.abs(sample.radiusDeg - radiusDeg) < Math.abs(nearest.radiusDeg - radiusDeg)) {
      nearest = sample;
    }
  }
  return nearest;
}

function smoothUnit(value: number): number {
  const unit = THREE.MathUtils.clamp(value, 0, 1);
  return unit * unit * (3 - 2 * unit);
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

/** Convert browser client coordinates using the canvas' real page offset. */
export function viewDirectionFromClientPoint(
  camera: THREE.PerspectiveCamera,
  clientX: number,
  clientY: number,
  viewport: CanvasViewportRect
): THREE.Vector3 | null {
  return viewDirectionFromCanvasPoint(
    camera,
    clientX - viewport.left,
    clientY - viewport.top,
    viewport.width,
    viewport.height
  );
}

/**
 * Classify the cursor ray against the same integrated radiance profiles that
 * draw the far-field bow. This keeps a pixel that visibly belongs to the red
 * or violet fringe interactive, while still rejecting dark sky. The faint
 * profile outside the point-Sun stationary interval is mapped to the nearest
 * physical edge contributor instead of inventing a non-contributing drop.
 */
export function rainbowBandAtViewDirection(
  viewDirection: THREE.Vector3,
  sunElevationDeg: number,
  sunAzimuthDeg: number,
  minimumInteractiveAlpha = MINIMUM_INTERACTIVE_RADIANCE_ALPHA
): RainbowCursorBand | null {
  if (
    viewDirection.lengthSq() < 1e-12 ||
    !Number.isFinite(minimumInteractiveAlpha) ||
    minimumInteractiveAlpha < 0
  ) {
    return null;
  }
  const direction = viewDirection.clone().normalize();
  const sun = sunDirectionFromAngles(sunElevationDeg, sunAzimuthDeg);
  const antisolar = new THREE.Vector3(-sun.x, -sun.y, -sun.z).normalize();
  const apparentRadiusDeg = THREE.MathUtils.radToDeg(
    Math.acos(THREE.MathUtils.clamp(direction.dot(antisolar), -1, 1))
  );
  // This is the same horizon fade used when constructing the rainbow mesh.
  const horizonVisibility = smoothUnit((direction.y + 0.012) / 0.04);
  const candidates = ([1, 2] as const)
    .map((order) => {
      const sample = nearestRadianceSample(radianceProfile(order), apparentRadiusDeg);
      const opacityScale = order === 1 ? 1 : 0.46;
      const effectiveRadianceAlpha = (sample?.alpha ?? 0) * opacityScale * horizonVisibility;
      const range = rainbowAngleRange(order);
      const targetRadiusDeg = THREE.MathUtils.clamp(
        apparentRadiusDeg,
        range.minimumDeg,
        range.maximumDeg
      );
      const spectrum = rainbowSpectrumMatch(targetRadiusDeg, order);
      return {
        order,
        effectiveRadianceAlpha,
        targetRadiusDeg,
        targetWavelengthNm: spectrum.dominantWavelengthNm ?? spectrum.nearestWavelengthNm
      };
    })
    .filter((candidate) => candidate.effectiveRadianceAlpha >= minimumInteractiveAlpha)
    .sort(
      (first, second) =>
        second.effectiveRadianceAlpha - first.effectiveRadianceAlpha ||
        first.order - second.order
    );
  const selected = candidates[0];
  return selected ? { ...selected, apparentRadiusDeg } : null;
}
