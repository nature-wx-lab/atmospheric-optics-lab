export type RainbowOrder = 1 | 2;

export interface SpectralSample {
  readonly label: string;
  readonly wavelengthNm: number;
  readonly waterIndex: number;
  readonly iceIndex: number;
  readonly color: string;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface StationaryRay {
  readonly order: RainbowOrder;
  readonly internalReflections: RainbowOrder;
  readonly refractiveIndex: number;
  readonly incidenceDeg: number;
  readonly refractionDeg: number;
  readonly radiusDeg: number;
  readonly scatteringDeg: number;
  readonly impactParameter: number;
}

export interface DropletRayTrace extends StationaryRay {
  readonly points: readonly Vec2[];
  readonly outgoing: Vec2;
  readonly lossBranches: readonly DropletLossBranch[];
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

// Fixed visible-spectrum samples for the educational beta. The values follow
// the wavelength dependence in IAPWS R9-97 near 20 °C and are intentionally
// kept explicit so every displayed angle is reproducible.
export const SPECTRAL_SAMPLES: readonly SpectralSample[] = [
  { label: "赤", wavelengthNm: 656.3, waterIndex: 1.3311, iceIndex: 1.3069, color: "#ff3f36" },
  { label: "橙", wavelengthNm: 620, waterIndex: 1.3320, iceIndex: 1.3075, color: "#ff8a2b" },
  { label: "黄", wavelengthNm: 580, waterIndex: 1.3330, iceIndex: 1.3090, color: "#ffe45d" },
  { label: "緑", wavelengthNm: 530, waterIndex: 1.3352, iceIndex: 1.3106, color: "#52e47a" },
  { label: "青緑", wavelengthNm: 490, waterIndex: 1.3374, iceIndex: 1.3130, color: "#4ce2e5" },
  { label: "青", wavelengthNm: 450, waterIndex: 1.3400, iceIndex: 1.3170, color: "#4b78ff" },
  { label: "紫", wavelengthNm: 404.7, waterIndex: 1.3428, iceIndex: 1.3194, color: "#a263ff" }
] as const;

export const degrees = (radians: number): number => (radians * 180) / Math.PI;
export const radians = (degreesValue: number): number => (degreesValue * Math.PI) / 180;

const stationaryRayCache = new Map<string, StationaryRay>();

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
  const cacheKey = `${order}:${refractiveIndex}`;
  const cached = stationaryRayCache.get(cacheKey);
  if (cached) return cached;

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
  const result = Object.freeze({
    order,
    internalReflections: order,
    refractiveIndex,
    incidenceDeg: degrees(incidence),
    refractionDeg: degrees(refraction),
    radiusDeg: degrees(radius),
    scatteringDeg: 180 - degrees(radius),
    impactParameter: Math.sin(incidence)
  });
  stationaryRayCache.set(cacheKey, result);
  return result;
}

function nextCircleIntersection(point: Vec2, direction: Vec2): Vec2 {
  const ray = normalize(direction);
  const distance = -2 * dot(point, ray);
  if (!(distance > 1e-8)) throw new Error("ray does not intersect the droplet again");
  return add(point, scale(ray, distance));
}

export function traceDropletRay(
  refractiveIndex: number,
  order: RainbowOrder
): DropletRayTrace {
  const stationary = findStationaryRay(refractiveIndex, order);
  const incoming: Vec2 = { x: 1, y: 0 };
  const impact = stationary.impactParameter;
  const entry: Vec2 = { x: -Math.sqrt(1 - impact * impact), y: impact };
  const beforeEntry = add(entry, scale(incoming, -1.35));
  const inside = refract2D(incoming, entry, 1, refractiveIndex);
  if (!inside) throw new Error("unexpected total internal reflection at droplet entry");

  const points: Vec2[] = [beforeEntry, entry];
  const lossBranches: DropletLossBranch[] = [];
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
    direction = reflect2D(direction, point);
  }

  point = nextCircleIntersection(point, direction);
  points.push(point);
  const outgoing = refract2D(direction, scale(point, -1), refractiveIndex, 1);
  if (!outgoing) throw new Error("unexpected total internal reflection at droplet exit");
  points.push(add(point, scale(outgoing, 1.9)));

  return { ...stationary, points, outgoing, lossBranches };
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
