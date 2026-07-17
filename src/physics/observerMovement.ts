export interface ObserverMoveVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BoundedObserverMove {
  readonly position: ObserverMoveVector;
  readonly limited: boolean;
}

function finiteVector(vector: ObserverMoveVector, label: string): void {
  if (![vector.x, vector.y, vector.z].every(Number.isFinite)) {
    throw new RangeError(`${label} must be finite`);
  }
}

/**
 * Move a ground-based observer along the horizontal projection of the current
 * look direction, then clamp the observer to a circular validity region.
 */
export function boundedHorizontalObserverMove(
  current: ObserverMoveVector,
  initial: ObserverMoveVector,
  lookDirection: ObserverMoveVector,
  distanceM: number,
  maximumDisplacementM: number
): BoundedObserverMove {
  finiteVector(current, "current observer position");
  finiteVector(initial, "initial observer position");
  finiteVector(lookDirection, "look direction");
  if (!Number.isFinite(distanceM)) throw new RangeError("movement distance must be finite");
  if (!Number.isFinite(maximumDisplacementM) || maximumDisplacementM <= 0) {
    throw new RangeError("maximum displacement must be positive");
  }

  let headingX = lookDirection.x;
  let headingZ = lookDirection.z;
  const headingLength = Math.hypot(headingX, headingZ);
  if (headingLength < 1e-10) {
    headingX = 0;
    headingZ = -1;
  } else {
    headingX /= headingLength;
    headingZ /= headingLength;
  }

  let displacementX = current.x + headingX * distanceM - initial.x;
  let displacementZ = current.z + headingZ * distanceM - initial.z;
  const displacement = Math.hypot(displacementX, displacementZ);
  const limited = displacement > maximumDisplacementM;
  if (limited) {
    const scale = maximumDisplacementM / displacement;
    displacementX *= scale;
    displacementZ *= scale;
  }
  return Object.freeze({
    position: Object.freeze({
      x: initial.x + displacementX,
      y: initial.y,
      z: initial.z + displacementZ
    }),
    limited
  });
}
