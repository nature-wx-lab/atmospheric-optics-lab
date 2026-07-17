import assert from "node:assert/strict";
import test from "node:test";
import { RainbowSelectionGesture } from "../src/interaction/rainbowSelectionGesture.ts";

const mouse = (pointerId: number, clientX: number, clientY: number) => ({
  pointerId,
  clientX,
  clientY,
  pointerType: "mouse",
  isPrimary: true
});

test("a deliberate short tap produces one selection candidate", () => {
  const gesture = new RainbowSelectionGesture();
  gesture.pointerDown(mouse(1, 100, 80));
  const tap = gesture.pointerUp(mouse(1, 103, 82));
  assert.deepEqual(tap, { clientX: 103, clientY: 82, pointerType: "mouse" });
});

test("wheel, slider, or pinch cancellation prevents pointerup selection", () => {
  const gesture = new RainbowSelectionGesture();
  gesture.pointerDown(mouse(1, 100, 80));
  gesture.cancel();
  assert.equal(gesture.pointerUp(mouse(1, 100, 80)), null);
});

test("cumulative drag movement is rejected even when it returns to the start", () => {
  const gesture = new RainbowSelectionGesture();
  gesture.pointerDown(mouse(1, 100, 80));
  gesture.pointerMove(mouse(1, 108, 80));
  gesture.pointerMove(mouse(1, 100, 80));
  assert.equal(gesture.pointerUp(mouse(1, 100, 80)), null);
});

test("non-primary and mismatched pointers cannot select", () => {
  const gesture = new RainbowSelectionGesture();
  gesture.pointerDown({ ...mouse(1, 100, 80), isPrimary: false });
  assert.equal(gesture.pointerUp(mouse(1, 100, 80)), null);
  gesture.pointerDown(mouse(1, 100, 80));
  assert.equal(gesture.pointerUp(mouse(2, 100, 80)), null);
});
