import assert from "node:assert/strict";
import test from "node:test";
import { rainbowAngleRange } from "../src/physics/rainbow.ts";
import {
  defaultObserverLookDirection,
  horizontalRainbowFovDeg,
  observerRainbowVerticalFovDeg,
  verticalFovFromHorizontal
} from "../src/physics/rainbowView.ts";
import { sunDirectionFromAngles } from "../src/physics/semanticZoom.ts";

test("default observer direction is normalized and points toward the antisolar azimuth", () => {
  const sun = sunDirectionFromAngles(12, 225);
  const look = defaultObserverLookDirection(12, 225);
  const length = Math.hypot(look.x, look.y, look.z);
  const sunHorizontalLength = Math.hypot(sun.x, sun.z);
  const lookHorizontalLength = Math.hypot(look.x, look.z);
  const antisolarAlignment =
    (look.x * -sun.x + look.z * -sun.z) /
    (lookHorizontalLength * sunHorizontalLength);

  assert.ok(Math.abs(length - 1) < 1e-12);
  assert.ok(antisolarAlignment > 1 - 1e-12);
  assert.ok(Math.abs(look.y - Math.sin(4 * Math.PI / 180)) < 1e-12);
});

test("default primary-rainbow horizontal field of view is about 90 degrees", () => {
  const horizontalFov = horizontalRainbowFovDeg(1, 12);
  assert.ok(horizontalFov >= 86 && horizontalFov <= 96, `${horizontalFov}°`);
});

test("desktop and mobile vertical fields of view contain the visible primary arc", () => {
  const sunElevation = 12;
  const visibleArcHeight = rainbowAngleRange(1).maximumDeg - sunElevation;
  const desktopFov = observerRainbowVerticalFovDeg(1, sunElevation, 16 / 9);
  const mobileCanvasAspect = 374 / 300;
  const mobileFov = observerRainbowVerticalFovDeg(
    1,
    sunElevation,
    mobileCanvasAspect
  );
  const mobileHorizontalFov =
    2 *
    Math.atan(
      Math.tan((mobileFov * Math.PI) / 360) * mobileCanvasAspect
    ) *
    180 /
    Math.PI;

  assert.ok(desktopFov > visibleArcHeight);
  assert.ok(mobileFov > visibleArcHeight);
  assert.ok(mobileFov >= desktopFov);
  assert.ok(mobileFov <= 92);
  assert.ok(mobileHorizontalFov >= horizontalRainbowFovDeg(1, sunElevation) - 0.1);
});

test("observer view stays wide when the rainbow cone is below the visible sky", () => {
  assert.ok(horizontalRainbowFovDeg(1, 60) >= 78);
});

test("invalid viewport aspect ratios use the safe vertical field-of-view cap", () => {
  assert.equal(verticalFovFromHorizontal(90, 0), 92);
  assert.equal(verticalFovFromHorizontal(90, Number.NaN), 92);
  assert.equal(verticalFovFromHorizontal(90, Number.POSITIVE_INFINITY, 80), 80);
});
