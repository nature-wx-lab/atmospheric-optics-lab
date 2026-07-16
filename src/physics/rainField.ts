import {
  SPECTRAL_SAMPLES,
  degrees,
  findStationaryRay,
  type RainbowOrder
} from "./rainbow";

export interface RainFieldVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RainFieldDroplet {
  readonly id: string;
  readonly index: number;
  /** Fixed physical-model position. It never changes when the Sun moves. */
  readonly positionM: RainFieldVec3;
  readonly diameterMm: number;
}

export interface RainFieldOptions {
  readonly seed?: number;
  readonly dropletCount?: number;
  readonly observerPositionM?: RainFieldVec3;
  readonly minimumDistanceM?: number;
  readonly maximumDistanceM?: number;
  readonly minimumElevationDeg?: number;
  readonly maximumElevationDeg?: number;
  readonly minimumDiameterMm?: number;
  readonly maximumDiameterMm?: number;
}

export interface ResolvedRainFieldOptions {
  readonly seed: number;
  readonly dropletCount: number;
  readonly observerPositionM: RainFieldVec3;
  readonly minimumDistanceM: number;
  readonly maximumDistanceM: number;
  readonly minimumElevationDeg: number;
  readonly maximumElevationDeg: number;
  readonly minimumDiameterMm: number;
  readonly maximumDiameterMm: number;
}

export interface RainbowSpectrumMatch {
  readonly contributes: boolean;
  readonly apparentRadiusDeg: number;
  readonly minimumRadiusDeg: number;
  readonly maximumRadiusDeg: number;
  readonly dominantWavelengthNm: number | null;
  readonly refractiveIndex: number | null;
  readonly targetRadiusDeg: number;
  readonly angularErrorDeg: number;
  readonly nearestWavelengthNm: number;
  readonly nearestRefractiveIndex: number;
  readonly nearestRadiusDeg: number;
  readonly lowerSampleIndex: number;
  readonly upperSampleIndex: number;
  readonly colorMix: number;
}

export interface RainDropletObservation extends RainbowSpectrumMatch {
  readonly dropletId: string;
  readonly dropletIndex: number;
  readonly distanceFromObserverM: number;
}

export const DEFAULT_RAIN_FIELD_DROPLET_COUNT = 60_000;

export const DEFAULT_RAIN_FIELD_OPTIONS: ResolvedRainFieldOptions = Object.freeze({
  seed: 0x7261696e,
  dropletCount: DEFAULT_RAIN_FIELD_DROPLET_COUNT,
  observerPositionM: Object.freeze({ x: 0, y: 1.7, z: 0 }),
  minimumDistanceM: 80,
  maximumDistanceM: 300,
  minimumElevationDeg: -4,
  maximumElevationDeg: 72,
  minimumDiameterMm: 0.45,
  maximumDiameterMm: 1
});

interface SpectrumRadiusEntry {
  readonly sampleIndex: number;
  readonly radiusDeg: number;
  readonly wavelengthNm: number;
  readonly refractiveIndex: number;
}

