import assert from "node:assert/strict";
import test from "node:test";
import {
  HALO_CATALOG,
  HALO_SPECTRAL_SAMPLES,
  haloAngleRange,
  haloCatalogAtSunElevation,
  haloPhenomenonById,
  haloVisibleAtSunElevation,
  prismMinimumDeviationDeg,
  projectedSundogOffsetDeg
} from "../src/physics/halo.ts";
import { HaloOverview } from "../src/scenes/haloOverview.ts";

test("ice-prism minimum deviations reproduce the 22 and 46 degree halo ranges", () => {
  const halo22 = haloAngleRange("halo-22");
  const halo46 = haloAngleRange("halo-46");

  assert.ok(Math.abs(halo22.redDeg - 21.60) < 0.04);
  assert.ok(Math.abs(halo22.violetDeg - 22.55) < 0.04);
  assert.ok(Math.abs(halo46.redDeg - 45.07) < 0.05);
  assert.ok(Math.abs(halo46.violetDeg - 47.80) < 0.05);
  assert.ok(halo22.redDeg < halo22.violetDeg);
  assert.ok(halo46.redDeg < halo46.violetDeg);
});

test("the minimum-deviation formula rejects impossible or invalid prisms", () => {
  assert.throws(() => prismMinimumDeviationDeg(1, 60), /refractive index/);
  assert.throws(() => prismMinimumDeviationDeg(1.31, 0), /prism apex/);
  assert.throws(() => prismMinimumDeviationDeg(1.8, 90), /no symmetric transmitted ray/);
});

test("sundogs move outward as the Sun rises in the horizontal-plate projection", () => {
  const middle = HALO_SPECTRAL_SAMPLES[3];
  assert.ok(middle);
  const horizonOffset = projectedSundogOffsetDeg(middle.iceIndex, 0);
  const thirtyDegreeOffset = projectedSundogOffsetDeg(middle.iceIndex, 30);
  assert.ok(horizonOffset !== null);
  assert.ok(thirtyDegreeOffset !== null);
  assert.ok(Math.abs(horizonOffset - 21.89) < 0.06);
  assert.ok(thirtyDegreeOffset > horizonOffset + 5);
  assert.equal(projectedSundogOffsetDeg(middle.iceIndex, 70), null);
});

test("catalog keeps calculated rings separate from orientation-dependent schematics", () => {
  assert.equal(new Set(HALO_CATALOG.map(({ id }) => id)).size, HALO_CATALOG.length);
  assert.equal(haloPhenomenonById("halo-22").anglePlacement, "computed-minimum-deviation");
  assert.equal(haloPhenomenonById("halo-46").anglePlacement, "computed-minimum-deviation");
  assert.equal(haloPhenomenonById("sundog").anglePlacement, "projected-minimum-deviation");

  for (const id of [
    "circumzenithal-arc",
    "upper-tangent-arc",
    "circumhorizontal-arc"
  ] as const) {
    const phenomenon = haloPhenomenonById(id);
    assert.equal(phenomenon.anglePlacement, "representative-schematic");
    assert.match(phenomenon.modelNoticeJa, /模式表示|代表表示/);
  }

  for (const phenomenon of HALO_CATALOG) {
    assert.equal(phenomenon.rayGuideFidelity, "schematic-not-raytraced");
  }
});

test("crystal orientation distinguishes rings, plate arcs, and column arcs", () => {
  assert.equal(haloPhenomenonById("halo-22").orientation, "random");
  assert.equal(haloPhenomenonById("sundog").orientation, "horizontal-plate");
  assert.equal(haloPhenomenonById("circumzenithal-arc").orientation, "horizontal-plate");
  assert.equal(haloPhenomenonById("upper-tangent-arc").orientation, "horizontal-column");
});

test("solar-elevation gates expose the catalog constraints without hiding entries", () => {
  assert.ok(haloVisibleAtSunElevation("circumzenithal-arc", 30));
  assert.ok(!haloVisibleAtSunElevation("circumzenithal-arc", 33));
  assert.ok(!haloVisibleAtSunElevation("circumhorizontal-arc", 57));
  assert.ok(haloVisibleAtSunElevation("circumhorizontal-arc", 60));
  assert.throws(() => haloVisibleAtSunElevation("halo-22", -1), /sun elevation/);

  const catalog = haloCatalogAtSunElevation(20);
  assert.equal(catalog.length, HALO_CATALOG.length);
  assert.ok(catalog.some(({ phenomenon, availableAtSunElevation }) =>
    phenomenon.id === "circumzenithal-arc" && availableAtSunElevation));
  assert.ok(catalog.some(({ phenomenon, availableAtSunElevation }) =>
    phenomenon.id === "circumhorizontal-arc" && !availableAtSunElevation));
});

test("3D halo scene preserves crystals on Sun changes and exposes schematic warnings", () => {
  const scene = new HaloOverview();
  const crystalsBefore = scene.group.getObjectByName("ice-crystal-field-random");
  assert.ok(crystalsBefore);

  scene.setConditions("halo-22", 30, 45);
  const crystalsAfter = scene.group.getObjectByName("ice-crystal-field-random");
  assert.equal(crystalsAfter, crystalsBefore);

  scene.setConditions("circumzenithal-arc", 40, 45);
  const snapshot = scene.getSnapshot();
  assert.equal(snapshot.visibleAtCurrentSun, false);
  assert.match(snapshot.availabilityNoticeJa, /条件外/);
  assert.match(snapshot.referenceAngleNoticeJa, /角半径ではありません/);
  assert.match(snapshot.representativeRayGuideNoticeJa, /未計算/);
  assert.ok(scene.group.getObjectByName("90deg-prism-ray-schematic"));
  scene.dispose();
});
