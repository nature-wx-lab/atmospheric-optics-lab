import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  OBSERVER_OPTICAL_ORIGIN,
  RAIN_FIELD_APPROACH_END,
  RAIN_FIELD_INSPECTION_TRAVEL_M,
  RAINBOW_CAMERA_FAR,
  RAINBOW_CAMERA_NEAR,
  cameraDistanceFromProgress,
  chapterForProgress,
  fieldApproachBlend,
  fieldInspectionTravelM,
  progressiveDrawCount,
  progressFromCameraDistance,
  rainbowZoomFrame,
  selectedDropTravelBlend,
  selectedDropTurnBlend,
  semanticSpanM
} from "../src/physics/semanticZoom.ts";
import { RainbowJourney } from "../src/scenes/rainbowJourney.ts";

test("camera distance and semantic progress are inverse mappings", () => {
  assert.equal(progressFromCameraDistance(RAINBOW_CAMERA_FAR), 0);
  assert.equal(progressFromCameraDistance(RAINBOW_CAMERA_NEAR), 1);
  for (let step = 0; step <= 100; step += 1) {
    const progress = step / 100;
    assert.ok(
      Math.abs(progressFromCameraDistance(cameraDistanceFromProgress(progress)) - progress) < 1e-12
    );
  }
});

test("semantic scale contracts monotonically from rain field to sub-droplet view", () => {
  let previous = Infinity;
  for (let step = 0; step <= 1_000; step += 1) {
    const span = semanticSpanM(step / 1_000);
    assert.ok(Number.isFinite(span));
    assert.ok(span <= previous);
    previous = span;
  }
  assert.equal(semanticSpanM(0), 300);
  assert.ok(Math.abs(semanticSpanM(1) - 0.00035) < 1e-15);
});

test("zoom frame is bounded, continuous, and progressively reveals the representative ray", () => {
  let previousScale = 0;
  let previousReveal = 0;
  for (let step = 0; step <= 1_000; step += 1) {
    const frame = rainbowZoomFrame(step / 1_000);
    for (const value of [
      frame.targetBlend,
      frame.skyOpacity,
      frame.radianceOpacity,
      frame.resolvedFieldOpacity,
      frame.resolvedContributorOpacity,
      frame.overviewOpacity,
      frame.focusMarkerOpacity,
      frame.surfaceOpacity,
      frame.representativeRayOpacity,
      frame.representativeRayReveal,
      frame.spectralOpacity,
      frame.normalOpacity,
      frame.lossBranchOpacity
    ]) {
      assert.ok(value >= 0 && value <= 1);
    }
    assert.ok(frame.detailScale >= previousScale);
    assert.ok(frame.representativeRayReveal >= previousReveal);
    previousScale = frame.detailScale;
    previousReveal = frame.representativeRayReveal;
  }
  assert.equal(chapterForProgress(0), "overview");
  assert.equal(chapterForProgress(0.3), "contributor");
  assert.equal(chapterForProgress(0.55), "droplet");
  assert.equal(chapterForProgress(0.75), "ray");
  assert.equal(chapterForProgress(1), "dispersion");
  const far = rainbowZoomFrame(0);
  const resolving = rainbowZoomFrame(0.3);
  const close = rainbowZoomFrame(0.55);
  assert.equal(far.skyOpacity, 1);
  assert.equal(far.radianceOpacity, 1);
  assert.equal(far.resolvedFieldOpacity, 0);
  assert.equal(far.resolvedContributorOpacity, 0);
  assert.ok(resolving.radianceOpacity > 0 && resolving.radianceOpacity < 1);
  assert.ok(resolving.resolvedFieldOpacity > 0);
  assert.ok(resolving.resolvedContributorOpacity > 0.7);
  assert.ok(
    resolving.resolvedFieldOpacity < resolving.resolvedContributorOpacity,
    "the gray rain field should resolve later than the colored contributors"
  );
  assert.equal(close.radianceOpacity, 0);
});

test("progressive draw count never hides the complete endpoints", () => {
  assert.equal(progressiveDrawCount(0, 100), 2);
  assert.equal(progressiveDrawCount(0.5, 100), 51);
  assert.equal(progressiveDrawCount(1, 100), 100);
  assert.equal(progressiveDrawCount(1, 0), 0);
});