const spectrumRadiusCache = new Map<RainbowOrder, readonly SpectrumRadiusEntry[]>();

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function finitePositive(value: number, label: string): number {
  finite(value, label);
  if (value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

export function resolveRainFieldOptions(options: RainFieldOptions = {}): ResolvedRainFieldOptions {
  const resolved: ResolvedRainFieldOptions = {
    ...DEFAULT_RAIN_FIELD_OPTIONS,
    ...options,
    observerPositionM: options.observerPositionM ?? DEFAULT_RAIN_FIELD_OPTIONS.observerPositionM
  };
  if (!Number.isInteger(resolved.dropletCount) || resolved.dropletCount < 1) {
    throw new RangeError("dropletCount must be a positive integer");
  }
  finitePositive(resolved.minimumDistanceM, "minimumDistanceM");
  finitePositive(resolved.maximumDistanceM, "maximumDistanceM");
  if (resolved.maximumDistanceM <= resolved.minimumDistanceM) {
    throw new RangeError("maximumDistanceM must exceed minimumDistanceM");
  }
  finite(resolved.minimumElevationDeg, "minimumElevationDeg");
  finite(resolved.maximumElevationDeg, "maximumElevationDeg");
  if (
    resolved.minimumElevationDeg < -90 ||
    resolved.maximumElevationDeg > 90 ||
    resolved.maximumElevationDeg <= resolved.minimumElevationDeg
  ) {
    throw new RangeError("elevation range must be ordered within -90 to 90 degrees");
  }
  finitePositive(resolved.minimumDiameterMm, "minimumDiameterMm");
  finitePositive(resolved.maximumDiameterMm, "maximumDiameterMm");
  if (resolved.maximumDiameterMm < resolved.minimumDiameterMm) {
    throw new RangeError("maximumDiameterMm must not be below minimumDiameterMm");
  }
  for (const [axis, value] of Object.entries(resolved.observerPositionM)) {
    finite(value, `observerPositionM.${axis}`);
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

function subtract(a: RainFieldVec3, b: RainFieldVec3): RainFieldVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function magnitude(vector: RainFieldVec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector: RainFieldVec3): RainFieldVec3 {
  const length = magnitude(vector);
  if (length === 0) throw new Error("cannot normalize a zero vector");
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function dot(a: RainFieldVec3, b: RainFieldVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function spectrumRadiusEntries(order: RainbowOrder): readonly SpectrumRadiusEntry[] {
  const cached = spectrumRadiusCache.get(order);
  if (cached) return cached;
  const entries = SPECTRAL_SAMPLES.map((sample, sampleIndex) => ({
    sampleIndex,
    radiusDeg: findStationaryRay(sample.waterIndex, order).radiusDeg,
    wavelengthNm: sample.wavelengthNm,
    refractiveIndex: sample.waterIndex
  })).sort((a, b) => a.radiusDeg - b.radiusDeg);
  spectrumRadiusCache.set(order, entries);
  return entries;
}

function solveRefractiveIndexForRadius(
  targetRadiusDeg: number,
  order: RainbowOrder,
  first: SpectrumRadiusEntry,
  second: SpectrumRadiusEntry
): number {
  const radiusForIndex = (refractiveIndex: number): number => {
    const cosineSquared =
      (refractiveIndex * refractiveIndex - 1) / (order * (order + 2));
    const incidence = Math.acos(Math.sqrt(cosineSquared));
    const refraction = Math.asin(Math.sin(incidence) / refractiveIndex);
    const radius = order === 1
      ? 4 * refraction - 2 * incidence
      : Math.PI + 2 * incidence - 6 * refraction;
    return degrees(radius);
  };
  let lowerIndex = first.refractiveIndex;
  let upperIndex = second.refractiveIndex;
  let lowerError = radiusForIndex(lowerIndex) - targetRadiusDeg;
  const upperError = radiusForIndex(upperIndex) - targetRadiusDeg;
  if (Math.abs(lowerError) < 1e-12) return lowerIndex;
  if (Math.abs(upperError) < 1e-12) return upperIndex;
  if (lowerError * upperError > 0) {
    throw new Error("rainbow radius is not bracketed by spectral samples");
  }
  // A fixed iteration bound avoids dynamic caches and keeps classification
  // cost predictable while resolving the sightline well below 1e-9 degrees.
  for (let iteration = 0; iteration < 36; iteration += 1) {
    const middleIndex = (lowerIndex + upperIndex) / 2;
    const middleError = radiusForIndex(middleIndex) - targetRadiusDeg;
    if (Math.abs(middleError) < 1e-12) return middleIndex;
    if (lowerError * middleError <= 0) {
      upperIndex = middleIndex;
    } else {
      lowerIndex = middleIndex;
      lowerError = middleError;
    }
  }
  return (lowerIndex + upperIndex) / 2;
}

/**
 * Build one deterministic representative rain volume. Positions are sampled
 * independently of the Sun, so changing optical conditions never moves a drop.
 */
export function generateRainField(
  options: RainFieldOptions | ResolvedRainFieldOptions = {}
): readonly RainFieldDroplet[] {
  const config = resolveRainFieldOptions(options);
  const random = seededRandom(config.seed);
  const minimumVertical = Math.sin(config.minimumElevationDeg * Math.PI / 180);
  const maximumVertical = Math.sin(config.maximumElevationDeg * Math.PI / 180);
  const minimumDistanceCubed = config.minimumDistanceM ** 3;
  const maximumDistanceCubed = config.maximumDistanceM ** 3;
  const droplets: RainFieldDroplet[] = [];

  for (let index = 0; index < config.dropletCount; index += 1) {
    // Uniform solid-angle sampling over the visible rain sector and uniform
    // volume sampling over range. The point count is representative, not an
    // estimate of the real number of atmospheric droplets.
    const vertical = minimumVertical + (maximumVertical - minimumVertical) * random();
    const horizontal = Math.sqrt(Math.max(0, 1 - vertical * vertical));
    const phase = random() * Math.PI * 2;
    const distance = Math.cbrt(
      minimumDistanceCubed + (maximumDistanceCubed - minimumDistanceCubed) * random()
    );
    const diameterMm =
      config.minimumDiameterMm +
      (config.maximumDiameterMm - config.minimumDiameterMm) * random();
    droplets.push({
      id: `drop-${index.toString().padStart(6, "0")}`,
      index,
      positionM: {
        x: config.observerPositionM.x + horizontal * Math.cos(phase) * distance,
        y: config.observerPositionM.y + vertical * distance,
        z: config.observerPositionM.z + horizontal * Math.sin(phase) * distance
      },
      diameterMm
    });
  }
  return droplets;
}

/**
 * Match an observer-centred angular radius to the dominant rainbow-caustic
 * wavelength. Within the visible band, the refractive index is solved so the
 * stationary ray exits at the exact selected sightline angle.
 */
export function rainbowSpectrumMatch(
  apparentRadiusDeg: number,
  order: RainbowOrder
): RainbowSpectrumMatch {
  finite(apparentRadiusDeg, "apparentRadiusDeg");
  const entries = spectrumRadiusEntries(order);
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (!first || !last) throw new Error("visible spectrum is empty");

  let nearest = first;
  for (const entry of entries) {
    if (Math.abs(entry.radiusDeg - apparentRadiusDeg) < Math.abs(nearest.radiusDeg - apparentRadiusDeg)) {
      nearest = entry;
    }
  }

  const contributes = apparentRadiusDeg >= first.radiusDeg && apparentRadiusDeg <= last.radiusDeg;
  if (!contributes) {
    return {
      contributes: false,
      apparentRadiusDeg,
      minimumRadiusDeg: first.radiusDeg,
      maximumRadiusDeg: last.radiusDeg,
      dominantWavelengthNm: null,
      refractiveIndex: null,
      targetRadiusDeg: nearest.radiusDeg,
      angularErrorDeg: apparentRadiusDeg - nearest.radiusDeg,
      nearestWavelengthNm: nearest.wavelengthNm,
      nearestRefractiveIndex: nearest.refractiveIndex,
      nearestRadiusDeg: nearest.radiusDeg,
      lowerSampleIndex: nearest.sampleIndex,
      upperSampleIndex: nearest.sampleIndex,
      colorMix: 0
    };
  }

  let lower = first;
  let upper = first;
  for (let index = 0; index < entries.length - 1; index += 1) {
    const candidateLower = entries[index];
    const candidateUpper = entries[index + 1];
    if (
      candidateLower &&
      candidateUpper &&
      apparentRadiusDeg >= candidateLower.radiusDeg &&
      apparentRadiusDeg <= candidateUpper.radiusDeg
    ) {
      lower = candidateLower;
      upper = candidateUpper;
      break;
    }
  }
  const refractiveIndex = lower === upper
    ? lower.refractiveIndex
    : solveRefractiveIndexForRadius(apparentRadiusDeg, order, lower, upper);
  const indexSpan = upper.refractiveIndex - lower.refractiveIndex;
  const colorMix = indexSpan === 0
    ? 0
    : clamp((refractiveIndex - lower.refractiveIndex) / indexSpan, 0, 1);
  const dominantWavelengthNm =
    lower.wavelengthNm + (upper.wavelengthNm - lower.wavelengthNm) * colorMix;
  // The bounded solve above already targets this exact sightline. Reusing the
  // apparent angle avoids another object allocation for every contributor.
  const solvedRadiusDeg = apparentRadiusDeg;
  return {
    contributes: true,
    apparentRadiusDeg,
    minimumRadiusDeg: first.radiusDeg,
    maximumRadiusDeg: last.radiusDeg,
    dominantWavelengthNm,
    refractiveIndex,
    targetRadiusDeg: solvedRadiusDeg,
    angularErrorDeg: apparentRadiusDeg - solvedRadiusDeg,
    nearestWavelengthNm: nearest.wavelengthNm,
    nearestRefractiveIndex: nearest.refractiveIndex,
    nearestRadiusDeg: nearest.radiusDeg,
    lowerSampleIndex: lower.sampleIndex,
    upperSampleIndex: upper.sampleIndex,
    colorMix
  };
}

export function observeRainDroplet(
  droplet: RainFieldDroplet,
  observerPositionM: RainFieldVec3,
  sunDirection: RainFieldVec3,
  order: RainbowOrder
): RainDropletObservation {
  const offset = subtract(droplet.positionM, observerPositionM);
  const distanceFromObserverM = magnitude(offset);
  const sightline = normalize(offset);
  const normalizedSun = normalize(sunDirection);
  const antisolar = {
    x: -normalizedSun.x,
    y: -normalizedSun.y,
    z: -normalizedSun.z
  };
  const apparentRadiusDeg = degrees(Math.acos(clamp(dot(sightline, antisolar), -1, 1)));
  return {
    dropletId: droplet.id,
    dropletIndex: droplet.index,
    distanceFromObserverM,
    ...rainbowSpectrumMatch(apparentRadiusDeg, order)
  };
}

export function observeRainField(
  droplets: readonly RainFieldDroplet[],
  observerPositionM: RainFieldVec3,
  sunDirection: RainFieldVec3,
  order: RainbowOrder
): readonly RainDropletObservation[] {
  return droplets.map((droplet) =>
    observeRainDroplet(droplet, observerPositionM, sunDirection, order)
  );
}
