import { SPECTRAL_SAMPLES, degrees, radians } from "./rainbow";

export type HaloRingId = "halo-22" | "halo-46";

export type HaloPhenomenonId =
  | HaloRingId
  | "sundog"
  | "circumzenithal-arc"
  | "upper-tangent-arc"
  | "circumhorizontal-arc";

export type CrystalOrientation =
  | "random"
  | "horizontal-plate"
  | "horizontal-column";

export type HaloDisplayShape =
  | "ring"
  | "paired-patches"
  | "zenith-arc"
  | "tangent-arc"
  | "horizon-arc";

export type HaloAnglePlacement =
  | "computed-minimum-deviation"
  | "projected-minimum-deviation"
  | "representative-schematic";

export type HaloRayGuideFidelity = "schematic-not-raytraced";

export interface HaloSpectralSample {
  readonly label: string;
  readonly wavelengthNm: number;
  readonly iceIndex: number;
  readonly color: string;
}

export interface HaloPhenomenon {
  readonly id: HaloPhenomenonId;
  readonly labelJa: string;
  readonly labelEn: string;
  readonly crystalHabit: "plate" | "column" | "plate-or-column";
  readonly orientation: CrystalOrientation;
  readonly prismApexDeg: 60 | 90;
  readonly rayPathJa: string;
  readonly displayShape: HaloDisplayShape;
  readonly anglePlacement: HaloAnglePlacement;
  readonly rayGuideFidelity: HaloRayGuideFidelity;
  readonly minimumSunElevationDeg: number;
  readonly maximumSunElevationDeg: number;
  readonly modelNoticeJa: string;
}

export interface HaloAngleRange {
  readonly minimumDeg: number;
  readonly maximumDeg: number;
  readonly redDeg: number;
  readonly violetDeg: number;
  readonly prismApexDeg: 60 | 90;
}

export interface HaloCatalogState {
  readonly phenomenon: HaloPhenomenon;
  readonly availableAtSunElevation: boolean;
  readonly referenceMinimumDeviation: HaloAngleRange;
}

export const HALO_SPECTRAL_SAMPLES: readonly HaloSpectralSample[] = SPECTRAL_SAMPLES.map(
  ({ label, wavelengthNm, iceIndex, color }) => ({ label, wavelengthNm, iceIndex, color })
);

// The circular halos use the minimum deviation of a prism. Adjacent side faces
// of a hexagonal crystal make a 60° prism; a basal-to-side path makes a 90°
// prism. Orientation-dependent arcs need full 3D ray tracing, so their catalog
// entries deliberately identify the current display as schematic.
export const HALO_CATALOG = [
  {
    id: "halo-22",
    labelJa: "22度ハロ",
    labelEn: "22° halo",
    crystalHabit: "plate-or-column",
    orientation: "random",
    prismApexDeg: 60,
    rayPathJa: "六角柱の隣り合う側面を通る60°プリズム光路",
    displayShape: "ring",
    anglePlacement: "computed-minimum-deviation",
    rayGuideFidelity: "schematic-not-raytraced",
    minimumSunElevationDeg: 0,
    maximumSunElevationDeg: 90,
    modelNoticeJa: "リング半径は氷の屈折率から計算。結晶の個数と空間分布は代表表示。"
  },
  {
    id: "halo-46",
    labelJa: "46度ハロ",
    labelEn: "46° halo",
    crystalHabit: "plate-or-column",
    orientation: "random",
    prismApexDeg: 90,
    rayPathJa: "底面と側面を通る90°プリズム光路",
    displayShape: "ring",
    anglePlacement: "computed-minimum-deviation",
    rayGuideFidelity: "schematic-not-raytraced",
    minimumSunElevationDeg: 0,
    maximumSunElevationDeg: 90,
    modelNoticeJa: "リング半径は氷の屈折率から計算。明るさは結晶形状に左右される代表表示。"
  },
  {
    id: "sundog",
    labelJa: "幻日",
    labelEn: "sundog / parhelion",
    crystalHabit: "plate",
    orientation: "horizontal-plate",
    prismApexDeg: 60,
    rayPathJa: "水平に浮く板状結晶の鉛直な側面どうしを通る光路",
    displayShape: "paired-patches",
    anglePlacement: "projected-minimum-deviation",
    rayGuideFidelity: "schematic-not-raytraced",
    minimumSunElevationDeg: 0,
    maximumSunElevationDeg: 60,
    modelNoticeJa: "左右位置は水平断面の最小偏角で近似。広がり・明るさ・結晶分布は模式表示。"
  },
  {
    id: "circumzenithal-arc",
    labelJa: "環天頂アーク",
    labelEn: "circumzenithal arc",
    crystalHabit: "plate",
    orientation: "horizontal-plate",
    prismApexDeg: 90,
    rayPathJa: "水平な板状結晶の上面から入り側面から出る光路",
    displayShape: "zenith-arc",
    anglePlacement: "representative-schematic",
    rayGuideFidelity: "schematic-not-raytraced",
    minimumSunElevationDeg: 0,
    maximumSunElevationDeg: 32.3,
    modelNoticeJa: "太陽高度による出現条件を反映。弧の厳密な位置・形・輝度は未計算の模式表示。"
  },
  {
    id: "upper-tangent-arc",
    labelJa: "上部タンジェントアーク",
    labelEn: "upper tangent arc",
    crystalHabit: "column",
    orientation: "horizontal-column",
    prismApexDeg: 60,
    rayPathJa: "水平に浮く柱状結晶の側面どうしを通る光路",
    displayShape: "tangent-arc",
    anglePlacement: "representative-schematic",
    rayGuideFidelity: "schematic-not-raytraced",
    minimumSunElevationDeg: 0,
    maximumSunElevationDeg: 90,
    modelNoticeJa: "22度ハロへの接点を代表表示。弧の形は太陽高度と結晶回転の光線追跡が必要。"
  },
  {
    id: "circumhorizontal-arc",
    labelJa: "環水平アーク",
    labelEn: "circumhorizontal arc",
    crystalHabit: "plate",
    orientation: "horizontal-plate",
    prismApexDeg: 90,
    rayPathJa: "水平な板状結晶の側面から入り下面から出る光路",
    displayShape: "horizon-arc",
    anglePlacement: "representative-schematic",
    rayGuideFidelity: "schematic-not-raytraced",
    minimumSunElevationDeg: 58,
    maximumSunElevationDeg: 90,
    modelNoticeJa: "太陽高度による出現条件を反映。弧の厳密な位置・形・輝度は未計算の模式表示。"
  }
] as const satisfies readonly HaloPhenomenon[];