test("rain-field travel is shared before any selected drop can steer the camera", () => {
  assert.equal(fieldApproachBlend(0), 0);
  assert.equal(fieldApproachBlend(RAIN_FIELD_APPROACH_END), 1);
  assert.equal(fieldInspectionTravelM(0), 0);
  assert.equal(
    fieldInspectionTravelM(RAIN_FIELD_APPROACH_END),
    RAIN_FIELD_INSPECTION_TRAVEL_M
  );
  for (let step = 0; step <= 470; step += 1) {
    const progress = step / 1_000;
    assert.equal(selectedDropTurnBlend(progress), 0);
    assert.equal(selectedDropTravelBlend(progress), 0);
  }
  assert.ok(selectedDropTurnBlend(0.6) > 0);
  assert.ok(selectedDropTravelBlend(0.6) > 0);
  assert.equal(selectedDropTurnBlend(1), 1);
  assert.equal(selectedDropTravelBlend(1), 1);
});

test("journey uses one optical origin for the eye, sightline, and scattering geometry", () => {
  const journey = new RainbowJourney();
  try {
    const eye = journey.group.getObjectByName("observer-optical-origin");
    assert.ok(eye);
    assert.ok(eye.position.distanceTo(OBSERVER_OPTICAL_ORIGIN) < 1e-12);

    const horizon = journey.group.getObjectByName("observer-celestial-horizon");
    assert.ok(horizon instanceof THREE.Line);
    horizon.geometry.computeBoundingSphere();
    assert.ok(horizon.geometry.boundingSphere);
    assert.ok(horizon.geometry.boundingSphere.center.distanceTo(OBSERVER_OPTICAL_ORIGIN) < 1e-6);

    for (const order of [1, 2] as const) {
      journey.setConditions(order, 12, 225);
      assert.ok(journey.selectAdjacentContributor(1));
      const snapshot = journey.getFocusSnapshot();
      const sightline = snapshot.position.clone().sub(OBSERVER_OPTICAL_ORIGIN);
      const expectedOutgoing = sightline.clone().negate().normalize();
      assert.ok(snapshot.outgoingDirection.distanceTo(expectedOutgoing) < 1e-12);
      assert.equal(snapshot.contributes, true);
      assert.equal(snapshot.rayReachesObserver, true);
      assert.ok(snapshot.representativeRayDirection.angleTo(snapshot.outgoingDirection) < 1e-7);

      const scatteringDeg = snapshot.incomingDirection.angleTo(snapshot.outgoingDirection) *
        180 / Math.PI;
      assert.ok(Math.abs(scatteringDeg - (180 - snapshot.apparentRadiusDeg)) < 2e-6);
      assert.ok(Math.abs(snapshot.apparentRadiusDeg - snapshot.rainbowRadiusDeg) < 1e-9);

      const field = journey.group.getObjectByName("fixed-rain-field-60000-selectable-droplets");
      assert.ok(field instanceof THREE.Points);
      const positions = field.geometry.getAttribute("position");
      const renderedPosition = new THREE.Vector3().fromBufferAttribute(positions, snapshot.index);
      assert.ok(renderedPosition.distanceTo(snapshot.position) < 1e-12);
    }
  } finally {
    journey.dispose();
  }
});

test("zoom never replaces the selected real rain-field ID", () => {
  const journey = new RainbowJourney();
  try {
    const selected = journey.selectAdjacentContributor(1);
    assert.ok(selected);
    for (let step = 0; step <= 100; step += 1) {
      journey.applyZoom(rainbowZoomFrame(step / 100));
      const snapshot = journey.getFocusSnapshot();
      assert.equal(snapshot.id, selected.id);
      assert.equal(snapshot.index, selected.index);
      assert.ok(snapshot.position.distanceTo(selected.position) < 1e-12);
    }
  } finally {
    journey.dispose();
  }
});

test("a selected non-contributor keeps its ID but does not connect a rainbow ray to the eye", () => {
  const journey = new RainbowJourney();
  try {
    let nonContributor = null as ReturnType<RainbowJourney["selectById"]>;
    for (let index = 0; index < 200 && !nonContributor; index += 1) {
      const candidate = journey.selectById(`drop-${index.toString().padStart(6, "0")}`);
      if (candidate && !candidate.contributes) nonContributor = candidate;
    }
    assert.ok(nonContributor, "the fixed field should expose selectable non-contributors");
    assert.equal(nonContributor.rayReachesObserver, false);
    assert.ok(nonContributor.representativeRayDirection.angleTo(nonContributor.outgoingDirection) > 1e-4);
    assert.equal(journey.getFocusSnapshot().id, nonContributor.id);
  } finally {
    journey.dispose();
  }
});
