import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  DEFAULT_RAIN_FIELD_OPTIONS,
  generateRainField,
  observeRainField
} from "../src/physics/rainField.ts";
import {
  defaultObserverLookDirection,
  observerRainbowVerticalFovDeg
} from "../src/physics/rainbowView.ts";
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

function observerEyeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    observerRainbowVerticalFovDeg(
      1,
      12,
      VIEWPORT_WIDTH / VIEWPORT_HEIGHT
    ),
    VIEWPORT_WIDTH / VIEWPORT_HEIGHT,
    0.03,
    250
  );
  const origin = new THREE.Vector3(
    OBSERVER_OPTICAL_ORIGIN.x,
    OBSERVER_OPTICAL_ORIGIN.y,
    OBSERVER_OPTICAL_ORIGIN.z
  );
  const look = defaultObserverLookDirection(12, 225);
  camera.position.copy(origin);
  camera.lookAt(origin.clone().add(new THREE.Vector3(look.x, look.y, look.z)));
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

test("one 3D world links primary and secondary red and violet rays to distinct real drops", () => {
  const overview = new RainbowOverview();
  try {
    overview.setObserverView(false);
    const paths = overview.getSnapshot().representativePaths;
    assert.equal(paths.length, 4);
    assert.equal(new Set(paths.map((path) => path.dropletId)).size, 4);
    for (const order of [1, 2] as const) {
      const orderPaths = paths.filter((path) => path.order === order);
      assert.equal(orderPaths.length, 2);
      const wavelengths = orderPaths.map((path) => path.wavelengthNm).sort((a, b) => a - b);
      assert.ok((wavelengths[0] ?? Infinity) < 460);
      assert.ok((wavelengths[1] ?? -Infinity) > 620);
      const violet = orderPaths.reduce((first, second) =>
        first.wavelengthNm < second.wavelengthNm ? first : second
      );
      const red = orderPaths.reduce((first, second) =>
        first.wavelengthNm > second.wavelengthNm ? first : second
      );
      if (order === 1) {
        assert.ok(red.apparentRadiusDeg > violet.apparentRadiusDeg);
      } else {
        assert.ok(red.apparentRadiusDeg < violet.apparentRadiusDeg);
      }
      for (const path of orderPaths) {
        assert.ok(path.dropletPosition.distanceTo(path.observerPosition) > 3);
      }
    }
    assert.ok(
      overview.group.getObjectByName(
        "alexanders-dark-band-between-primary-and-secondary-cones"
      )
    );
    assert.ok(overview.group.getObjectByName("representative-physical-ray-paths-order-1"));
    assert.ok(overview.group.getObjectByName("representative-physical-ray-paths-order-2"));
    assert.ok(
      overview.group.getObjectByName(
        "continuous-relative-radiance-order-1-from-unresolved-rain-field"
      )
    );
    assert.ok(
      overview.group.getObjectByName(
        "continuous-relative-radiance-order-2-from-unresolved-rain-field"
      )
    );
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

test("observer-eye presentation starts with continuous radiance and resolves real IDs only while zooming", () => {
  const overview = new RainbowOverview();
  try {
    overview.setObserverView(true);
    overview.setSemanticFrame(rainbowZoomFrame(0));
    const radiance = overview.group.getObjectByName(
      "continuous-relative-radiance-order-1-from-unresolved-rain-field"
    );
    const sky = overview.group.getObjectByName("observer-sky-radiance-background");
    const glints = overview.group.getObjectByName(
      "rainbow-made-only-from-contributing-real-droplet-ids"
    );
    const glow = overview.group.getObjectByName(
      "rainbow-glow-made-only-from-contributing-real-droplet-ids"
    );
    const rain = overview.group.getObjectByName(
      "fixed-rain-field-60000-selectable-droplets"
    );
    assert.ok(radiance instanceof THREE.Mesh);
    assert.ok(sky instanceof THREE.Mesh);
    assert.ok(radiance.material instanceof THREE.ShaderMaterial);
    assert.ok(sky.material instanceof THREE.MeshBasicMaterial);
    assert.ok(glints instanceof THREE.Points);
    assert.ok(glow instanceof THREE.Points);
    assert.ok(rain instanceof THREE.Points);
    assert.ok(glints.material instanceof THREE.PointsMaterial);
    assert.ok(glow.material instanceof THREE.PointsMaterial);
    assert.ok(rain.material instanceof THREE.PointsMaterial);

    const radianceAlpha = radiance.geometry.getAttribute("radianceAlpha");
    assert.ok(radianceAlpha.count > 40_000);
    let illuminatedVertices = 0;
    for (let index = 0; index < radianceAlpha.count; index += 1) {
      if (radianceAlpha.getX(index) > 0.08) illuminatedVertices += 1;
    }
    assert.ok(illuminatedVertices > 2_000);
    assert.equal(radiance.material.uniforms.uOpacity?.value, 1);
    assert.equal(sky.material.opacity, 1);
    assert.equal(radiance.visible, true);
    assert.equal(sky.visible, true);
    assert.equal(glints.visible, false);
    assert.equal(glow.visible, false);
    assert.equal(rain.visible, false);
    assert.equal(glints.material.sizeAttenuation, false);
    assert.equal(glints.material.opacity, 0);
    assert.equal(glow.material.opacity, 0);
    assert.equal(rain.material.sizeAttenuation, false);
    assert.equal(rain.material.opacity, 0);
    assert.equal(overview.group.getObjectByName("observer")?.visible, false);
    assert.equal(
      overview.group.getObjectByName("sun-to-eye-to-antisolar-axis")?.visible,
      false
    );

    overview.setSemanticFrame(rainbowZoomFrame(0.3));
    assert.ok(radiance.material.uniforms.uOpacity?.value > 0);
    assert.ok(radiance.material.uniforms.uOpacity?.value < 1);
    assert.ok(glints.material.opacity > 0.45);
    assert.ok(glow.material.opacity > 0.07);
    assert.ok(rain.material.opacity > 0);
    assert.ok(rain.material.opacity < glow.material.opacity);
    assert.ok(glints.material.size > 1.5);
    assert.ok(glints.material.size <= 2.4);
    assert.ok(glow.material.size <= 3.6);
    assert.equal(glints.visible, true);
    assert.equal(glow.visible, true);
    assert.equal(rain.visible, true);

    overview.setObserverView(false);
    assert.equal(overview.group.getObjectByName("observer")?.visible, true);
    assert.equal(rain.material.sizeAttenuation, false);
    assert.equal(glints.material.sizeAttenuation, false);
    assert.ok(radiance.material.uniforms.uOpacity?.value > 0.9);
    assert.equal(radiance.visible, true);
    assert.equal(sky.visible, false);
    assert.equal(
      overview.group.getObjectByName("sample-eye-to-contributing-droplet-directions")?.visible,
      false
    );
    assert.equal(
      overview.group.getObjectByName("sun-to-eye-to-antisolar-axis")?.visible,
      true
    );
  } finally {
    overview.dispose();
  }
});

test("a rainbow-band view ray selects a real contributor of the pointed colour", () => {
  const overview = new RainbowOverview();
  try {
    const redPath = overview.getSnapshot().representativePaths.find(
      (path) => path.order === 1 && path.wavelengthNm > 620
    );
    assert.ok(redPath);
    const redDirection = redPath.dropletPosition
      .clone()
      .sub(redPath.observerPosition)
      .normalize();
    const selected = overview.selectContributorForViewDirection(redDirection);
    assert.ok(selected);
    assert.equal(selected.observation.contributes, true);
    assert.ok(selected.observation.dominantWavelengthNm !== null);
    assert.ok(selected.observation.dominantWavelengthNm > 590);

    const sun = sunDirectionFromAngles(12, 225);
    const antisolar = new THREE.Vector3(-sun.x, -sun.y, -sun.z);
    assert.equal(overview.selectContributorForViewDirection(antisolar), null);
  } finally {
    overview.dispose();
  }
});

test("a rendered red fringe resolves to a nearby real red contributor", () => {
  const overview = new RainbowOverview();
  try {
    const redPath = overview.getSnapshot().representativePaths.find(
      (path) => path.order === 1 && path.wavelengthNm > 620
    );
    assert.ok(redPath);
    const observerToRed = redPath.dropletPosition
      .clone()
      .sub(redPath.observerPosition)
      .normalize();
    const sun = sunDirectionFromAngles(12, 225);
    const antisolar = new THREE.Vector3(-sun.x, -sun.y, -sun.z).normalize();
    const radialDirection = observerToRed
      .clone()
      .addScaledVector(antisolar, -observerToRed.dot(antisolar))
      .normalize();
    const fringeDirection = antisolar
      .clone()
      .multiplyScalar(Math.cos(THREE.MathUtils.degToRad(43.1)))
      .addScaledVector(radialDirection, Math.sin(THREE.MathUtils.degToRad(43.1)))
      .normalize();

    const selected = overview.selectContributorForViewDirection(
      fringeDirection,
      656.3
    );
    assert.ok(selected);
    assert.equal(selected.observation.contributes, true);
    assert.ok(selected.observation.dominantWavelengthNm !== null);
    assert.ok(selected.observation.dominantWavelengthNm > 590);
    assert.ok(selected.position.clone().sub(redPath.observerPosition).normalize().angleTo(fringeDirection) < 0.04);
  } finally {
    overview.dispose();
  }
});

test("observer-eye rainbow taps prefer a contributing ID over overlapping gray drops", () => {
  const overview = new RainbowOverview();
  try {
    const camera = observerEyeCamera();
    const droplets = projectedVisibleDroplets(overview, camera);
    const target = findNonContributorBesideContributor(droplets);
    const picked = overview.pickDroplet(
      camera,
      target.screenX,
      target.screenY,
      VIEWPORT_WIDTH,
      VIEWPORT_HEIGHT,
      15,
      0,
      true
    );
    assert.ok(picked);
    assert.equal(picked.observation.contributes, true);
  } finally {
    overview.dispose();
  }
});

test("journey starts unselected and never reveals a hidden default target", () => {
  const journey = new RainbowJourney();
  try {
    assert.equal(journey.hasExplicitSelection(), false);
    assert.equal(journey.getFocusSnapshot().explicitlySelected, false);
    journey.applyZoom(rainbowZoomFrame(1));
    assert.equal(journey.group.getObjectByName("droplet-detail")?.visible, false);
    assert.equal(
      journey.group.getObjectByName("selected-existing-rain-field-droplet")?.visible,
      false
    );
    assert.equal(
      journey.group.getObjectByName("white-sunlight-before-selected-rain-drop")?.visible,
      false
    );
  } finally {
    journey.dispose();
  }
});

test("red, green, and blue-violet controls select distinct observer-reaching drop IDs", () => {
  const journey = new RainbowJourney();
  try {
    const requested = [656.3, 530, 404.7] as const;
    const selected = requested.map((wavelength) => {
      const snapshot = journey.selectContributorNearestWavelength(wavelength);
      assert.ok(snapshot, `${wavelength} nm should have a representative contributor`);
      assert.equal(snapshot.contributes, true);
      assert.equal(snapshot.rayReachesObserver, true);
      assert.equal(snapshot.explicitlySelected, true);
      assert.ok(snapshot.dominantWavelengthNm !== null);
      assert.ok(Math.abs(snapshot.dominantWavelengthNm - wavelength) < 8);
      return snapshot;
    });
    assert.equal(new Set(selected.map((snapshot) => snapshot.id)).size, selected.length);
    assert.ok(selected[0]!.dominantWavelengthNm! > selected[1]!.dominantWavelengthNm!);
    assert.ok(selected[1]!.dominantWavelengthNm! > selected[2]!.dominantWavelengthNm!);

    const nextRed = journey.selectContributorNearestWavelength(656.3, 1);
    assert.ok(nextRed);
    assert.equal(nextRed.contributes, true);
    assert.notEqual(nextRed.id, selected[0]!.id);
  } finally {
    journey.dispose();
  }
});

test("moving the observer preserves fixed drops and recomputes observer-dependent contributors", () => {
  const journey = new RainbowJourney();
  try {
    const selected = journey.selectContributorNearestWavelength(530);
    assert.ok(selected);
    const field = journey.group.getObjectByName("fixed-rain-field-60000-selectable-droplets");
    assert.ok(field instanceof THREE.Points);
    const positions = field.geometry.getAttribute("position");
    const fixedBefore = new THREE.Vector3().fromBufferAttribute(positions, selected.index);
    const observerBefore = journey.getObserverPositionM();
    const sceneObserverBefore = journey.getObserverScenePosition();
    const contributorsBefore = selected.contributingDroplets;

    journey.setObserverPositionM(observerBefore.clone().add(new THREE.Vector3(24, 0, -11)));
    const moved = journey.getFocusSnapshot();
    const fixedAfter = new THREE.Vector3().fromBufferAttribute(positions, selected.index);
    const sceneObserverAfter = journey.getObserverScenePosition();
    assert.equal(moved.id, selected.id);
    assert.equal(moved.index, selected.index);
    assert.ok(moved.physicalPositionM.distanceTo(selected.physicalPositionM) < 1e-12);
    assert.ok(moved.position.distanceTo(selected.position) < 1e-12);
    assert.ok(fixedAfter.distanceTo(fixedBefore) < 1e-12);
    assert.ok(sceneObserverAfter.distanceTo(sceneObserverBefore) > 1);
    assert.ok(
      moved.contributingDroplets !== contributorsBefore ||
        moved.contributes !== selected.contributes ||
        moved.dominantWavelengthNm !== selected.dominantWavelengthNm
    );
    assert.ok(
      moved.outgoingDirection.angleTo(sceneObserverAfter.clone().sub(moved.position)) < 1e-10
    );

    journey.group.updateMatrixWorld(true);
    const eye = journey.group.getObjectByName("observer-optical-origin");
    assert.ok(eye);
    const eyeWorld = eye.getWorldPosition(new THREE.Vector3());
    assert.ok(eyeWorld.distanceTo(sceneObserverAfter) < 1e-12);
  } finally {
    journey.dispose();
  }
});

test("the detailed drop uses one white incident segment and seven paths starting at one boundary point", () => {
  const journey = new RainbowJourney();
  try {
    assert.ok(journey.selectContributorNearestWavelength(530));
    journey.applyZoom(rainbowZoomFrame(1));
    const white = journey.group.getObjectByName(
      "one-overlapping-white-sunlight-ray-before-water-entry"
    );
    assert.ok(white instanceof THREE.Line);
    const whitePositions = white.geometry.getAttribute("position");
    assert.equal(whitePositions.count, 2);
    const entry = new THREE.Vector3().fromBufferAttribute(whitePositions, 1);

    const spectralLines: THREE.Line[] = [];
    journey.group.traverse((object) => {
      if (
        object instanceof THREE.Line &&
        object.name.startsWith("same-white-beam-dispersed-after-entry-")
      ) {
        spectralLines.push(object);
      }
    });
    assert.equal(spectralLines.length, 7);
    for (const line of spectralLines) {
      const firstAfterBoundary = new THREE.Vector3().fromBufferAttribute(
        line.geometry.getAttribute("position"),
        0
      );
      assert.ok(firstAfterBoundary.distanceTo(entry) < 1e-12);
    }

    const selectedRay = journey.group.children
      .flatMap((child) => {
        const matches: THREE.Object3D[] = [];
        child.traverse((object) => matches.push(object));
        return matches;
      })
      .find((object) => object.name.startsWith("selected-drop-caustic-ray-to-observer-"));
    assert.ok(selectedRay instanceof THREE.Line);
    assert.ok(
      new THREE.Vector3()
        .fromBufferAttribute(selectedRay.geometry.getAttribute("position"), 0)
        .distanceTo(entry) < 1e-12
    );

    const worldWhite = journey.group.getObjectByName("white-sunlight-before-selected-rain-drop");
    assert.ok(worldWhite instanceof THREE.Line);
    journey.setObserverView(true);
    assert.equal(worldWhite.visible, false);
    journey.setObserverView(false);
    assert.equal(worldWhite.visible, true);
  } finally {
    journey.dispose();
  }
});