export function haloPhenomenonById(id: HaloPhenomenonId): HaloPhenomenon {
  const phenomenon = HALO_CATALOG.find((candidate) => candidate.id === id);
  if (!phenomenon) throw new RangeError(`unknown halo phenomenon: ${id}`);
  return phenomenon;
}

export function prismMinimumDeviationDeg(
  refractiveIndex: number,
  prismApexDeg: number
): number {
  if (!(refractiveIndex > 1)) {
    throw new RangeError("refractive index must be greater than 1");
  }
  if (!(prismApexDeg > 0 && prismApexDeg < 180)) {
    throw new RangeError("prism apex must be between 0 and 180 degrees");
  }

  const apex = radians(prismApexDeg);
  const argument = refractiveIndex * Math.sin(apex / 2);
  if (argument > 1) throw new RangeError("prism has no symmetric transmitted ray");
  return degrees(2 * Math.asin(argument) - apex);
}

export function haloAngleRange(ring: HaloRingId): HaloAngleRange {
  const prismApexDeg = ring === "halo-22" ? 60 : 90;
  const red = HALO_SPECTRAL_SAMPLES[0];
  const violet = HALO_SPECTRAL_SAMPLES[HALO_SPECTRAL_SAMPLES.length - 1];
  if (!red || !violet) throw new Error("halo spectrum is empty");

  const redDeg = prismMinimumDeviationDeg(red.iceIndex, prismApexDeg);
  const violetDeg = prismMinimumDeviationDeg(violet.iceIndex, prismApexDeg);
  return {
    minimumDeg: Math.min(redDeg, violetDeg),
    maximumDeg: Math.max(redDeg, violetDeg),
    redDeg,
    violetDeg,
    prismApexDeg
  };
}

export function referenceAngleRangeForPhenomenon(id: HaloPhenomenonId): HaloAngleRange {
  const phenomenon = haloPhenomenonById(id);
  return haloAngleRange(phenomenon.prismApexDeg === 60 ? "halo-22" : "halo-46");
}

// A horizontal plate preserves the vertical component at its vertical side
// faces. Projecting Snell's law onto the horizontal plane gives this effective
// index. It predicts the outward shift of sundogs with increasing solar height,
// but does not model finite crystal size or intensity.
export function projectedSundogOffsetDeg(
  refractiveIndex: number,
  sunElevationDeg: number
): number | null {
  if (!(refractiveIndex > 1)) {
    throw new RangeError("refractive index must be greater than 1");
  }
  if (!(sunElevationDeg >= 0 && sunElevationDeg <= 90)) {
    throw new RangeError("sun elevation must be between 0 and 90 degrees");
  }

  const elevation = radians(sunElevationDeg);
  const cosine = Math.cos(elevation);
  if (cosine < 1e-9) return null;
  const effectiveIndex = Math.sqrt(
    refractiveIndex * refractiveIndex - Math.sin(elevation) ** 2
  ) / cosine;
  const argument = effectiveIndex * Math.sin(Math.PI / 6);
  if (argument > 1) return null;
  return prismMinimumDeviationDeg(effectiveIndex, 60);
}

export function haloVisibleAtSunElevation(
  id: HaloPhenomenonId,
  sunElevationDeg: number
): boolean {
  if (!(sunElevationDeg >= 0 && sunElevationDeg <= 90)) {
    throw new RangeError("sun elevation must be between 0 and 90 degrees");
  }
  const phenomenon = haloPhenomenonById(id);
  const withinCatalogRange =
    sunElevationDeg >= phenomenon.minimumSunElevationDeg &&
    sunElevationDeg <= phenomenon.maximumSunElevationDeg;
  if (!withinCatalogRange) return false;
  if (id !== "sundog") return true;

  const middle = HALO_SPECTRAL_SAMPLES[Math.floor(HALO_SPECTRAL_SAMPLES.length / 2)];
  return middle ? projectedSundogOffsetDeg(middle.iceIndex, sunElevationDeg) !== null : false;
}

export function haloCatalogAtSunElevation(sunElevationDeg: number): readonly HaloCatalogState[] {
  return HALO_CATALOG.map((phenomenon) => ({
    phenomenon,
    availableAtSunElevation: haloVisibleAtSunElevation(phenomenon.id, sunElevationDeg),
    referenceMinimumDeviation: referenceAngleRangeForPhenomenon(phenomenon.id)
  }));
}
