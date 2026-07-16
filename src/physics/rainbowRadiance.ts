import {
  SPECTRAL_SAMPLES,
  findStationaryRay,
  type RainbowOrder
} from "./rainbow";

export interface LinearRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface RainbowRadianceSample extends LinearRgb {
  readonly radiusDeg: number;
  readonly relativeLuminance: number;
  readonly alpha: number;
}

export interface RainbowRadianceProfile {
  readonly order: RainbowOrder;
  readonly minimumRadiusDeg: number;
  readonly maximumRadiusDeg: number;
  readonly samples: readonly RainbowRadianceSample[];
}

const MINIMUM_WAVELENGTH_NM = 380;
const MAXIMUM_WAVELENGTH_NM = 780;
const WAVELENGTH_STEP_NM = 4;
const RADIANCE_PADDING_DEG = 1.35;
const SOLAR_DISK_SIGMA_DEG = 0.53 / Math.sqrt(12);
const DROP_DISTRIBUTION_SIGMA_DEG = 0.105;
const SOLAR_TEMPERATURE_K = 5_778;
const SECOND_RADIATION_CONSTANT_M_K = 1.438_776_877e-2;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function gaussian(value: number): number {
  return Math.exp(-0.5 * value * value);
}

function cieXyz1931(wavelengthNm: number): readonly [number, number, number] {
  const x1 =
    (wavelengthNm - 442) * (wavelengthNm < 442 ? 0.0624 : 0.0374);
  const x2 =
    (wavelengthNm - 599.8) * (wavelengthNm < 599.8 ? 0.0264 : 0.0323);
  const x3 =
    (wavelengthNm - 501.1) * (wavelengthNm < 501.1 ? 0.049 : 0.0382);
  const y1 =
    (wavelengthNm - 568.8) * (wavelengthNm < 568.8 ? 0.0213 : 0.0247);
  const y2 =
    (wavelengthNm - 530.9) * (wavelengthNm < 530.9 ? 0.0613 : 0.0322);
  const z1 =
    (wavelengthNm - 437) * (wavelengthNm < 437 ? 0.0845 : 0.0278);
  const z2 =
    (wavelengthNm - 459) * (wavelengthNm < 459 ? 0.0385 : 0.0725);
  return [
    0.362 * gaussian(x1) + 1.056 * gaussian(x2) - 0.065 * gaussian(x3),
    0.821 * gaussian(y1) + 0.286 * gaussian(y2),
    1.217 * gaussian(z1) + 0.681 * gaussian(z2)
  ];
}

function xyzToLinearSrgb(x: number, y: number, z: number): LinearRgb {
  return {
    r: Math.max(0, 3.2406 * x - 1.5372 * y - 0.4986 * z),
    g: Math.max(0, -0.9689 * x + 1.8758 * y + 0.0415 * z),
    b: Math.max(0, 0.0557 * x - 0.204 * y + 1.057 * z)
  };
}

function blackbodySpectralRadiance(wavelengthNm: number): number {
  const wavelengthM = wavelengthNm * 1e-9;
  return (
    1 /
    (Math.pow(wavelengthM, 5) *
      Math.expm1(
        SECOND_RADIATION_CONSTANT_M_K /
          (wavelengthM * SOLAR_TEMPERATURE_K)
      ))
  );
}

const SOLAR_REFERENCE_RADIANCE = blackbodySpectralRadiance(555);

function relativeSolarSpectrum(wavelengthNm: number): number {
  return blackbodySpectralRadiance(wavelengthNm) / SOLAR_REFERENCE_RADIANCE;
}

function interpolatePair(
  wavelengthNm: number,
  lower: (typeof SPECTRAL_SAMPLES)[number],
  upper: (typeof SPECTRAL_SAMPLES)[number]
): number {
  const mix =
    (wavelengthNm - lower.wavelengthNm) /
    (upper.wavelengthNm - lower.wavelengthNm);
  return lower.waterIndex + (upper.waterIndex - lower.waterIndex) * mix;
}

function interpolateWaterIndex(wavelengthNm: number): number {
  const samples = [...SPECTRAL_SAMPLES].sort(
    (first, second) => first.wavelengthNm - second.wavelengthNm
  );
  const first = samples[0];
  const second = samples[1];
  const penultimate = samples.at(-2);
  const last = samples.at(-1);
  if (!first || !second || !penultimate || !last) {
    throw new Error("visible spectrum requires at least four samples");
  }
  if (wavelengthNm <= first.wavelengthNm) {
    return interpolatePair(wavelengthNm, first, second);
  }
  if (wavelengthNm >= last.wavelengthNm) {
    return interpolatePair(wavelengthNm, penultimate, last);
  }
  for (let index = 0; index < samples.length - 1; index += 1) {
    const lower = samples[index];
    const upper = samples[index + 1];
    if (!lower || !upper) continue;
    if (wavelengthNm < lower.wavelengthNm || wavelengthNm > upper.wavelengthNm) continue;
    return interpolatePair(wavelengthNm, lower, upper);
  }
  return last.waterIndex;
}

