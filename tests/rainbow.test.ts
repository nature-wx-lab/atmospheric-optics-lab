import assert from "node:assert/strict";
import test from "node:test";
import {
  SPECTRAL_SAMPLES,
  findStationaryRay,
  fresnelPower,
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

test("analytic stationary ray is a local extremum of the deviation", () => {
  for (const order of [1, 2] as const) {
    const ray = findStationaryRay(1.333, order);
    const incidence = ray.incidenceDeg * Math.PI / 180;
    const delta = 1e-5;
    const center = order === 1
      ? 4 * Math.asin(Math.sin(incidence) / 1.333) - 2 * incidence
      : Math.PI + 2 * incidence - 6 * Math.asin(Math.sin(incidence) / 1.333);
    const left = order === 1
      ? 4 * Math.asin(Math.sin(incidence - delta) / 1.333) - 2 * (incidence - delta)
      : Math.PI + 2 * (incidence - delta) -
        6 * Math.asin(Math.sin(incidence - delta) / 1.333);
    const right = order === 1
      ? 4 * Math.asin(Math.sin(incidence + delta) / 1.333) - 2 * (incidence + delta)
      : Math.PI + 2 * (incidence + delta) -
        6 * Math.asin(Math.sin(incidence + delta) / 1.333);
    assert.ok(order === 1 ? center > left && center > right : center < left && center < right);
  }
});

test("rainbow internal reflection is partial and conserves Fresnel power", () => {
  const primary = findStationaryRay(1.333, 1);
  const power = fresnelPower(primary.refractionDeg, 1.333, 1);
  assert.ok(Math.abs(power.sReflectance - 0.111) < 0.002);
  assert.ok(Math.abs(power.pReflectance - 0.0035) < 0.0003);
  assert.ok(power.unpolarizedReflectance > 0 && power.unpolarizedReflectance < 1);
  assert.ok(
    Math.abs(power.unpolarizedReflectance + power.unpolarizedTransmittance - 1) < 1e-12
  );
});

test("each internal reflection has a transmitted loss branch", () => {
  const middle = SPECTRAL_SAMPLES[3]!;
  assert.equal(traceDropletRay(middle.waterIndex, 1).lossBranches.length, 1);
  assert.equal(traceDropletRay(middle.waterIndex, 2).lossBranches.length, 2);
});

test("hexagonal ice prism minimum deviations support 22 and 46 degree halos", () => {
  assert.ok(Math.abs(prismMinimumDeviationDeg(1.3106, 60) - 21.89) < 0.05);
  assert.ok(Math.abs(prismMinimumDeviationDeg(1.3106, 90) - 45.87) < 0.05);
});
