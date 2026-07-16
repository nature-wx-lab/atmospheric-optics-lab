import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  DEFAULT_RAIN_FIELD_OPTIONS,
  generateRainField,
  observeRainField
} from "../src/physics/rainField.ts";
import {
  OBSERVER_OPTICAL_ORIGIN,
  rainbowZoomFrame,
  sunDirectionFromAngles
} from "../src/physics/semanticZoom.ts";
import { RainbowJourney } from "../src/scenes/rainbowJourney.ts";
import { RainbowOverview } from "../src/scenes/rainbowOverview.ts";

interface ProjectedDroplet {
  readonly index: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly depth: number;
  readonly contributes: boolean;
}

interface ExpectedPickCandidate extends ProjectedDroplet {
  readonly distancePx: number;
}

const VIEWPORT_WIDTH = 960;
const VIEWPORT_HEIGHT = 640;

function overviewCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    46,
    VIEWPORT_WIDTH / VIEWPORT_HEIGHT,
    0.03,
    250
  );
  camera.position.set(18, 10, 24);
  camera.lookAt(
    OBSERVER_OPTICAL_ORIGIN.x,
    OBSERVER_OPTICAL_ORIGIN.y,
    OBSERVER_OPTICAL_ORIGIN.z
  );
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function projectedVisibleDroplets(
  overview: RainbowOverview,
  camera: THREE.Camera
): readonly ProjectedDroplet[] {
  const field = overview.group.getObjectByName(
    "fixed-rain-field-60000-selectable-droplets"
  );
  assert.ok(field instanceof THREE.Points);
  const positions = field.geometry.getAttribute("position");
  const visibleCount = overview.getSnapshot().visibleDroplets;
  const observations = observeRainField(
    generateRainField(),
    DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM,
    sunDirectionFromAngles(12, 225),
    1
  );
  const projected = new THREE.Vector3();
  const results: ProjectedDroplet[] = [];

  for (let index = 0; index < visibleCount; index += 1) {
    projected.fromBufferAttribute(positions, index).project(camera);
    if (projected.z < -1 || projected.z > 1) continue;
    results.push({
      index,
      screenX: (projected.x * 0.5 + 0.5) * VIEWPORT_WIDTH,
      screenY: (-projected.y * 0.5 + 0.5) * VIEWPORT_HEIGHT,
      depth: projected.z,
      contributes: observations[index]?.contributes ?? false
    });
  }
  return results;
}

