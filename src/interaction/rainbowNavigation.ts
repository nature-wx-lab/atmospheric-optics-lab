export type RainbowMode = "approach" | "move" | "external";

export type RainbowZoomAction =
  | "semantic-zoom"
  | "inspection-forward"
  | "physical-observer-move";

export const RAINBOW_SEMANTIC_ZOOM_STEP = 0.075;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function zoomAmountFromButtonMultiplier(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier === 1) return 0;
  return multiplier < 1
    ? RAINBOW_SEMANTIC_ZOOM_STEP
    : -RAINBOW_SEMANTIC_ZOOM_STEP;
}

export function zoomAmountFromWheelPixels(pixelDelta: number): number {
  if (!Number.isFinite(pixelDelta)) return 0;
  return clamp(
    -pixelDelta * 0.00065,
    -RAINBOW_SEMANTIC_ZOOM_STEP,
    RAINBOW_SEMANTIC_ZOOM_STEP
  );
}

/** Pinch distance is compared with the previous event, not the gesture start. */
export function zoomAmountFromPinchDistances(
  currentDistance: number,
  previousDistance: number
): number {
  if (
    !Number.isFinite(currentDistance) ||
    !Number.isFinite(previousDistance) ||
    currentDistance <= 0 ||
    previousDistance <= 0
  ) return 0;
  return clamp(
    Math.log(currentDistance / previousDistance) * 0.48,
    -RAINBOW_SEMANTIC_ZOOM_STEP,
    RAINBOW_SEMANTIC_ZOOM_STEP
  );
}

export interface RainbowZoomIntent {
  readonly mode: RainbowMode;
  readonly progress: number;
  readonly hasExplicitSelection: boolean;
  /** Positive values zoom in; negative values zoom out. */
  readonly amount: number;
  readonly rainFieldBoundary: number;
}

/**
 * Keep the meaning of every zoom surface identical.
 *
 * In the fixed-observer approach, zooming in at the unselected rain field may
 * move the inspection camera forward. Zooming out must always return to the
 * semantic rainbow path; it must never become free-flight backwards.
 */
export function resolveRainbowZoomAction(intent: RainbowZoomIntent): RainbowZoomAction {
  if (intent.mode === "move") return "physical-observer-move";
  if (
    intent.mode === "approach" &&
    !intent.hasExplicitSelection &&
    intent.progress >= intent.rainFieldBoundary - 1e-6 &&
    intent.amount > 0
  ) {
    return "inspection-forward";
  }
  return "semantic-zoom";
}
