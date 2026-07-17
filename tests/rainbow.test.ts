import assert from "node:assert/strict";
import test from "node:test";
import {
  SPECTRAL_SAMPLES,
  findStationaryRay,
  fresnelPower,
  iapwsWaterRefractiveIndex,
  prismMinimumDeviationDeg,
  rainbowAngleRange,
  referenceDryAirRefractiveIndex,
  referenceRelativeWaterIndex,
  reflect2D,
  refract2D,
  traceDropletRay,
  traceDropletRayAtImpact
} from "../src/physics/rainbow.ts";

const sinDeg = (angleDeg: number): number => Math.sin(angleDeg * Math.PI / 180);

test("IAPWS water and reference-air dispersion produce reproducible relative indices", () => {
  // IAPWS R9-97 Table 3: 0.589 µm, 0 °C and approximately the 0.1 MPa density.
  assert.ok(Math.abs(iapwsWaterRefractiveIndex(589, 0, 999.842) - 1.334344) < 1e-6);
  // Ciddor (1996), Table 1: 633 nm, 20 °C, 100 kPa dry air with 450 ppm CO2.
  assert.ok(
    Math.abs((referenceDryAirRefractiveIndex(633, 20, 100_000) - 1) * 1e8 - 26_824.4) < 0.1
  );
  for (const sample of SPECTRAL_SAMPLES) {
    assert.ok(Math.abs(sample.vacuumWaterIndex - iapwsWaterRefractiveIndex(sample.wavelengthNm)) < 1e-15);
    assert.ok(Math.abs(sample.airIndex - referenceDryAirRefractiveIndex(sample.wavelengthNm)) < 1e-15);
    assert.ok(Math.abs(sample.waterIndex - referenceRelativeWaterIndex(sample.wavelengthNm)) < 1e-15);
    assert.ok(sample.vacuumWaterIndex > sample.waterIndex);
    assert.ok(sample.airIndex > 1);
  }
});

