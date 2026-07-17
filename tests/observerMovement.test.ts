import assert from "node:assert/strict";
import test from "node:test";
import { boundedHorizontalObserverMove } from "../src/physics/observerMovement.ts";

test("ground observer follows the horizontal look bearing and keeps eye height", () => {
  const initial = { x: 0, y: 1.7, z: 0 };
  const moved = boundedHorizontalObserverMove(
    initial,
    initial,
    { x: 3, y: 40, z: 4 },
    5,
    45
  );
  assert.deepEqual(moved.position, { x: 3, y: 1.7, z: 4 });
  assert.equal(moved.limited, false);
});

test("observer movement is clamped to the 45 metre validity disk", () => {
  const initial = { x: 0, y: 1.7, z: 0 };
  const moved = boundedHorizontalObserverMove(
    { x: 44, y: 99, z: 0 },
    initial,
    { x: 1, y: 0, z: 0 },
    5,
    45
  );
  assert.deepEqual(moved.position, { x: 45, y: 1.7, z: 0 });
  assert.equal(moved.limited, true);
});

test("a vertical look direction uses the deterministic forward fallback", () => {
  const initial = { x: 2, y: 1.7, z: 3 };
  const moved = boundedHorizontalObserverMove(
    initial,
    initial,
    { x: 0, y: 1, z: 0 },
    5,
    45
  );
  assert.deepEqual(moved.position, { x: 2, y: 1.7, z: -2 });
});
