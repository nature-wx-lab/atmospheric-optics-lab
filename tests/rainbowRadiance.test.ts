import assert from "node:assert/strict";
import test from "node:test";
import { rainbowAngleRange } from "../src/physics/rainbow.ts";
import { buildRainbowRadianceProfile } from "../src/physics/rainbowRadiance.ts";

function nearestSample(
  profile: ReturnType<typeof buildRainbowRadianceProfile>,
  radiusDeg: number
) {
  return profile.samples.reduce((nearest, sample) =>
    Math.abs(sample.radiusDeg - radiusDeg) <
    Math.abs(nearest.radiusDeg - radiusDeg)
      ? sample
      : nearest
  );
}

test("far-field rainbow radiance is a continuous band rather than isolated wavelengths", () => {
  const profile = buildRainbowRadianceProfile(1, 256);
  const range = rainbowAngleRange(1);
  const band = profile.samples.filter(
    (sample) =>
      sample.radiusDeg >= range.minimumDeg &&
      sample.radiusDeg <= range.maximumDeg
  );

  assert.equal(profile.samples.length, 256);
  assert.ok(profile.minimumRadiusDeg < range.minimumDeg);
  assert.ok(profile.maximumRadiusDeg > range.maximumDeg);
  assert.ok(Math.max(...profile.samples.map((sample) => sample.alpha)) > 0.6);
  assert.ok(Math.max(...profile.samples.slice(0, 8).map((sample) => sample.alpha)) < 0.08);
  assert.ok(Math.max(...profile.samples.slice(-8).map((sample) => sample.alpha)) < 0.08);
  assert.ok(band.length > 50);
  assert.ok(
    Math.min(...band.map((sample) => sample.alpha)) > 0.08,
    "the visible spectral span must not contain transparent gaps"
  );
});

test("primary bow keeps red outside and blue-violet inside after spectral integration", () => {
  const range = rainbowAngleRange(1);
  const profile = buildRainbowRadianceProfile(1, 256);
  const outer = nearestSample(profile, range.redDeg);
  const inner = nearestSample(profile, range.violetDeg);

  assert.ok(range.redDeg > range.violetDeg);
  assert.ok(outer.r > inner.r);
  assert.ok(inner.b > outer.b);
  assert.ok(outer.alpha > 0.1);
  assert.ok(inner.alpha > 0.1);
});

test("secondary bow reverses the radial spectral order", () => {
  const range = rainbowAngleRange(2);
  const profile = buildRainbowRadianceProfile(2, 256);
  const innerRed = nearestSample(profile, range.redDeg);
  const outerViolet = nearestSample(profile, range.violetDeg);

  assert.ok(range.redDeg < range.violetDeg);
  assert.ok(innerRed.r > outerViolet.r);
  assert.ok(outerViolet.b > innerRed.b);
  assert.ok(Math.max(...profile.samples.map((sample) => sample.alpha)) > 0.35);
});
