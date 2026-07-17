export interface SelectionPointerSample {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerType: string;
  readonly isPrimary?: boolean;
}

export interface SelectionTap {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerType: string;
}

interface ActiveSelectionGesture extends SelectionPointerSample {
  lastX: number;
  lastY: number;
  cumulativeMovement: number;
}

/**
 * Distinguishes one deliberate short tap from camera and zoom gestures.
 *
 * Endpoint distance alone is insufficient: a drag that returns to its origin,
 * or a wheel event between pointerdown and pointerup, must never select a drop.
 */
export class RainbowSelectionGesture {
  private active: ActiveSelectionGesture | null = null;

  constructor(private readonly maximumMovementPx = 6) {
    if (!(maximumMovementPx > 0) || !Number.isFinite(maximumMovementPx)) {
      throw new RangeError("maximum movement must be finite and positive");
    }
  }

  pointerDown(sample: SelectionPointerSample): void {
    if (sample.isPrimary === false) {
      this.cancel();
      return;
    }
    this.active = {
      ...sample,
      lastX: sample.clientX,
      lastY: sample.clientY,
      cumulativeMovement: 0
    };
  }

  pointerMove(sample: SelectionPointerSample): void {
    const active = this.active;
    if (!active || active.pointerId !== sample.pointerId) return;
    active.cumulativeMovement += Math.hypot(
      sample.clientX - active.lastX,
      sample.clientY - active.lastY
    );
    active.lastX = sample.clientX;
    active.lastY = sample.clientY;
    if (active.cumulativeMovement > this.maximumMovementPx) this.cancel();
  }

  pointerUp(sample: SelectionPointerSample): SelectionTap | null {
    const active = this.active;
    this.active = null;
    if (!active || active.pointerId !== sample.pointerId) return null;
    const finalSegment = Math.hypot(
      sample.clientX - active.lastX,
      sample.clientY - active.lastY
    );
    const endpointDistance = Math.hypot(
      sample.clientX - active.clientX,
      sample.clientY - active.clientY
    );
    if (
      active.cumulativeMovement + finalSegment > this.maximumMovementPx ||
      endpointDistance > this.maximumMovementPx
    ) {
      return null;
    }
    return {
      clientX: sample.clientX,
      clientY: sample.clientY,
      pointerType: active.pointerType
    };
  }

  cancel(): void {
    this.active = null;
  }
}