test("reflection preserves length and mirrors the normal component", () => {
  const reflected = reflect2D({ x: 1, y: -1 }, { x: 0, y: 1 });
  assert.ok(Math.abs(reflected.x - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(reflected.y - Math.SQRT1_2) < 1e-12);
});

test("Snell refraction bends a 30 degree ray toward the normal in water", () => {
  const incident = { x: Math.sin(Math.PI / 6), y: -Math.cos(Math.PI / 6) };
  const refracted = refract2D(incident, { x: 0, y: 1 }, 1, 1.333);
  assert.ok(refracted);
  const angle = Math.asin(Math.abs(refracted.x));
  assert.ok(Math.abs((angle * 180) / Math.PI - 22.03) < 0.03);
});

test("water-to-air total internal reflection is reported only above the critical angle", () => {
  const belowCritical = 47 * Math.PI / 180;
  const aboveCritical = 50 * Math.PI / 180;
  const normal = { x: 0, y: -1 };
  assert.ok(refract2D({ x: Math.sin(belowCritical), y: Math.cos(belowCritical) }, normal, 1.333, 1));
  assert.equal(
    refract2D({ x: Math.sin(aboveCritical), y: Math.cos(aboveCritical) }, normal, 1.333, 1),
    null
  );
});

test("representative red and violet rays reproduce the accepted rainbow ranges", () => {
  const primary = rainbowAngleRange(1);
  const secondary = rainbowAngleRange(2);
  assert.ok(Math.abs(primary.redDeg - 42.35) < 0.08);
  assert.ok(Math.abs(primary.violetDeg - 40.68) < 0.12);
  assert.ok(Math.abs(secondary.redDeg - 50.40) < 0.15);
  assert.ok(Math.abs(secondary.violetDeg - 53.41) < 0.18);
  assert.ok(primary.redDeg > primary.violetDeg, "primary red must be outside violet");
  assert.ok(secondary.redDeg < secondary.violetDeg, "secondary red must be inside violet");
});

test("primary and secondary traces contain exactly one and two internal reflections", () => {
  const middle = SPECTRAL_SAMPLES[3]!;
  const primary = traceDropletRay(middle.waterIndex, 1);
  const secondary = traceDropletRay(middle.waterIndex, 2);
  assert.equal(primary.internalReflections, 1);
  assert.equal(secondary.internalReflections, 2);
  assert.equal(primary.points.length, 5);
  assert.equal(secondary.points.length, 6);
  assert.ok(primary.refractionDeg < 48.6);
  assert.ok(secondary.refractionDeg < 48.6);
});

test("stationary 589 nm-like ray gives the expected geometric angles", () => {
  const primary = findStationaryRay(1.333, 1);
  const secondary = findStationaryRay(1.333, 2);
  assert.ok(Math.abs(primary.radiusDeg - 42.08) < 0.03);
  assert.ok(Math.abs(secondary.radiusDeg - 50.89) < 0.03);
  assert.ok(Math.abs(primary.incidenceDeg - 59.41) < 0.05);
  assert.ok(Math.abs(secondary.incidenceDeg - 71.84) < 0.05);
});

test("analytic stationary ray is a local extremum of the deviation", () => {
  for (const order of [1, 2] as const) {
    const ray = findStationaryRay(1.333, order);
    const incidence = ray.incidenceDeg * Math.PI / 180;
    const delta = 1e-5;
    const center = order === 1
      ? 4 * Math.asin(Math.sin(incidence) / 1.333) - 2 * incidence
      : Math.PI + 2 * incidence - 6 * Math.asin(Math.sin(incidence) / 1.333);
    const left = order === 1
      ? 4 * Math.asin(Math.sin(incidence - delta) / 1.333) - 2 * (incidence - delta)
      : Math.PI + 2 * (incidence - delta) -
        6 * Math.asin(Math.sin(incidence - delta) / 1.333);
    const right = order === 1
      ? 4 * Math.asin(Math.sin(incidence + delta) / 1.333) - 2 * (incidence + delta)
      : Math.PI + 2 * (incidence + delta) -
        6 * Math.asin(Math.sin(incidence + delta) / 1.333);
    assert.ok(order === 1 ? center > left && center > right : center < left && center < right);
  }
});

test("rainbow internal reflection is partial and conserves Fresnel power", () => {
  const primary = findStationaryRay(1.333, 1);
  const power = fresnelPower(primary.refractionDeg, 1.333, 1);
  assert.ok(Math.abs(power.sReflectance - 0.111) < 0.002);
  assert.ok(Math.abs(power.pReflectance - 0.0035) < 0.0003);
  assert.ok(power.unpolarizedReflectance > 0 && power.unpolarizedReflectance < 1);
  assert.ok(
    Math.abs(power.unpolarizedReflectance + power.unpolarizedTransmittance - 1) < 1e-12
  );
});

test("each internal reflection has a transmitted loss branch", () => {
  const middle = SPECTRAL_SAMPLES[3]!;
  assert.equal(traceDropletRay(middle.waterIndex, 1).lossBranches.length, 1);
  assert.equal(traceDropletRay(middle.waterIndex, 2).lossBranches.length, 2);
});

test("every traced interface satisfies Snell refraction or the reflection law", () => {
  for (const sample of SPECTRAL_SAMPLES) {
    for (const order of [1, 2] as const) {
      const stationaryImpact = findStationaryRay(sample.waterIndex, order).impactParameter;
      for (const impact of [0, 0.35, stationaryImpact, 0.92]) {
        const trace = traceDropletRayAtImpact(sample.waterIndex, order, impact);
        assert.equal(trace.interfaceEvents.length, order + 2);
        assert.equal(
          trace.interfaceEvents.filter((event) => event.kind === "internal-reflection").length,
          order
        );

        for (const event of trace.interfaceEvents) {
          assert.ok(Math.abs(Math.hypot(event.point.x, event.point.y) - 1) < 1e-12);
          assert.ok(Math.abs(Math.hypot(event.outwardNormal.x, event.outwardNormal.y) - 1) < 1e-12);
          assert.ok(Math.abs(Math.hypot(event.incident.x, event.incident.y) - 1) < 1e-12);
          assert.ok(Math.abs(Math.hypot(event.outgoing.x, event.outgoing.y) - 1) < 1e-12);
          assert.ok(event.incidenceDeg >= 0 && event.incidenceDeg <= 90);
          assert.ok(event.outgoingDeg >= 0 && event.outgoingDeg <= 90);
          const incidentNormal =
            event.incident.x * event.outwardNormal.x +
            event.incident.y * event.outwardNormal.y;
          const outgoingNormal =
            event.outgoing.x * event.outwardNormal.x +
            event.outgoing.y * event.outwardNormal.y;
          if (event.kind === "entry-refraction") {
            assert.ok(incidentNormal < 0 && outgoingNormal < 0);
          } else if (event.kind === "internal-reflection") {
            assert.ok(incidentNormal > 0 && outgoingNormal < 0);
            assert.ok(Math.abs(event.incidenceDeg - event.outgoingDeg) < 1e-12);
            assert.equal(event.refractiveIndexFrom, sample.waterIndex);
            assert.equal(event.refractiveIndexTo, 1);
          } else {
            assert.ok(incidentNormal > 0 && outgoingNormal > 0);
          }
          if (event.kind !== "internal-reflection") {
            const incidentTangential =
              event.refractiveIndexFrom * sinDeg(event.incidenceDeg);
            const outgoingTangential =
              event.refractiveIndexTo * sinDeg(event.outgoingDeg);
            assert.ok(
              Math.abs(incidentTangential - outgoingTangential) < 2e-12,
              `${event.kind} must conserve the tangential wave-vector component`
            );
          }
        }
      }
    }
  }
});

test("one white incident beam shares an entry point before wavelength-dependent separation", () => {
  for (const order of [1, 2] as const) {
    const sharedImpact = findStationaryRay(SPECTRAL_SAMPLES[3]!.waterIndex, order)
      .impactParameter;
    const traces = SPECTRAL_SAMPLES.map((sample) =>
      traceDropletRayAtImpact(sample.waterIndex, order, sharedImpact)
    );
    const referenceStart = traces[0]!.points[0]!;
    const referenceEntry = traces[0]!.points[1]!;
    for (const trace of traces) {
      assert.deepEqual(trace.points[0], referenceStart);
      assert.deepEqual(trace.points[1], referenceEntry);
      assert.equal(trace.impactParameter, sharedImpact);
    }
    assert.ok(
      traces[0]!.points[2]!.y !== traces.at(-1)!.points[2]!.y,
      "red and violet paths must separate only after entering the drop"
    );
    assert.ok(
      Math.abs(traces[0]!.outgoing.y - traces.at(-1)!.outgoing.y) > 1e-4,
      "dispersion must produce different exit directions"
    );
  }
});

test("the traced outgoing vector reproduces the analytic rainbow scattering angle", () => {
  for (const order of [1, 2] as const) {
    for (const sample of SPECTRAL_SAMPLES) {
      const trace = traceDropletRay(sample.waterIndex, order);
      const scatteringDeg = Math.acos(Math.max(-1, Math.min(1, trace.outgoing.x))) *
        180 / Math.PI;
      assert.ok(Math.abs(scatteringDeg - trace.scatteringDeg) < 2e-12);
      assert.ok(Math.abs(180 - scatteringDeg - trace.radiusDeg) < 2e-12);
    }
  }
});

test("hexagonal ice prism minimum deviations support 22 and 46 degree halos", () => {
  assert.ok(Math.abs(prismMinimumDeviationDeg(1.3106, 60) - 21.89) < 0.05);
  assert.ok(Math.abs(prismMinimumDeviationDeg(1.3106, 90) - 45.87) < 0.05);
});
