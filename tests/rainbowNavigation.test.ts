import assert from "node:assert/strict";
import test from "node:test";
import {
  RAINBOW_SEMANTIC_ZOOM_STEP,
  resolveRainbowZoomAction,
  zoomAmountFromButtonMultiplier,
  zoomAmountFromPinchDistances,
  zoomAmountFromWheelPixels
} from "../src/interaction/rainbowNavigation.ts";

const boundary = 0.47;

test("zooming out from the unselected rain field always returns to semantic zoom", () => {
  assert.equal(
    resolveRainbowZoomAction({
      mode: "approach",
      progress: boundary,
      hasExplicitSelection: false,
      amount: -0.08,
      rainFieldBoundary: boundary
    }),
    "semantic-zoom"
  );
});

test("zooming in at the unselected rain field moves only the inspection camera", () => {
  assert.equal(
    resolveRainbowZoomAction({
      mode: "approach",
      progress: boundary,
      hasExplicitSelection: false,
      amount: 0.08,
      rainFieldBoundary: boundary
    }),
    "inspection-forward"
  );
});

test("selected and external views keep both zoom directions on the semantic path", () => {
  for (const amount of [-0.08, 0.08]) {
    assert.equal(
      resolveRainbowZoomAction({
        mode: "approach",
        progress: boundary,
        hasExplicitSelection: true,
        amount,
        rainFieldBoundary: boundary
      }),
      "semantic-zoom"
    );
    assert.equal(
      resolveRainbowZoomAction({
        mode: "external",
        progress: boundary,
        hasExplicitSelection: false,
        amount,
        rainFieldBoundary: boundary
      }),
      "semantic-zoom"
    );
  }
});

test("observer-move mode reserves every zoom direction for the physical observer", () => {
  for (const amount of [-0.08, 0.08]) {
    assert.equal(
      resolveRainbowZoomAction({
        mode: "move",
        progress: 0,
        hasExplicitSelection: false,
        amount,
        rainFieldBoundary: boundary
      }),
      "physical-observer-move"
    );
  }
});

test("button, wheel, and incremental pinch adapters preserve the same zoom sign", () => {
  assert.equal(zoomAmountFromButtonMultiplier(0.9), RAINBOW_SEMANTIC_ZOOM_STEP);
  assert.equal(zoomAmountFromButtonMultiplier(1.1), -RAINBOW_SEMANTIC_ZOOM_STEP);
  assert.ok(zoomAmountFromWheelPixels(-100) > 0);
  assert.ok(zoomAmountFromWheelPixels(100) < 0);
  assert.ok(zoomAmountFromPinchDistances(110, 100) > 0);
  assert.ok(zoomAmountFromPinchDistances(90, 100) < 0);
});

test("pinch uses only the latest event delta and cannot reuse pre-boundary travel", () => {
  const firstIncrement = zoomAmountFromPinchDistances(140, 100);
  const nextIncrement = zoomAmountFromPinchDistances(141, 140);
  assert.equal(firstIncrement, RAINBOW_SEMANTIC_ZOOM_STEP);
  assert.ok(nextIncrement > 0);
  assert.ok(nextIncrement < firstIncrement / 10);
});

test("all zoom adapters cap a single semantic step to avoid a visible jump", () => {
  assert.equal(zoomAmountFromWheelPixels(-10_000), RAINBOW_SEMANTIC_ZOOM_STEP);
  assert.equal(zoomAmountFromWheelPixels(10_000), -RAINBOW_SEMANTIC_ZOOM_STEP);
  assert.equal(zoomAmountFromPinchDistances(10_000, 1), RAINBOW_SEMANTIC_ZOOM_STEP);
  assert.equal(zoomAmountFromPinchDistances(1, 10_000), -RAINBOW_SEMANTIC_ZOOM_STEP);
});
