export type RainbowOrder = 1 | 2;

export interface SpectralSample {
  readonly label: string;
  readonly wavelengthNm: number;
  readonly waterIndex: number;
  readonly vacuumWaterIndex: number;
  readonly airIndex: number;
  readonly iceIndex: number;
  readonly color: string;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface DropletRayGeometry {
  readonly order: RainbowOrder;
  readonly internalReflections: RainbowOrder;
  readonly refractiveIndex: number;
  readonly incidenceDeg: number;
  readonly refractionDeg: number;
  readonly radiusDeg: number;
  readonly scatteringDeg: number;
  readonly impactParameter: number;
}

export interface StationaryRay extends DropletRayGeometry {}

export interface DropletRayTrace extends DropletRayGeometry {
  readonly points: readonly Vec2[];
  readonly outgoing: Vec2;
  readonly lossBranches: readonly DropletLossBranch[];
  readonly interfaceEvents: readonly DropletInterfaceEvent[];
}

export interface DropletInterfaceEvent {
  readonly kind: "entry-refraction" | "internal-reflection" | "exit-refraction";
  readonly reflectionIndex: number | null;
  readonly point: Vec2;
  readonly outwardNormal: Vec2;
  readonly incident: Vec2;
  readonly outgoing: Vec2;
  readonly incidenceDeg: number;
  readonly outgoingDeg: number;
  readonly refractiveIndexFrom: number;
  readonly refractiveIndexTo: number;
}

export interface DropletLossBranch {
  readonly reflectionIndex: number;
  readonly start: Vec2;
  readonly end: Vec2;
  readonly outgoing: Vec2;
}

export interface FresnelPower {
  readonly sReflectance: number;
  readonly pReflectance: number;
  readonly unpolarizedReflectance: number;
  readonly unpolarizedTransmittance: number;
}

export const REFERENCE_WATER_TEMPERATURE_C = 20;
export const REFERENCE_WATER_DENSITY_KG_M3 = 998.2071;
export const REFERENCE_AIR_PRESSURE_PA = 101_325;
const CIDDOR_STANDARD_AIR_TEMPERATURE_C = 15;
const CIDDOR_GAS_CONSTANT = 8.314472;
const CIDDOR_DRY_AIR_MOLAR_MASS_KG_MOL =
  1e-3 * (28.9635 + 12.011e-6 * (450 - 400));

/** Vacuum refractive index from IAPWS R9-97, Eq. (1). */
export function iapwsWaterRefractiveIndex(
  wavelengthNm: number,
  temperatureC = REFERENCE_WATER_TEMPERATURE_C,
  densityKgM3 = REFERENCE_WATER_DENSITY_KG_M3
): number {
  if (!Number.isFinite(wavelengthNm) || wavelengthNm < 200 || wavelengthNm > 1_100) {
    throw new RangeError("IAPWS wavelength must be within 200 to 1100 nm");
  }
  if (!Number.isFinite(temperatureC) || temperatureC < -12 || temperatureC > 500) {
    throw new RangeError("IAPWS temperature must be within -12 to 500 degrees Celsius");
  }
  if (!Number.isFinite(densityKgM3) || densityKgM3 < 0 || densityKgM3 > 1_060) {
    throw new RangeError("IAPWS density must be within 0 to 1060 kg/m3");
  }
  const density = densityKgM3 / 1_000;
  const temperature = (temperatureC + 273.15) / 273.15;
  const wavelength = wavelengthNm / 1_000 / 0.589;
  const wavelengthSquared = wavelength * wavelength;
  const uvPoleSquared = 0.2292020 ** 2;
  const infraredPoleSquared = 5.432937 ** 2;
  const lorentzLorenzPerDensity =
    0.244257733 +
    9.74634476e-3 * density -
    3.73234996e-3 * temperature +
    2.68678472e-4 * wavelengthSquared * temperature +
    1.58920570e-3 / wavelengthSquared +
    2.45934259e-3 / (wavelengthSquared - uvPoleSquared) +
    0.900704920 / (wavelengthSquared - infraredPoleSquared) -
    1.66626219e-2 * density * density;
  const lorentzLorenz = density * lorentzLorenzPerDensity;
  return Math.sqrt((1 + 2 * lorentzLorenz) / (1 - lorentzLorenz));
}

/** Ciddor Eq. (12), reduced to dry air (water-vapour mole fraction xw = 0). */
function ciddorDryAirCompressibility(
  temperatureC: number,
  pressurePa: number
): number {
  const temperatureK = temperatureC + 273.15;
  const firstVirial =
    1.58123e-6 -
    2.9331e-8 * temperatureC +
    1.1043e-10 * temperatureC * temperatureC;
  return 1 -
    (pressurePa / temperatureK) * firstVirial +
    (pressurePa / temperatureK) ** 2 * 1.83e-11;
}

function ciddorDryAirDensity(
  temperatureC: number,
  pressurePa: number
): number {
  const temperatureK = temperatureC + 273.15;
  return pressurePa * CIDDOR_DRY_AIR_MOLAR_MASS_KG_MOL /
    (
      ciddorDryAirCompressibility(temperatureC, pressurePa) *
      CIDDOR_GAS_CONSTANT *
      temperatureK
    );
}

/**
 * Ciddor dry-air phase index for 450 ppm CO2. The standard-air dispersion is
 * scaled by the ratio of real-gas densities, including Ciddor compressibility.
 * Humidity and CO2 variation remain outside this reference atmosphere.
 */
export function referenceDryAirRefractiveIndex(
  wavelengthNm: number,
  temperatureC = REFERENCE_WATER_TEMPERATURE_C,
  pressurePa = REFERENCE_AIR_PRESSURE_PA
): number {
  if (!Number.isFinite(wavelengthNm) || wavelengthNm < 350 || wavelengthNm > 1_700) {
    throw new RangeError("air wavelength must be within 350 to 1700 nm");
  }
  if (!Number.isFinite(temperatureC) || temperatureC <= -273.15) {
    throw new RangeError("air temperature must be above absolute zero");
  }
  if (!Number.isFinite(pressurePa) || pressurePa <= 0) {
    throw new RangeError("air pressure must be positive");
  }
  const inverseMicrometres = 1_000 / wavelengthNm;
  const inverseSquared = inverseMicrometres * inverseMicrometres;
  const standardRefractivity = 1e-8 * (
    5_792_105 / (238.0185 - inverseSquared) +
    167_917 / (57.362 - inverseSquared)
  );
  const densityScale = ciddorDryAirDensity(temperatureC, pressurePa) /
    ciddorDryAirDensity(CIDDOR_STANDARD_AIR_TEMPERATURE_C, REFERENCE_AIR_PRESSURE_PA);
  return 1 + standardRefractivity * densityScale;
}

export function referenceRelativeWaterIndex(wavelengthNm: number): number {
  return iapwsWaterRefractiveIndex(wavelengthNm) /
    referenceDryAirRefractiveIndex(wavelengthNm);
}

function spectralSample(
  label: string,
  wavelengthNm: number,
  iceIndex: number,
  color: string
): SpectralSample {
  const vacuumWaterIndex = iapwsWaterRefractiveIndex(wavelengthNm);
  const airIndex = referenceDryAirRefractiveIndex(wavelengthNm);
  return Object.freeze({
    label,
    wavelengthNm,
    waterIndex: vacuumWaterIndex / airIndex,
    vacuumWaterIndex,
    airIndex,
    iceIndex,
    color
  });
}

// Seven fixed display wavelengths. Water indices are calculated at module
// load from IAPWS R9-97 and divided by the reference dry-air index, because
// Snell's law requires the relative water/air index used by this model.
export const SPECTRAL_SAMPLES: readonly SpectralSample[] = [
  spectralSample("赤", 656.3, 1.3069, "#ff3f36"),
  spectralSample("橙", 620, 1.3075, "#ff8a2b"),
  spectralSample("黄", 580, 1.3090, "#ffe45d"),
  spectralSample("緑", 530, 1.3106, "#52e47a"),
  spectralSample("青緑", 490, 1.3130, "#4ce2e5"),
  spectralSample("青", 450, 1.3170, "#4b78ff"),
  spectralSample("紫", 404.7, 1.3194, "#a263ff")
] as const;

export const degrees = (radians: number): number => (radians * 180) / Math.PI;
export const radians = (degreesValue: number): number => (degreesValue * Math.PI) / 180;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (v: Vec2, factor: number): Vec2 => ({ x: v.x * factor, y: v.y * factor });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const length = (v: Vec2): number => Math.hypot(v.x, v.y);
const normalize = (v: Vec2): Vec2 => {
  const magnitude = length(v);
  if (magnitude === 0) throw new Error("cannot normalize a zero vector");
  return scale(v, 1 / magnitude);
};

export function reflect2D(incident: Vec2, surfaceNormal: Vec2): Vec2 {
  const normal = normalize(surfaceNormal);
  return normalize(add(incident, scale(normal, -2 * dot(incident, normal))));
}

export function refract2D(
  incident: Vec2,
  opposingNormal: Vec2,
  refractiveIndexFrom: number,
  refractiveIndexTo: number
): Vec2 | null {
  const ray = normalize(incident);
  const normal = normalize(opposingNormal);
  const eta = refractiveIndexFrom / refractiveIndexTo;
  const cosine = clamp(-dot(normal, ray), -1, 1);
  const discriminant = 1 - eta * eta * (1 - cosine * cosine);
  if (discriminant < 0) return null;
  return normalize(
    add(scale(ray, eta), scale(normal, eta * cosine - Math.sqrt(discriminant)))
  );
}

export function rainbowRadiusRadians(
  refractiveIndex: number,
  order: RainbowOrder,
  incidenceRadians: number
): number {
  const refraction = Math.asin(Math.sin(incidenceRadians) / refractiveIndex);
  if (order === 1) return 4 * refraction - 2 * incidenceRadians;
  return Math.PI + 2 * incidenceRadians - 6 * refraction;
}

export function fresnelPower(
  incidenceDeg: number,
  refractiveIndexFrom: number,
  refractiveIndexTo: number
): FresnelPower {
  if (!(refractiveIndexFrom > 0) || !(refractiveIndexTo > 0)) {
    throw new RangeError("refractive indices must be positive");
  }
  const incidence = radians(incidenceDeg);
  if (incidence < 0 || incidence > Math.PI / 2) {
    throw new RangeError("incidence angle must be between 0 and 90 degrees");
  }
  const transmittedSine =
    (refractiveIndexFrom / refractiveIndexTo) * Math.sin(incidence);
  if (transmittedSine >= 1) {
    return {
      sReflectance: 1,
      pReflectance: 1,
      unpolarizedReflectance: 1,
      unpolarizedTransmittance: 0
    };
  }
  const transmitted = Math.asin(transmittedSine);
  const cosineIncident = Math.cos(incidence);
  const cosineTransmitted = Math.cos(transmitted);
  const sAmplitude =
    (refractiveIndexFrom * cosineIncident -
      refractiveIndexTo * cosineTransmitted) /
    (refractiveIndexFrom * cosineIncident +
      refractiveIndexTo * cosineTransmitted);
  const pAmplitude =
    (refractiveIndexTo * cosineIncident -
      refractiveIndexFrom * cosineTransmitted) /
    (refractiveIndexTo * cosineIncident +
      refractiveIndexFrom * cosineTransmitted);
  const sReflectance = sAmplitude * sAmplitude;
  const pReflectance = pAmplitude * pAmplitude;
  const unpolarizedReflectance = (sReflectance + pReflectance) / 2;
  return {
    sReflectance,
    pReflectance,
    unpolarizedReflectance,
    unpolarizedTransmittance: 1 - unpolarizedReflectance
  };
}

export function findStationaryRay(
  refractiveIndex: number,
  order: RainbowOrder
): StationaryRay {
  if (!(refractiveIndex > 1)) throw new RangeError("refractive index must be greater than 1");

  // dD/di = 0 gives cos²(i) = (n² - 1) / (k(k + 2)), where k is
  // the number of internal reflections. This is the rainbow caustic ray.
  const cosineSquared =
    (refractiveIndex * refractiveIndex - 1) / (order * (order + 2));
  if (!(cosineSquared > 0 && cosineSquared < 1)) {
    throw new RangeError("refractive index does not produce this stationary rainbow ray");
  }
  const incidence = Math.acos(Math.sqrt(cosineSquared));
  const refraction = Math.asin(Math.sin(incidence) / refractiveIndex);
  const radius = rainbowRadiusRadians(refractiveIndex, order, incidence);
  return Object.freeze({
    order,
    internalReflections: order,
    refractiveIndex,
    incidenceDeg: degrees(incidence),
    refractionDeg: degrees(refraction),
    radiusDeg: degrees(radius),
    scatteringDeg: 180 - degrees(radius),
    impactParameter: Math.sin(incidence)
  });
}

function nextCircleIntersection(point: Vec2, direction: Vec2): Vec2 {
  const ray = normalize(direction);
  const distance = -2 * dot(point, ray);
  if (!(distance > 1e-8)) throw new Error("ray does not intersect the droplet again");
  return add(point, scale(ray, distance));
}

function acuteSurfaceAngleDeg(direction: Vec2, outwardNormal: Vec2): number {
  return degrees(
    Math.acos(clamp(Math.abs(dot(normalize(direction), normalize(outwardNormal))), -1, 1))
  );
}

/**
 * Trace one geometrical ray through a spherical drop at a fixed impact
 * parameter. Keeping this parameter common across wavelengths represents one
 * overlapping white incident beam that disperses only after the air-water
 * interface.
 */
export function traceDropletRayAtImpact(
  refractiveIndex: number,
  order: RainbowOrder,
  impactParameter: number
): DropletRayTrace {
  if (!(refractiveIndex > 1)) throw new RangeError("refractive index must be greater than 1");
  if (!Number.isFinite(impactParameter) || impactParameter < 0 || impactParameter >= 1) {
    throw new RangeError("impact parameter must be finite and within 0 <= b < 1");
  }
  const incidence = Math.asin(impactParameter);
  const refraction = Math.asin(Math.sin(incidence) / refractiveIndex);
  const radius = rainbowRadiusRadians(refractiveIndex, order, incidence);
  const rayGeometry: DropletRayGeometry = {
    order,
    internalReflections: order,
    refractiveIndex,
    incidenceDeg: degrees(incidence),
    refractionDeg: degrees(refraction),
    radiusDeg: degrees(radius),
    scatteringDeg: 180 - degrees(radius),
    impactParameter
  };
  const incoming: Vec2 = { x: 1, y: 0 };
  const entry: Vec2 = {
    x: -Math.sqrt(1 - impactParameter * impactParameter),
    y: impactParameter
  };
  const beforeEntry = add(entry, scale(incoming, -1.35));
  const inside = refract2D(incoming, entry, 1, refractiveIndex);
  if (!inside) throw new Error("unexpected total internal reflection at droplet entry");

  const points: Vec2[] = [beforeEntry, entry];
  const lossBranches: DropletLossBranch[] = [];
  const interfaceEvents: DropletInterfaceEvent[] = [
    {
      kind: "entry-refraction",
      reflectionIndex: null,
      point: entry,
      outwardNormal: normalize(entry),
      incident: incoming,
      outgoing: inside,
      incidenceDeg: acuteSurfaceAngleDeg(incoming, entry),
      outgoingDeg: acuteSurfaceAngleDeg(inside, entry),
      refractiveIndexFrom: 1,
      refractiveIndexTo: refractiveIndex
    }
  ];
  let point = entry;
  let direction = inside;
  for (let reflection = 0; reflection < order; reflection += 1) {
    point = nextCircleIntersection(point, direction);
    points.push(point);
    const escaped = refract2D(direction, scale(point, -1), refractiveIndex, 1);
    if (escaped) {
      lossBranches.push({
        reflectionIndex: reflection + 1,
        start: point,
        end: add(point, scale(escaped, 1.45)),
        outgoing: escaped
      });
    }
    const reflected = reflect2D(direction, point);
    interfaceEvents.push({
      kind: "internal-reflection",
      reflectionIndex: reflection + 1,
      point,
      outwardNormal: normalize(point),
      incident: direction,
      outgoing: reflected,
      incidenceDeg: acuteSurfaceAngleDeg(direction, point),
      outgoingDeg: acuteSurfaceAngleDeg(reflected, point),
      refractiveIndexFrom: refractiveIndex,
      // Reflection happens at the water-air boundary even though the chosen
      // branch remains in water. Keeping the second medium explicit lets the
      // same event drive the physically correct Fresnel readout.
      refractiveIndexTo: 1
    });
    direction = reflected;
  }

  point = nextCircleIntersection(point, direction);
  points.push(point);
  const outgoing = refract2D(direction, scale(point, -1), refractiveIndex, 1);
  if (!outgoing) throw new Error("unexpected total internal reflection at droplet exit");
  points.push(add(point, scale(outgoing, 1.9)));
  interfaceEvents.push({
    kind: "exit-refraction",
    reflectionIndex: null,
    point,
    outwardNormal: normalize(point),
    incident: direction,
    outgoing,
    incidenceDeg: acuteSurfaceAngleDeg(direction, point),
    outgoingDeg: acuteSurfaceAngleDeg(outgoing, point),
    refractiveIndexFrom: refractiveIndex,
    refractiveIndexTo: 1
  });

  const scatteringDeg = degrees(
    Math.acos(clamp(dot(normalize(incoming), normalize(outgoing)), -1, 1))
  );
  return {
    ...rayGeometry,
    radiusDeg: 180 - scatteringDeg,
    scatteringDeg,
    points,
    outgoing,
    lossBranches,
    interfaceEvents
  };
}

export function traceDropletRay(
  refractiveIndex: number,
  order: RainbowOrder
): DropletRayTrace {
  const stationary = findStationaryRay(refractiveIndex, order);
  return {
    ...traceDropletRayAtImpact(refractiveIndex, order, stationary.impactParameter),
    ...stationary
  };
}

export function rainbowAngleRange(order: RainbowOrder): {
  readonly minimumDeg: number;
  readonly maximumDeg: number;
  readonly redDeg: number;
  readonly violetDeg: number;
} {
  const redSample = SPECTRAL_SAMPLES[0];
  const violetSample = SPECTRAL_SAMPLES[SPECTRAL_SAMPLES.length - 1];
  if (!redSample || !violetSample) throw new Error("spectrum is empty");
  const redDeg = findStationaryRay(redSample.waterIndex, order).radiusDeg;
  const violetDeg = findStationaryRay(violetSample.waterIndex, order).radiusDeg;
  return {
    minimumDeg: Math.min(redDeg, violetDeg),
    maximumDeg: Math.max(redDeg, violetDeg),
    redDeg,
    violetDeg
  };
}

export function prismMinimumDeviationDeg(refractiveIndex: number, apexDeg: number): number {
  const apex = radians(apexDeg);
  const argument = refractiveIndex * Math.sin(apex / 2);
  if (Math.abs(argument) > 1) throw new RangeError("prism has no symmetric transmitted ray");
  return degrees(2 * Math.asin(argument) - apex);
}
