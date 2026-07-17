import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RAIN_FIELD_OPTIONS,
  generateRainField,
  observeRainDroplet,
  observeRainField,
  rainbowSpectrumMatch
} from "../src/physics/rainField.ts";
import { findStationaryRay, SPECTRAL_SAMPLES } from "../src/physics/rainbow.ts";
import { sunDirectionFromAngles } from "../src/physics/semanticZoom.ts";

test("the overview rain field has fixed unique IDs and deterministic positions", () => {
  const options = { seed: 0x12345678, dropletCount: 2_000 } as const;
  const first = generateRainField(options);
  const second = generateRainField(options);
  assert.deepEqual(first, second);
  assert.equal(first.length, 2_000);
  assert.equal(new Set(first.map((droplet) => droplet.id)).size, 2_000);
  first.forEach((droplet, index) => {
    assert.equal(droplet.index, index);
    assert.equal(droplet.id, `drop-${index.toString().padStart(6, "0")}`);
  });
});

test("moving the Sun changes classifications without moving or renaming droplets", () => {
  const droplets = generateRainField({ dropletCount: 8_000 });
  const before = droplets.map((droplet) => ({ id: droplet.id, positionM: droplet.positionM }));
  const first = observeRainField(
    droplets,
    DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM,
    sunDirectionFromAngles(12, 225),
    1
  );
  const second = observeRainField(
    droplets,
    DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM,
    sunDirectionFromAngles(28, 120),
    1
  );
  assert.deepEqual(
    droplets.map((droplet) => ({ id: droplet.id, positionM: droplet.positionM })),
    before
  );
  assert.notDeepEqual(
    first.filter((item) => item.contributes).map((item) => item.dropletId),
    second.filter((item) => item.contributes).map((item) => item.dropletId)
  );
});

test("every colored contributor is in the observer-centred spectral cone band", () => {
  const droplets = generateRainField({ dropletCount: 20_000 });
  for (const order of [1, 2] as const) {
    const observations = observeRainField(
      droplets,
      DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM,
      sunDirectionFromAngles(12, 225),
      order
    );
    const contributors = observations.filter((item) => item.contributes);
    assert.ok(contributors.length > 100, "the representative field should contain many contributors");
    for (const item of contributors) {
      assert.ok(item.dominantWavelengthNm !== null);
      assert.ok(item.refractiveIndex !== null);
      assert.ok(item.apparentRadiusDeg >= item.minimumRadiusDeg - 1e-10);
      assert.ok(item.apparentRadiusDeg <= item.maximumRadiusDeg + 1e-10);
      assert.ok(Math.abs(item.angularErrorDeg) < 1e-9);
      assert.ok(
        Math.abs(findStationaryRay(item.refractiveIndex!, order).radiusDeg - item.apparentRadiusDeg) < 1e-9
      );
    }
  }
});

test("a droplet near the antisolar centre is never labeled as a primary rainbow contributor", () => {
  const sun = sunDirectionFromAngles(0, 90);
  const observer = { x: 0, y: 0, z: 0 };
  const centreDroplet = {
    id: "drop-centre",
    index: 0,
    positionM: { x: -100, y: 0, z: 0 },
    diameterMm: 0.8
  };
  const observation = observeRainDroplet(centreDroplet, observer, sun, 1);
  assert.ok(observation.apparentRadiusDeg < 1e-10);
  assert.equal(observation.contributes, false);
  assert.equal(observation.dominantWavelengthNm, null);
});

test("the primary and secondary spectrum mappings preserve their opposite color order", () => {
  const red = SPECTRAL_SAMPLES.find((sample) => sample.wavelengthNm === 656.3)!;
  const violet = SPECTRAL_SAMPLES.find((sample) => sample.wavelengthNm === 404.7)!;
  const primaryRed = findStationaryRay(red.waterIndex, 1).radiusDeg;
  const primaryViolet = findStationaryRay(violet.waterIndex, 1).radiusDeg;
  const secondaryRed = findStationaryRay(red.waterIndex, 2).radiusDeg;
  const secondaryViolet = findStationaryRay(violet.waterIndex, 2).radiusDeg;
  assert.ok(primaryRed > primaryViolet);
  assert.ok(secondaryRed < secondaryViolet);
  assert.ok(Math.abs(rainbowSpectrumMatch(primaryRed, 1).dominantWavelengthNm! - 656.3) < 1e-7);
  assert.ok(Math.abs(rainbowSpectrumMatch(primaryViolet, 1).dominantWavelengthNm! - 404.7) < 1e-7);
  assert.ok(Math.abs(rainbowSpectrumMatch(secondaryRed, 2).dominantWavelengthNm! - 656.3) < 1e-7);
  assert.ok(Math.abs(rainbowSpectrumMatch(secondaryViolet, 2).dominantWavelengthNm! - 404.7) < 1e-7);
});

test("contributors occupy multiple depth bands instead of one invented rainbow distance", () => {
  const observations = observeRainField(
    generateRainField({ dropletCount: 30_000 }),
    DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM,
    sunDirectionFromAngles(12, 225),
    1
  ).filter((item) => item.contributes);
  const depthBands = new Set(
    observations.map((item) => Math.min(2, Math.floor((item.distanceFromObserverM - 80) / 74)))
  );
  assert.deepEqual([...depthBands].sort(), [0, 1, 2]);
});
