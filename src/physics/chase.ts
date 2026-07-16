import {
  SPECTRAL_SAMPLES,
  degrees,
  findStationaryRay,
  radians,
  type RainbowOrder
} from "./rainbow";

export interface ChaseVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ChaseDroplet {
  readonly id: string;
  /** Fixed world position. The rain field does not move when the observer moves. */
  readonly positionM: ChaseVec3;
}

export interface ContributingDroplet extends ChaseDroplet {
  readonly distanceFromObserverM: number;
  readonly apparentRadiusDeg: number;
  readonly angularErrorDeg: number;
}

export interface RainbowChaseOptions {
  readonly seed?: number;
  readonly dropletCount?: number;
  readonly pathLengthM?: number;
  readonly observerHeightM?: number;
  readonly fieldRadiusM?: number;
  readonly fieldHeightM?: number;
  readonly minimumDropletDistanceM?: number;
  readonly maximumDropletDistanceM?: number;
  readonly angularToleranceDeg?: number;
  readonly sunElevationDeg?: number;
  readonly sunAzimuthDeg?: number;
  readonly order?: RainbowOrder;
  readonly spectralSampleIndex?: number;
}

export interface ResolvedRainbowChaseOptions {
  readonly seed: number;
  readonly dropletCount: number;
  readonly pathLengthM: number;
  readonly observerHeightM: number;
  readonly fieldRadiusM: number;
  readonly fieldHeightM: number;
  readonly minimumDropletDistanceM: number;
  readonly maximumDropletDistanceM: number;
  readonly angularToleranceDeg: number;
  readonly sunElevationDeg: number;
  readonly sunAzimuthDeg: number;
  readonly order: RainbowOrder;
  readonly spectralSampleIndex: number;
}

export interface ChaseSnapshot {
  readonly observerDistanceM: number;
  readonly observerPositionM: ChaseVec3;
  readonly rainbowRadiusDeg: number;
  readonly wavelengthNm: number;
  readonly refractiveIndex: number;
  readonly contributingDroplets: readonly ContributingDroplet[];
  readonly contributingDropletIds: readonly string[];
  /**
   * A rainbow angle selects a direction, not a unique range. The simulation
   * intentionally reports this as false even though its sample field has
   * finite near and far bounds.
   */
  readonly distanceResolvedByRainbowAngle: false;
  readonly sampledDistanceRangeM: {
    readonly minimum: number | null;
    readonly maximum: number | null;
  };
  readonly modelStatement: string;
}

export interface ChaseTransition {
  readonly fromObserverDistanceM: number;
  readonly toObserverDistanceM: number;
  readonly angleChangeDeg: number;
  readonly enteredIds: readonly string[];
  readonly exitedIds: readonly string[];
  readonly retainedIds: readonly string[];
  readonly contributingSetChanged: boolean;
  readonly overlapFraction: number;
}

