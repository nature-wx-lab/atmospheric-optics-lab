import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  rainbowBandAtViewDirection,
  viewDirectionFromCanvasPoint,
  viewDirectionFromClientPoint
} from "../src/interaction/rainbowCursorTarget.ts";
import { rainbowAngleRange } from "../src/physics/rainbow.ts";
import { sunDirectionFromAngles } from "../src/physics/semanticZoom.ts";

function directionAtAntisolarRadius(radiusDeg: number): THREE.Vector3 {
  const sun = sunDirectionFromAngles(12, 225);
  const antisolar = new THREE.Vector3(-sun.x, -sun.y, -sun.z).normalize();
  const perpendicular = new THREE.Vector3(0, 1, 0)
    .addScaledVector(antisolar, -antisolar.y)
    .normalize();
  return antisolar
    .multiplyScalar(Math.cos(THREE.MathUtils.degToRad(radiusDeg)))
    .addScaledVector(perpendicular, Math.sin(THREE.MathUtils.degToRad(radiusDeg)))
    .normalize();
}

test("canvas cursor position becomes the camera ray instead of a fixed centre zoom", () => {
  const camera = new THREE.PerspectiveCamera(60, 1.5, 0.03, 250);
  camera.position.set(2, 3, 4);
  camera.lookAt(2, 3, -10);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const centre = viewDirectionFromCanvasPoint(camera, 600, 400, 1200, 800);
  const right = viewDirectionFromCanvasPoint(camera, 900, 400, 1200, 800);
  assert.ok(centre);
  assert.ok(right);
  assert.ok(centre.angleTo(new THREE.Vector3(0, 0, -1)) < 1e-10);
  assert.ok(right.x > centre.x + 0.1);
  assert.ok(right.angleTo(centre) > THREE.MathUtils.degToRad(10));
});

test("browser client coordinates include the canvas page offset", () => {
  const camera = new THREE.PerspectiveCamera(60, 1.5, 0.03, 250);
  camera.position.set(2, 3, 4);
  camera.lookAt(2, 3, -10);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const local = viewDirectionFromCanvasPoint(camera, 600, 400, 1200, 800);
  const client = viewDirectionFromClientPoint(camera, 881, 597.5, {
    left: 281,
    top: 197.5,
    width: 1200,
    height: 800
  });
  assert.ok(local);
  assert.ok(client);
  assert.ok(local.angleTo(client) < 1e-12);
});

test("cursor rays are classified only inside the calculated primary or secondary bands", () => {
  const primary = rainbowAngleRange(1);
  const secondary = rainbowAngleRange(2);
  const primaryHit = rainbowBandAtViewDirection(
    directionAtAntisolarRadius((primary.minimumDeg + primary.maximumDeg) / 2),
    12,
    225
  );
  const secondaryHit = rainbowBandAtViewDirection(
    directionAtAntisolarRadius((secondary.minimumDeg + secondary.maximumDeg) / 2),
    12,
    225
  );
  const outside = rainbowBandAtViewDirection(directionAtAntisolarRadius(46), 12, 225);
  assert.equal(primaryHit?.order, 1);
  assert.equal(secondaryHit?.order, 2);
  assert.equal(outside, null);
});

test("a visibly rendered primary red fringe maps to the red edge contributor", () => {
  const primary = rainbowAngleRange(1);
  const fringe = rainbowBandAtViewDirection(
    directionAtAntisolarRadius(primary.maximumDeg + 0.8),
    12,
    225
  );
  const darkSky = rainbowBandAtViewDirection(
    directionAtAntisolarRadius(primary.maximumDeg + 1.3),
    12,
    225
  );

  assert.equal(fringe?.order, 1);
  assert.ok(fringe);
  assert.ok(fringe.effectiveRadianceAlpha >= 0.018);
  assert.equal(fringe.targetRadiusDeg, primary.maximumDeg);
  assert.ok(fringe.targetWavelengthNm > 620);
  assert.equal(darkSky, null);
});
