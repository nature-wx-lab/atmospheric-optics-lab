export type RainbowZoomChapter =
  | "overview"
  | "contributor"
  | "droplet"
  | "ray"
  | "dispersion";

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RainbowZoomFrame {
  readonly progress: number;
  readonly chapter: RainbowZoomChapter;
  readonly semanticSpanM: number;
  readonly targetBlend: number;
  readonly skyOpacity: number;
  readonly radianceOpacity: number;
  readonly resolvedFieldOpacity: number;
  readonly resolvedContributorOpacity: number;
  readonly overviewOpacity: number;
  readonly focusMarkerOpacity: number;
  readonly detailScale: number;
  readonly surfaceOpacity: number;
  readonly representativeRayOpacity: number;
  readonly representativeRayReveal: number;
  readonly spectralOpacity: number;
  readonly normalOpacity: number;
  readonly lossBranchOpacity: number;
}

export const RAINBOW_CAMERA_FAR = 31.5;
export const RAINBOW_CAMERA_NEAR = 9.2;
export const SEMANTIC_FAR_SPAN_M = 300;
export const SEMANTIC_NEAR_SPAN_M = 0.00035;
export const OBSERVER_OPTICAL_ORIGIN: Vec3Like = Object.freeze({ x: 0, y: 0.65, z: 0.15 });

export const RAINBOW_CHAPTER_LABELS: Readonly<Record<RainbowZoomChapter, string>> = {
  overview: "虹の全景",
  contributor: "寄与する水滴へ接近",
  droplet: "同じ水滴を拡大",
  ray: "選択滴の1本の光路",
  dispersion: "波長差と部分反射"
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return value === Infinity ? 1 : 0;
  return Math.min(1, Math.max(0, value));
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (!(edge1 > edge0)) throw new RangeError("edge1 must be greater than edge0");
  const unit = clamp01((value - edge0) / (edge1 - edge0));
  return unit * unit * (3 - 2 * unit);
}

export function chapterForProgress(progress: number): RainbowZoomChapter {
  const value = clamp01(progress);
  if (value < 0.22) return "overview";
  if (value < 0.48) return "contributor";
  if (value < 0.68) return "droplet";
  if (value < 0.9) return "ray";
  return "dispersion";
}

export function semanticSpanM(progress: number): number {
  return SEMANTIC_FAR_SPAN_M *
    Math.pow(SEMANTIC_NEAR_SPAN_M / SEMANTIC_FAR_SPAN_M, clamp01(progress));
}

export function formatSemanticSpan(valueM: number): string {
  if (valueM >= 100) return `${Math.round(valueM / 10) * 10} m`;
  if (valueM >= 10) return `${Math.round(valueM)} m`;
  if (valueM >= 1) return `${valueM.toFixed(1)} m`;
  if (valueM >= 0.01) return `${(valueM * 100).toFixed(valueM >= 0.1 ? 0 : 1)} cm`;
  if (valueM >= 0.001) return `${(valueM * 1_000).toFixed(1)} mm`;
  return `${Math.round(valueM * 1_000_000)} µm`;
}

export function progressFromCameraDistance(distance: number): number {
  if (!(distance > 0)) return 1;
  return clamp01(
    Math.log(RAINBOW_CAMERA_FAR / distance) /
      Math.log(RAINBOW_CAMERA_FAR / RAINBOW_CAMERA_NEAR)
  );
}

export function cameraDistanceFromProgress(progress: number): number {
  return RAINBOW_CAMERA_FAR *
    Math.pow(RAINBOW_CAMERA_NEAR / RAINBOW_CAMERA_FAR, clamp01(progress));
}

export function progressiveDrawCount(reveal: number, vertexCount: number): number {
  if (vertexCount <= 0) return 0;
  if (vertexCount === 1) return 1;
  return Math.min(
    vertexCount,
    Math.max(2, 2 + Math.floor(clamp01(reveal) * (vertexCount - 2)))
  );
}

export function rainbowZoomFrame(progress: number): RainbowZoomFrame {
  const value = clamp01(progress);
  const scaleProgress = smoothstep(0.18, 0.82, value);
  const detailScale = Math.exp(
    Math.log(0.018) + (Math.log(1.05) - Math.log(0.018)) * scaleProgress
  );

  return {
    progress: value,
    chapter: chapterForProgress(value),
    semanticSpanM: semanticSpanM(value),
    targetBlend: smoothstep(0.06, 0.6, value),
    skyOpacity: 1 - 0.78 * smoothstep(0.36, 0.76, value),
    radianceOpacity: 1 - smoothstep(0.14, 0.39, value),
    resolvedFieldOpacity:
      smoothstep(0.22, 0.48, value) * (1 - smoothstep(0.62, 0.85, value)),
    resolvedContributorOpacity:
      smoothstep(0.1, 0.32, value) * (1 - smoothstep(0.62, 0.84, value)),
    overviewOpacity: 1 - smoothstep(0.6, 0.84, value),
    focusMarkerOpacity:
      0.9 *
      smoothstep(0.12, 0.3, value) *
      (1 - smoothstep(0.46, 0.64, value)),
    detailScale,
    surfaceOpacity: smoothstep(0.3, 0.56, value),
    representativeRayOpacity: smoothstep(0.62, 0.74, value),
    representativeRayReveal: smoothstep(0.62, 0.86, value),
    spectralOpacity: smoothstep(0.9, 1, value),
    normalOpacity: smoothstep(0.74, 0.88, value),
    lossBranchOpacity: smoothstep(0.82, 0.94, value)
  };
}

export function sunDirectionFromAngles(
  sunElevationDeg: number,
  sunAzimuthDeg: number
): Vec3Like {
  const elevation = (sunElevationDeg * Math.PI) / 180;
  const azimuth = (sunAzimuthDeg * Math.PI) / 180;
  return {
    x: Math.cos(elevation) * Math.sin(azimuth),
    y: Math.sin(elevation),
    z: Math.cos(elevation) * Math.cos(azimuth)
  };
}