const DEFAULT_OPTIONS: ResolvedRainbowChaseOptions = {
  seed: 0x7261696e,
  dropletCount: 24_000,
  pathLengthM: 500,
  observerHeightM: 1.7,
  fieldRadiusM: 3_200,
  fieldHeightM: 2_200,
  minimumDropletDistanceM: 80,
  maximumDropletDistanceM: 4_200,
  angularToleranceDeg: 0.45,
  sunElevationDeg: 12,
  sunAzimuthDeg: 225,
  order: 1,
  spectralSampleIndex: 3
};

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must not be negative`);
  return value;
}

export function resolveRainbowChaseOptions(
  options: RainbowChaseOptions = {}
): ResolvedRainbowChaseOptions {
  const resolved: ResolvedRainbowChaseOptions = { ...DEFAULT_OPTIONS, ...options };
  if (!Number.isInteger(resolved.dropletCount) || resolved.dropletCount < 1) {
    throw new RangeError("dropletCount must be a positive integer");
  }
  finitePositive(resolved.pathLengthM, "pathLengthM");
  finiteNonNegative(resolved.observerHeightM, "observerHeightM");
  finitePositive(resolved.fieldRadiusM, "fieldRadiusM");
  finitePositive(resolved.fieldHeightM, "fieldHeightM");
  finiteNonNegative(resolved.minimumDropletDistanceM, "minimumDropletDistanceM");
  finitePositive(resolved.maximumDropletDistanceM, "maximumDropletDistanceM");
  if (resolved.maximumDropletDistanceM <= resolved.minimumDropletDistanceM) {
    throw new RangeError("maximumDropletDistanceM must exceed minimumDropletDistanceM");
  }
  finitePositive(resolved.angularToleranceDeg, "angularToleranceDeg");
  if (resolved.angularToleranceDeg >= 10) {
    throw new RangeError("angularToleranceDeg must be less than 10 degrees");
  }
  if (resolved.sunElevationDeg < -90 || resolved.sunElevationDeg > 90) {
    throw new RangeError("sunElevationDeg must be between -90 and 90 degrees");
  }
  if (!Number.isInteger(resolved.spectralSampleIndex)) {
    throw new RangeError("spectralSampleIndex must be an integer");
  }
  if (!SPECTRAL_SAMPLES[resolved.spectralSampleIndex]) {
    throw new RangeError("spectralSampleIndex is outside the fixed spectrum");
  }
  return resolved;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let output = value;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function subtract(a: ChaseVec3, b: ChaseVec3): ChaseVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function magnitude(vector: ChaseVec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector: ChaseVec3): ChaseVec3 {
  const length = magnitude(vector);
  if (length === 0) throw new Error("cannot normalize a zero vector");
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function dot(a: ChaseVec3, b: ChaseVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function sunDirectionForChase(
  sunElevationDeg: number,
  sunAzimuthDeg: number
): ChaseVec3 {
  const elevation = radians(sunElevationDeg);
  const azimuth = radians(sunAzimuthDeg);
  return normalize({
    x: Math.cos(elevation) * Math.sin(azimuth),
    y: Math.sin(elevation),
    z: Math.cos(elevation) * Math.cos(azimuth)
  });
}

/** Horizontal direction in which an observer would walk toward the bow. */
export function observerPathDirectionForChase(sunAzimuthDeg: number): ChaseVec3 {
  const azimuth = radians(sunAzimuthDeg);
  return {
    x: -Math.sin(azimuth),
    y: 0,
    z: -Math.cos(azimuth)
  };
}

export function apparentRadiusFromAntisolarDeg(
  observerPositionM: ChaseVec3,
  dropletPositionM: ChaseVec3,
  sunDirection: ChaseVec3
): number {
  const sightline = normalize(subtract(dropletPositionM, observerPositionM));
  const antisolar = { x: -sunDirection.x, y: -sunDirection.y, z: -sunDirection.z };
  return degrees(Math.acos(clamp(dot(sightline, antisolar), -1, 1)));
}

/**
 * Build one fixed pseudo-random rain field. The observer samples this same
 * field at every path position; no droplet is regenerated while chasing.
 */
export function generateChaseDropletField(
  options: RainbowChaseOptions | ResolvedRainbowChaseOptions = {}
): readonly ChaseDroplet[] {
  const config = resolveRainbowChaseOptions(options);
  const random = seededRandom(config.seed);
  const pathDirection = observerPathDirectionForChase(config.sunAzimuthDeg);
  const centerX = pathDirection.x * config.pathLengthM / 2;
  const centerZ = pathDirection.z * config.pathLengthM / 2;
  const droplets: ChaseDroplet[] = [];

  for (let index = 0; index < config.dropletCount; index += 1) {
    // Uniform horizontal area in a cylinder, with a mildly bottom-heavy
    // vertical distribution to resemble a rain volume above the path.
    const phase = random() * Math.PI * 2;
    const horizontalRadius = Math.sqrt(random()) * config.fieldRadiusM;
    const height = 2 + Math.pow(random(), 1.25) * (config.fieldHeightM - 2);
    droplets.push({
      id: `drop-${index.toString().padStart(5, "0")}`,
      positionM: {
        x: centerX + Math.cos(phase) * horizontalRadius,
        y: height,
        z: centerZ + Math.sin(phase) * horizontalRadius
      }
    });
  }
  return droplets;
}

export function compareChaseSnapshots(
  from: ChaseSnapshot,
  to: ChaseSnapshot
): ChaseTransition {
  const fromIds = new Set(from.contributingDropletIds);
  const toIds = new Set(to.contributingDropletIds);
  const retainedIds = from.contributingDropletIds.filter((id) => toIds.has(id));
  const enteredIds = to.contributingDropletIds.filter((id) => !fromIds.has(id));
  const exitedIds = from.contributingDropletIds.filter((id) => !toIds.has(id));
  const unionSize = fromIds.size + enteredIds.length;
  return {
    fromObserverDistanceM: from.observerDistanceM,
    toObserverDistanceM: to.observerDistanceM,
    angleChangeDeg: to.rainbowRadiusDeg - from.rainbowRadiusDeg,
    enteredIds,
    exitedIds,
    retainedIds,
    contributingSetChanged: enteredIds.length > 0 || exitedIds.length > 0,
    overlapFraction: unionSize === 0 ? 1 : retainedIds.length / unionSize
  };
}

/**
 * Deterministic, geometric experiment for the observer-centred rainbow cone.
 * It does not claim to resolve a real rainbow's distance or brightness.
 */
export class RainbowChaseModel {
  readonly options: ResolvedRainbowChaseOptions;
  readonly droplets: readonly ChaseDroplet[];
  readonly rainbowRadiusDeg: number;
  readonly wavelengthNm: number;
  readonly refractiveIndex: number;
  private readonly sunDirection: ChaseVec3;
  private readonly observerPathDirection: ChaseVec3;

  constructor(options: RainbowChaseOptions = {}) {
    this.options = resolveRainbowChaseOptions(options);
    this.droplets = generateChaseDropletField(this.options);
    const sample = SPECTRAL_SAMPLES[this.options.spectralSampleIndex];
    if (!sample) throw new Error("configured spectral sample is unavailable");
    this.wavelengthNm = sample.wavelengthNm;
    this.refractiveIndex = sample.waterIndex;
    this.rainbowRadiusDeg = findStationaryRay(sample.waterIndex, this.options.order).radiusDeg;
    this.sunDirection = sunDirectionForChase(
      this.options.sunElevationDeg,
      this.options.sunAzimuthDeg
    );
    this.observerPathDirection = observerPathDirectionForChase(this.options.sunAzimuthDeg);
  }

  snapshot(observerDistanceM: number): ChaseSnapshot {
    if (!Number.isFinite(observerDistanceM)) {
      throw new RangeError("observerDistanceM must be finite");
    }
    const clampedDistance = clamp(observerDistanceM, 0, this.options.pathLengthM);
    const observerPositionM: ChaseVec3 = {
      x: this.observerPathDirection.x * clampedDistance,
      y: this.options.observerHeightM,
      z: this.observerPathDirection.z * clampedDistance
    };
    const contributingDroplets: ContributingDroplet[] = [];

    for (const droplet of this.droplets) {
      const offset = subtract(droplet.positionM, observerPositionM);
      const distance = magnitude(offset);
      if (
        distance < this.options.minimumDropletDistanceM ||
        distance > this.options.maximumDropletDistanceM
      ) {
        continue;
      }
      const apparentRadiusDeg = apparentRadiusFromAntisolarDeg(
        observerPositionM,
        droplet.positionM,
        this.sunDirection
      );
      const angularErrorDeg = apparentRadiusDeg - this.rainbowRadiusDeg;
      if (Math.abs(angularErrorDeg) <= this.options.angularToleranceDeg) {
        contributingDroplets.push({
          ...droplet,
          distanceFromObserverM: distance,
          apparentRadiusDeg,
          angularErrorDeg
        });
      }
    }

    const distances = contributingDroplets.map((droplet) => droplet.distanceFromObserverM);
    return {
      observerDistanceM: clampedDistance,
      observerPositionM,
      rainbowRadiusDeg: this.rainbowRadiusDeg,
      wavelengthNm: this.wavelengthNm,
      refractiveIndex: this.refractiveIndex,
      contributingDroplets,
      contributingDropletIds: contributingDroplets.map((droplet) => droplet.id),
      distanceResolvedByRainbowAngle: false,
      sampledDistanceRangeM: {
        minimum: distances.length === 0 ? null : Math.min(...distances),
        maximum: distances.length === 0 ? null : Math.max(...distances)
      },
      modelStatement:
        "反太陽方位へ進む観察者と固定した有限の雨滴場を使い、反太陽点まわりの計算角に入る水滴を抽出した幾何モデルです。角度だけでは虹までの距離や実際の明るさは決まりません。"
    };
  }
}