function findNonContributorBesideContributor(
  droplets: readonly ProjectedDroplet[]
): ProjectedDroplet {
  const cellSize = 4;
  const contributorBuckets = new Map<string, ProjectedDroplet[]>();
  const bucketKey = (x: number, y: number): string =>
    `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;

  for (const droplet of droplets) {
    if (!droplet.contributes) continue;
    const key = bucketKey(droplet.screenX, droplet.screenY);
    const bucket = contributorBuckets.get(key);
    if (bucket) bucket.push(droplet);
    else contributorBuckets.set(key, [droplet]);
  }

  for (const droplet of droplets) {
    if (
      droplet.contributes ||
      droplet.screenX < 20 ||
      droplet.screenX > VIEWPORT_WIDTH - 20 ||
      droplet.screenY < 20 ||
      droplet.screenY > VIEWPORT_HEIGHT - 20
    ) {
      continue;
    }
    const cellX = Math.floor(droplet.screenX / cellSize);
    const cellY = Math.floor(droplet.screenY / cellSize);
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const contributors =
          contributorBuckets.get(`${cellX + offsetX}:${cellY + offsetY}`) ?? [];
        if (
          contributors.some(
            (candidate) =>
              Math.hypot(
                candidate.screenX - droplet.screenX,
                candidate.screenY - droplet.screenY
              ) <= 3.9
          )
        ) {
          return droplet;
        }
      }
    }
  }
  throw new Error("the deterministic field should include an overlapping non-contributor");
}

function expectedCandidates(
  droplets: readonly ProjectedDroplet[],
  pointerX: number,
  pointerY: number,
  maximumDistancePx: number
): readonly ExpectedPickCandidate[] {
  return droplets
    .map((droplet) => ({
      ...droplet,
      distancePx: Math.hypot(
        droplet.screenX - pointerX,
        droplet.screenY - pointerY
      )
    }))
    .filter((candidate) => candidate.distancePx <= maximumDistancePx)
    .sort(
      (first, second) =>
        first.distancePx - second.distancePx ||
        first.depth - second.depth ||
        first.index - second.index
    );
}

test("density only changes drawRange and never replaces a selected hidden droplet", () => {
  const journey = new RainbowJourney();
  try {
    journey.setDensity(1);
    const selected = journey.selectById("drop-059999");
    assert.ok(selected);
    journey.applyZoom(rainbowZoomFrame(0.86));

    journey.setDensity(0.15);
    const hidden = journey.getFocusSnapshot();
    assert.equal(hidden.id, selected.id);
    assert.equal(hidden.index, selected.index);
    assert.ok(hidden.position.distanceTo(selected.position) < 1e-12);
    assert.equal(hidden.visibleDroplets, 9_000);
    assert.ok(hidden.index >= hidden.visibleDroplets);

    const field = journey.group.getObjectByName(
      "fixed-rain-field-60000-selectable-droplets"
    );
    assert.ok(field instanceof THREE.Points);
    assert.equal(field.geometry.drawRange.count, 9_000);

    journey.setDensity(1);
    const restored = journey.getFocusSnapshot();
    assert.equal(restored.id, selected.id);
    assert.equal(restored.index, selected.index);
    assert.ok(restored.position.distanceTo(selected.position) < 1e-12);
  } finally {
    journey.dispose();
  }
});

test("every stable ID can be selected even when density hides its point", () => {
  const overview = new RainbowOverview();
  try {
    overview.setDensity(0.15);
    const total = overview.getSnapshot().totalDroplets;
    assert.equal(total, 60_000);
    for (let index = 0; index < total; index += 1) {
      const id = `drop-${index.toString().padStart(6, "0")}`;
      const selected = overview.selectById(id);
      assert.ok(selected, `${id} should remain directly selectable`);
      assert.equal(selected.id, id);
      assert.equal(selected.index, index);
    }
    assert.equal(overview.selectById("drop-060000"), null);
    assert.equal(overview.selectById("drop-not-an-index"), null);
  } finally {
    overview.dispose();
  }
});

test("screen picking is contributor-neutral and cycles overlapping candidates in distance order", () => {
  const overview = new RainbowOverview();
  try {
    const camera = overviewCamera();
    const droplets = projectedVisibleDroplets(overview, camera);
    const target = findNonContributorBesideContributor(droplets);
    const maximumDistancePx = 15;
    const candidates = expectedCandidates(
      droplets,
      target.screenX,
      target.screenY,
      maximumDistancePx
    );

    assert.ok(candidates.length >= 3, "the test point should have overlapping candidates");
    assert.equal(candidates[0]?.index, target.index);
    assert.equal(candidates[0]?.contributes, false);
    assert.ok(
      candidates.some(
        (candidate) => candidate.contributes && candidate.distancePx <= 4
      ),
      "the regression point must expose the former contributor preference"
    );

    const offsetsToCheck = Math.min(6, candidates.length);
    const selectedIds: string[] = [];
    for (let offset = 0; offset < offsetsToCheck; offset += 1) {
      const picked = overview.pickDroplet(
        camera,
        target.screenX,
        target.screenY,
        VIEWPORT_WIDTH,
        VIEWPORT_HEIGHT,
        maximumDistancePx,
        offset
      );
      assert.ok(picked);
      assert.equal(picked.index, candidates[offset]?.index);
      assert.equal(picked.id, `drop-${candidates[offset]!.index.toString().padStart(6, "0")}`);
      selectedIds.push(picked.id);
    }
    assert.equal(new Set(selectedIds).size, offsetsToCheck);

    const wrapped = overview.pickDroplet(
      camera,
      target.screenX,
      target.screenY,
      VIEWPORT_WIDTH,
      VIEWPORT_HEIGHT,
      maximumDistancePx,
      candidates.length
    );
    assert.ok(wrapped);
    assert.equal(wrapped.index, candidates[0]?.index);

    const journey = new RainbowJourney();
    try {
      const forwarded = journey.pickDroplet(
        camera,
        target.screenX,
        target.screenY,
        VIEWPORT_WIDTH,
        VIEWPORT_HEIGHT,
        maximumDistancePx,
        1
      );
      assert.ok(forwarded);
      assert.equal(forwarded.index, candidates[1]?.index);
      assert.equal(journey.getLastPickCandidateCount(), candidates.length);
    } finally {
      journey.dispose();
    }
  } finally {
    overview.dispose();
  }
});
