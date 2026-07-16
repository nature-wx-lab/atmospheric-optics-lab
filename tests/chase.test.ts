import assert from "node:assert/strict";
import test from "node:test";
import {
  RainbowChaseModel,
  apparentRadiusFromAntisolarDeg,
  compareChaseSnapshots,
  generateChaseDropletField,
  observerPathDirectionForChase,
  sunDirectionForChase
} from "../src/physics/chase.ts";

test("the fixed rain field is deterministic for a seed", () => {
  const options = { seed: 0x1234abcd, dropletCount: 250 } as const;
  const first = generateChaseDropletField(options);
  const second = generateChaseDropletField(options);
  assert.deepEqual(first, second);
  assert.equal(first.length, 250);
  assert.equal(new Set(first.map((droplet) => droplet.id)).size, 250);
});

test("moving 0 to 500 m preserves rainbow angle while changing contributors", () => {
  const model = new RainbowChaseModel();
  const start = model.snapshot(0);
  const middle = model.snapshot(250);
  const end = model.snapshot(500);

  assert.equal(start.rainbowRadiusDeg, middle.rainbowRadiusDeg);
  assert.equal(middle.rainbowRadiusDeg, end.rainbowRadiusDeg);
  assert.ok(start.contributingDroplets.length > 0);
  assert.ok(middle.contributingDroplets.length > 0);
  assert.ok(end.contributingDroplets.length > 0);

  const transition = compareChaseSnapshots(start, end);
  assert.equal(transition.angleChangeDeg, 0);
  assert.equal(transition.contributingSetChanged, true);
  assert.ok(transition.enteredIds.length > 0);
  assert.ok(transition.exitedIds.length > 0);
  assert.ok(transition.overlapFraction >= 0 && transition.overlapFraction <= 1);
});

test("the model reports range uncertainty instead of inventing a rainbow distance", () => {
  const snapshot = new RainbowChaseModel().snapshot(200);
  assert.equal(snapshot.distanceResolvedByRainbowAngle, false);
  assert.match(snapshot.modelStatement, /角度だけでは虹までの距離.*決まりません/);
  assert.notEqual(snapshot.sampledDistanceRangeM.minimum, null);
  assert.notEqual(snapshot.sampledDistanceRangeM.maximum, null);
  assert.ok(
    (snapshot.sampledDistanceRangeM.maximum ?? 0) -
      (snapshot.sampledDistanceRangeM.minimum ?? 0) >
      100,
    "many distances should satisfy the same angular condition"
  );
});

test("every selected droplet lies within the declared angular tolerance", () => {
  const model = new RainbowChaseModel({ angularToleranceDeg: 0.35 });
  const snapshot = model.snapshot(375);
  assert.ok(snapshot.contributingDroplets.length > 0);
  for (const droplet of snapshot.contributingDroplets) {
    assert.ok(Math.abs(droplet.angularErrorDeg) <= 0.35 + Number.EPSILON);
    assert.ok(Math.abs(droplet.apparentRadiusDeg - snapshot.rainbowRadiusDeg) <= 0.35 + Number.EPSILON);
  }
});

test("same observer position has no contributor transition", () => {
  const model = new RainbowChaseModel();
  const first = model.snapshot(125);
  const repeated = model.snapshot(125);
  const transition = compareChaseSnapshots(first, repeated);
  assert.equal(transition.contributingSetChanged, false);
  assert.deepEqual(transition.enteredIds, []);
  assert.deepEqual(transition.exitedIds, []);
  assert.deepEqual(transition.retainedIds, first.contributingDropletIds);
  assert.equal(transition.overlapFraction, 1);
});

test("retained IDs, when present, keep the same fixed world position", () => {
  const model = new RainbowChaseModel();
  const first = model.snapshot(100);
  const second = model.snapshot(110);
  const transition = compareChaseSnapshots(first, second);
  const firstById = new Map(first.contributingDroplets.map((droplet) => [droplet.id, droplet]));
  const secondById = new Map(second.contributingDroplets.map((droplet) => [droplet.id, droplet]));

  assert.ok(transition.retainedIds.length > 0, "a short move should retain some contributors");
  for (const id of transition.retainedIds) {
    assert.deepEqual(firstById.get(id)?.positionM, secondById.get(id)?.positionM);
  }
});

test("apparent angle is measured from the antisolar axis", () => {
  const sun = sunDirectionForChase(0, 90);
  const observer = { x: 0, y: 0, z: 0 };
  assert.ok(
    Math.abs(apparentRadiusFromAntisolarDeg(observer, { x: -10, y: 0, z: 0 }, sun)) <
      1e-10
  );
  assert.ok(
    Math.abs(apparentRadiusFromAntisolarDeg(observer, { x: 0, y: 10, z: 0 }, sun) - 90) <
      1e-10
  );
});

test("observer distance is limited to the declared 500 m experiment path", () => {
  const model = new RainbowChaseModel({ pathLengthM: 500 });
  assert.equal(model.snapshot(-20).observerDistanceM, 0);
  assert.equal(model.snapshot(900).observerDistanceM, 500);
});

test("the chase path follows the horizontal antisolar direction", () => {
  const sunAzimuthDeg = 225;
  const model = new RainbowChaseModel({ sunAzimuthDeg, pathLengthM: 500 });
  const direction = observerPathDirectionForChase(sunAzimuthDeg);
  const end = model.snapshot(500).observerPositionM;
  assert.ok(Math.abs(end.x - direction.x * 500) < 1e-10);
  assert.ok(Math.abs(end.z - direction.z * 500) < 1e-10);

  const sun = sunDirectionForChase(12, sunAzimuthDeg);
  const horizontalDot = direction.x * sun.x + direction.z * sun.z;
  assert.ok(horizontalDot < 0, "the path must oppose the Sun's horizontal direction");
});
