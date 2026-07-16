import assert from "node:assert/strict";
import test from "node:test";
import {
  SPECTRAL_SAMPLES,
  findStationaryRay,
  prismMinimumDeviationDeg,
  rainbowAngleRange,
  reflect2D,
  refract2D,
  traceDropletRay
} from "../src/physics/rainbow.ts";

test("reflection preserves length and mirrors the normal component", () => {
  const reflected = reflect2D({ x: 1, y: -1 }, { x: 0, y: 1 });
  assert.ok(Math.abs(reflected.x - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(reflected.y - Math.SQRT1_2) < 1e-12);
});

test("Snell refraction bends a 30 degree ray toward the normal in water", () => {
  const incident = { x: Math.sin(Math.PI / 6), y: -Math.cos(Math.PI / 6) };
  const refracted = refract2D(incident, { x: 0, y: 1 }, 1, 1.333);
  assert.ok(refracted);
  const angle = Math.asin(Math.abs(refracted.x));
  assert.ok(Math.abs((angle * 180) / Math.PI - 22.03) < 0.03);
});

test("water-to-air total internal reflection is reported only above the critical angle", () => {
  const belowCritical = 47 * Math.PI / 180;
  const aboveCritical = 50 * Math.PI / 180;
  const normal = { x: 0, y: -1 };
  assert.ok(refract2D({ x: Math.sin(belowCritical), y: Math.cos(belowCritical) }, normal, 1.333, 1));
  assert.equal(
    refract2D({ x: Math.sin(aboveCritical), y: Math.cos(aboveCritical) }, normal, 1.333, 1),
    null
  );
});

test("representative red and violet rays reproduce the accepted rainbow ranges", () => {
  const primary = rainbowAngleRange(1);
  const secondary = rainbowAngleRange(2);
  assert.ok(Math.abs(primary.redDeg - 42.35) < 0.08);
  assert.ok(Math.abs(primary.violetDeg - 40.68) < 0.12);
  assert.ok(Math.abs(secondary.redDeg - 50.40) < 0.15);
  assert.ok(Math.abs(secondary.violetDeg - 53.41) < 0.18);
  assert.ok(primary.redDeg > primary.violetDeg, "primary red must be outside violet");
  assert.ok(secondary.redDeg < secondary.violetDeg, "secondary red must be inside violet");
});

test("primary and secondary traces contain exactly one and two internal reflections", () => {
  const middle = SPECTRAL_SAMPLES[3]!;
  const primary = traceDropletRay(middle.waterIndex, 1);
  const secondary = traceDropletRay(middle.waterIndex, 2);
  assert.equal(primary.internalReflections, 1);
  assert.equal(secondary.internalReflections, 2);
  assert.equal(primary.points.length, 5);
  assert.equal(secondary.points.length, 6);
  assert.ok(primary.refractionDeg < 48.6);
  assert.ok(secondary.refractionDeg < 48.6);
});

test("stationary 589 nm-like ray gives the expected geometric angles", () => {
  const primary = findStationaryRay(1.333, 1);
  const secondary = findStationaryRay(1.333, 2);
  assert.ok(Math.abs(primary.radiusDeg - 42.08) < 0.03);
  assert.ok(Math.abs(secondary.radiusDeg - 50.89) < 0.03);
  assert.ok(Math.abs(primary.incidenceDeg - 59.41) < 0.05);
  assert.ok(Math.abs(secondary.incidenceDeg - 71.84) < 0.05);
});

test("hexagonal ice prism minimum deviations support 22 and 46 degree halos", () => {
  assert.ok(Math.abs(prismMinimumDeviationDeg(1.3106, 60) - 21.89) < 0.05);
  assert.ok(Math.abs(prismMinimumDeviationDeg(1.3106, 90) - 45.87) < 0.05);
});
