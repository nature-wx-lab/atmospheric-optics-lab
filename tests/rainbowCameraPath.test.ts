import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  inspectionCameraPosition,
  rainbowApproachPathPose,
  slerpCameraDirection,
  shouldCaptureDropApproachAnchor
} from "../src/physics/rainbowCameraPath.ts";

const overviewGazeDirection = new THREE.Vector3(0, 0.2, -1).normalize();
const fieldGazeDirection = new THREE.Vector3(0.2, 0.1, -1).normalize();
const path = {
  origin: new THREE.Vector3(0, 0.65, 0.15),
  pathDirection: overviewGazeDirection.clone(),
  freeOffset: new THREE.Vector3(0.4, 0.1, -0.2),
  overviewGazeDirection,
  fieldGazeDirection
};
const selected = {
  endPosition: new THREE.Vector3(8, 4, -10),
  endForward: new THREE.Vector3(-0.4, -0.1, 1).normalize()
};

test("a selected ID cannot alter the common rain-field camera path through 47 percent", () => {
  for (const progress of [0, 0.2, 0.469, 0.47]) {
    const unselected = rainbowApproachPathPose(path, progress, null);
    const focused = rainbowApproachPathPose(path, progress, selected);
    assert.ok(unselected.position.distanceTo(focused.position) < 1e-12);
    assert.ok(unselected.forward.distanceTo(focused.forward) < 1e-12);
    assert.equal(focused.turnBlend, 0);
    assert.equal(focused.travelBlend, 0);
  }
});

test("free exploration offset resolves continuously instead of appearing as a cut", () => {
  const noOffset = { ...path, freeOffset: new THREE.Vector3() };
  assert.ok(inspectionCameraPosition(path, 0).distanceTo(inspectionCameraPosition(noOffset, 0)) < 1e-12);
  const atEnd = inspectionCameraPosition(path, 0.47);
  const atEndWithoutOffset = inspectionCameraPosition(noOffset, 0.47);
  assert.ok(atEnd.clone().sub(atEndWithoutOffset).distanceTo(path.freeOffset) < 1e-12);
});

test("reverse semantic zoom restores the stored overview gaze continuously", () => {
  const atOverview = rainbowApproachPathPose(path, 0, null).forward;
  const halfwayOut = rainbowApproachPathPose(path, 0.3, null).forward;
  const atField = rainbowApproachPathPose(path, 0.47, null).forward;

  assert.ok(atOverview.distanceTo(overviewGazeDirection) < 1e-12);
  assert.ok(atField.distanceTo(fieldGazeDirection) < 1e-12);
  assert.ok(Math.abs(halfwayOut.length() - 1) < 1e-12);
  assert.ok(halfwayOut.distanceTo(overviewGazeDirection) > 0);
  assert.ok(halfwayOut.distanceTo(fieldGazeDirection) > 0);

  const reverse = [0.47, 0.4, 0.3, 0.2, 0.1, 0].map(
    (progress) => rainbowApproachPathPose(path, progress, null).forward
  );
  for (let index = 1; index < reverse.length; index += 1) {
    const previous = reverse[index - 1]!;
    const current = reverse[index]!;
    assert.ok(
      current.distanceTo(overviewGazeDirection) <=
        previous.distanceTo(overviewGazeDirection) + 1e-12
    );
  }
});

test("a drop selected during free exploration starts from the captured camera pose", () => {
  const anchorPosition = new THREE.Vector3(2.4, 1.2, -4.5);
  const anchorForward = new THREE.Vector3(0.1, 0.05, -1).normalize();
  const anchoredTarget = { ...selected, anchorPosition, anchorForward };
  const boundary = rainbowApproachPathPose(path, 0.47, anchoredTarget);
  assert.ok(boundary.position.distanceTo(inspectionCameraPosition(path, 0.47)) < 1e-12);
  const justAfter = rainbowApproachPathPose(path, 0.470001, anchoredTarget);
  assert.ok(justAfter.position.distanceTo(anchorPosition) < 1e-8);
  assert.ok(justAfter.forward.distanceTo(anchorForward) < 1e-8);
  const close = rainbowApproachPathPose(path, 1, anchoredTarget);
  assert.ok(close.position.distanceTo(selected.endPosition) < 1e-12);
  assert.ok(close.forward.distanceTo(selected.endForward) < 1e-12);
});

test("only the shared 47 percent boundary can become a new drop-approach anchor", () => {
  assert.equal(shouldCaptureDropApproachAnchor(0.47), true);
  assert.equal(shouldCaptureDropApproachAnchor(0.469), false);
  assert.equal(shouldCaptureDropApproachAnchor(0.47001), false);
  assert.equal(shouldCaptureDropApproachAnchor(0.59), false);
  assert.equal(shouldCaptureDropApproachAnchor(1), false);
});

test("returning from free exploration rotates the camera direction continuously", () => {
  const start = new THREE.Vector3(1, 0.25, 0).normalize();
  const end = new THREE.Vector3(0, -0.1, -1).normalize();
  const atStart = slerpCameraDirection(start, end, 0);
  const halfway = slerpCameraDirection(start, end, 0.5);
  const atEnd = slerpCameraDirection(start, end, 1);

  assert.ok(atStart.distanceTo(start) < 1e-12);
  assert.ok(atEnd.distanceTo(end) < 1e-12);
  assert.ok(Math.abs(halfway.length() - 1) < 1e-12);
  assert.ok(halfway.distanceTo(start) > 0);
  assert.ok(halfway.distanceTo(end) > 0);
});