function spectralCausticWeight(
  radiusDeg: number,
  stationaryRadiusDeg: number,
  order: RainbowOrder
): number {
  const sigmaDeg = Math.hypot(
    SOLAR_DISK_SIGMA_DEG,
    DROP_DISTRIBUTION_SIGMA_DEG * (order === 1 ? 1 : 1.28)
  );
  const offset = radiusDeg - stationaryRadiusDeg;
  const brightSideOffset = order === 1 ? -offset : offset;
  const asymmetry = 1 + 0.28 * Math.tanh(brightSideOffset / (sigmaDeg * 1.35));
  const core = gaussian(offset / sigmaDeg) * asymmetry;
  const brightSideTail =
    brightSideOffset > 0
      ? 0.1 * Math.exp(-brightSideOffset / (sigmaDeg * 3.2))
      : 0;
  return core + brightSideTail;
}

/**
 * Relative, display-oriented spectral radiance near the rainbow caustic.
 *
 * This is intentionally not an absolute-radiance or full Lorenz–Mie solver.
 * It integrates 380–780 nm, weights the incident light by a relative 5778 K
 * solar blackbody spectrum, converts it through an analytic CIE 1931 observer,
 * and smooths the stationary-ray angles by the finite solar disk and a modest
 * drop-size spread. The result is the unresolved far-field bow; individual
 * deterministic drops remain a separate selectable layer.
 */
export function buildRainbowRadianceProfile(
  order: RainbowOrder,
  radialSampleCount = 128
): RainbowRadianceProfile {
  if (!Number.isInteger(radialSampleCount) || radialSampleCount < 8) {
    throw new RangeError("radialSampleCount must be an integer of at least 8");
  }

  const spectrum: Array<{
    wavelengthNm: number;
    stationaryRadiusDeg: number;
    xyz: readonly [number, number, number];
    solarWeight: number;
  }> = [];
  for (
    let wavelengthNm = MINIMUM_WAVELENGTH_NM;
    wavelengthNm <= MAXIMUM_WAVELENGTH_NM + 1e-9;
    wavelengthNm += WAVELENGTH_STEP_NM
  ) {
    const refractiveIndex = interpolateWaterIndex(wavelengthNm);
    spectrum.push({
      wavelengthNm,
      stationaryRadiusDeg: findStationaryRay(refractiveIndex, order).radiusDeg,
      xyz: cieXyz1931(wavelengthNm),
      solarWeight: relativeSolarSpectrum(wavelengthNm)
    });
  }

  const stationaryRadii = spectrum.map((sample) => sample.stationaryRadiusDeg);
  const minimumRadiusDeg = Math.min(...stationaryRadii) - RADIANCE_PADDING_DEG;
  const maximumRadiusDeg = Math.max(...stationaryRadii) + RADIANCE_PADDING_DEG;
  const raw: Array<{
    radiusDeg: number;
    rgb: LinearRgb;
    luminance: number;
    radiantPower: number;
  }> = [];
  let maximumLuminance = 0;
  let maximumRadiantPower = 0;

  for (let index = 0; index < radialSampleCount; index += 1) {
    const radiusDeg =
      minimumRadiusDeg +
      (maximumRadiusDeg - minimumRadiusDeg) * (index / (radialSampleCount - 1));
    let x = 0;
    let y = 0;
    let z = 0;
    let radiantPower = 0;
    for (const spectralSample of spectrum) {
      const weight = spectralCausticWeight(
        radiusDeg,
        spectralSample.stationaryRadiusDeg,
        order
      );
      const weightedPower = weight * spectralSample.solarWeight;
      x += spectralSample.xyz[0] * weightedPower;
      y += spectralSample.xyz[1] * weightedPower;
      z += spectralSample.xyz[2] * weightedPower;
      radiantPower += weightedPower;
    }
    const rgb = xyzToLinearSrgb(x, y, z);
    const luminance = Math.max(0, y);
    maximumLuminance = Math.max(maximumLuminance, luminance);
    maximumRadiantPower = Math.max(maximumRadiantPower, radiantPower);
    raw.push({ radiusDeg, rgb, luminance, radiantPower });
  }

  const safeMaximumLuminance = maximumLuminance || 1;
  const safeMaximumRadiantPower = maximumRadiantPower || 1;
  const samples = raw.map((sample): RainbowRadianceSample => {
    const relativeLuminance = clamp01(sample.luminance / safeMaximumLuminance);
    const relativeRadiantPower = clamp01(
      sample.radiantPower / safeMaximumRadiantPower
    );
    const displayStrength =
      0.42 * relativeLuminance + 0.58 * relativeRadiantPower;
    const maximumChannel = Math.max(sample.rgb.r, sample.rgb.g, sample.rgb.b, 1e-9);
    const saturationScale = 1 / maximumChannel;
    const whiteMix = 0.18 + 0.22 * relativeLuminance;
    const r = clamp01(sample.rgb.r * saturationScale * (1 - whiteMix) + whiteMix);
    const g = clamp01(sample.rgb.g * saturationScale * (1 - whiteMix) + whiteMix);
    const b = clamp01(sample.rgb.b * saturationScale * (1 - whiteMix) + whiteMix);
    return {
      radiusDeg: sample.radiusDeg,
      relativeLuminance,
      alpha: Math.pow(displayStrength, 0.72) * (order === 1 ? 0.66 : 0.38),
      r,
      g,
      b
    };
  });

  return {
    order,
    minimumRadiusDeg,
    maximumRadiusDeg,
    samples
  };
}
