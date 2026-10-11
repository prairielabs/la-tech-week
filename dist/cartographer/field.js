/*
 * Semantic Field Cartographer
 *
 * One dependency-free host artifact: injected-matter normalization, strict
 * three-composite validation, deterministic [0,1]^3 and Semantic Entropy
 * projections, live Matter control, and an optional WebGL renderer. It
 * performs no ambient I/O.
 */
(function (global) {
  "use strict";

  const AXES = Object.freeze(["x", "y", "z"]);
  const EPSILON = 1e-6;
  const BOUNDS = Object.freeze({minimum: 0, center: 0.5, maximum: 1});
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
  const NORMALIZED_FORMAT = "semantic-field.normalized/1";
  const FIELD_PROJECTION_FORMAT = "semantic-field.projection/1";
  const ENTROPY_PROJECTION_FORMAT = "semantic-field.entropy-projection/1";
  const applicationIndexes = new WeakMap();
  const normalizedApplications = new WeakSet();

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function object(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`${name} must be an object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${name} must be a plain object`);
    }
    return value;
  }

  function exactKeys(value, required, optional, name) {
    const keys = new Set(Object.keys(value));
    for (const key of required || []) {
      if (!keys.has(key)) throw new RangeError(`${name} missing: ${key}`);
    }
    const allowed = new Set([...(required || []), ...(optional || [])]);
    const extra = Array.from(keys).filter((key) => !allowed.has(key));
    if (extra.length) throw new RangeError(`${name} unsupported: ${extra.sort().join(", ")}`);
  }

  function textValue(value, name, maximum) {
    if (typeof value !== "string") throw new TypeError(`${name} must be text`);
    const valueText = value.trim();
    if (!valueText || valueText.length > (maximum || 200) || /[\u0000-\u001f]/.test(valueText)) {
      throw new RangeError(`${name} is empty, too long, or contains controls`);
    }
    return valueText;
  }

  function identifier(value, name) {
    const id = textValue(value, name || "id", 96);
    if (!ID_PATTERN.test(id)) throw new RangeError(`${name || "id"} is not a valid identifier`);
    return id;
  }

  function unit(value, name) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`${name || "value"} must be a finite number from 0 to 1`);
    }
    return value;
  }

  function yearValue(value, name) {
    if (value == null) return null;
    if (!Number.isInteger(value) || value < -100000 || value > 100000) {
      throw new RangeError(`${name || "year"} must be an integer in [-100000, 100000] or null`);
    }
    return value;
  }

  function interval(value, name, exportShape) {
    const source = value == null ? (exportShape ? {} : {start: null, end: null}) : object(value, name || "interval");
    if (!exportShape) exactKeys(source, ["start", "end"], [], name || "interval");
    const start = yearValue(exportShape ? source.start_year : source.start, `${name || "interval"}.start`);
    const end = yearValue(exportShape ? source.end_year : source.end, `${name || "interval"}.end`);
    if (start != null && end != null && start > end) throw new RangeError(`${name || "interval"}.start must not exceed end`);
    return {start, end};
  }

  function intervalsOverlap(a, b) {
    const a0 = a.start == null ? -Infinity : a.start;
    const a1 = a.end == null ? Infinity : a.end;
    const b0 = b.start == null ? -Infinity : b.start;
    const b1 = b.end == null ? Infinity : b.end;
    return a0 <= b1 && b0 <= a1;
  }

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function metadataValue(value, name) {
    if (value == null) return {};
    const metadata = object(value, name || "metadata");
    if (JSON.stringify(metadata).length > 16000) {
      throw new RangeError(`${name || "metadata"} is too large`);
    }
    return metadata;
  }

  function deepFreeze(value) {
    const pending = [value];
    const seen = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (!current || (typeof current !== "object" && typeof current !== "function") || seen.has(current)) continue;
      seen.add(current);
      for (const child of Object.values(current)) pending.push(child);
      Object.freeze(current);
    }
    return value;
  }

  function semanticToWorld(value, worldSize) {
    const size = clamp(finite(worldSize, 1), 1e-9, 1000000);
    const convert = (entry) => (unit(entry, "semantic coordinate") * 2 - 1) * size / 2;
    if (Array.isArray(value)) {
      if (value.length !== 3) throw new TypeError("A semantic coordinate must contain x, y, and z");
      return value.map(convert);
    }
    return convert(value);
  }

  function worldToSemantic(value, worldSize) {
    const size = clamp(finite(worldSize, 1), 1e-9, 1000000);
    const convert = (entry) => {
      if (typeof entry !== "number" || !Number.isFinite(entry)) throw new TypeError("World coordinate must be finite");
      return clamp(entry / size + 0.5, 0, 1);
    };
    if (Array.isArray(value)) {
      if (value.length !== 3) throw new TypeError("A world coordinate must contain x, y, and z");
      return value.map(convert);
    }
    return convert(value);
  }

  function resolveCanvas(candidate) {
    if (typeof candidate === "string") return document.querySelector(candidate);
    return candidate && typeof candidate.getContext === "function" ? candidate : null;
  }

  function dispatch(target, name, detail) {
    if (!target || typeof target.dispatchEvent !== "function") return;
    target.dispatchEvent(new CustomEvent(name, {detail}));
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Unknown WebGL shader error";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Unknown WebGL link error";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] =
          a[row] * b[column * 4] +
          a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] +
          a[12 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }

  function perspective(fieldOfView, aspect, near, far) {
    const f = 1 / Math.tan(fieldOfView / 2);
    const range = 1 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * range;
    out[11] = -1;
    out[14] = 2 * far * near * range;
    return out;
  }

  function normalize(vector) {
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
    return [vector[0] / length, vector[1] / length, vector[2] / length];
  }

  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }

  function lookAt(eye, target, up) {
    const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
    const x = normalize(cross(up, z));
    const y = cross(z, x);
    const out = identity();
    out[0] = x[0]; out[1] = y[0]; out[2] = z[0];
    out[4] = x[1]; out[5] = y[1]; out[6] = z[1];
    out[8] = x[2]; out[9] = y[2]; out[10] = z[2];
    out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
    out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
    out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
    return out;
  }

  function transformPoint(matrix, point) {
    const x = point[0], y = point[1], z = point[2];
    return [
      matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
      matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
      matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
      matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15],
    ];
  }

  function parseColor(value, fallback) {
    if (Array.isArray(value) && value.length >= 3) {
      return [clamp(finite(value[0], 1), 0, 1), clamp(finite(value[1], 1), 0, 1), clamp(finite(value[2], 1), 0, 1), clamp(finite(value[3], 1), 0, 1)];
    }
    if (typeof value === "string") {
      const match = value.trim().match(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i);
      if (match) {
        const hex = match[1];
        return [
          parseInt(hex.slice(0, 2), 16) / 255,
          parseInt(hex.slice(2, 4), 16) / 255,
          parseInt(hex.slice(4, 6), 16) / 255,
          hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
        ];
      }
    }
    return fallback.slice();
  }

  function buildBoundaryGrid(size, divisions) {
    const half = size / 2;
    const segments = [];
    const seen = new Set();
    const add = (a, b) => {
      const left = a.join(",");
      const right = b.join(",");
      const key = left < right ? `${left}|${right}` : `${right}|${left}`;
      if (seen.has(key)) return;
      seen.add(key);
      segments.push(...a, ...b);
    };
    for (let index = 0; index <= divisions; index += 1) {
      const value = -half + size * index / divisions;
      add([-half, -half, value], [half, -half, value]);
      add([value, -half, -half], [value, -half, half]);
      add([-half, value, -half], [half, value, -half]);
      add([value, -half, -half], [value, half, -half]);
      add([-half, value, -half], [-half, value, half]);
      add([-half, -half, value], [-half, half, value]);
    }
    const corners = [
      [-half, -half, -half], [half, -half, -half], [half, half, -half], [-half, half, -half],
      [-half, -half, half], [half, -half, half], [half, half, half], [-half, half, half],
    ];
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) add(corners[a], corners[b]);
    return new Float32Array(segments);
  }

  function buildEntropyLine(size) {
    const half = size / 2;
    return new Float32Array([-half, 0, 0, half, 0, 0]);
  }

  function normalizeScalars(raw) {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 256) {
      throw new RangeError("An application needs 1 to 256 scalar definitions in this format version");
    }
    const seen = new Set();
    return raw.map((entry, index) => {
      const source = object(entry, `scalar[${index}]`);
      exactKeys(source, ["id", "label"], ["description", "aliases", "construct_0", "construct_1", "range", "version"], `scalar[${index}]`);
      const id = identifier(source.id, `scalar[${index}].id`);
      if (seen.has(id)) throw new RangeError(`Duplicate scalar: ${id}`);
      seen.add(id);
      const aliases = [];
      if (source.aliases != null && (!Array.isArray(source.aliases) || source.aliases.length > 32)) {
        throw new RangeError(`${id}.aliases must be a list of at most 32 entries`);
      }
      for (const alias of source.aliases || []) {
        aliases.push(textValue(alias, `${id}.alias`, 80));
      }
      for (const pole of [source.construct_0, source.construct_1]) {
        if (pole != null) aliases.push(textValue(pole, `${id}.pole`, 80));
      }
      return {
        id,
        label: textValue(source.label || id, `${id}.label`, 100),
        description: textValue(source.description == null ? "Normalized scalar" : source.description, `${id}.description`, 1000),
        aliases: Array.from(new Set(aliases)),
        construct0: source.construct_0 == null ? null : String(source.construct_0),
        construct1: source.construct_1 == null ? null : String(source.construct_1),
      };
    });
  }

  function normalizeConstructs(raw, exported) {
    if (!Array.isArray(raw) || raw.length > 100000) throw new RangeError("constructs must contain at most 100,000 entries");
    const seen = new Set();
    return raw.map((entry, index) => {
      const source = object(entry, `construct[${index}]`);
      if (!exported) exactKeys(source, ["id", "label"], ["time", "metadata"], `construct[${index}]`);
      const id = identifier(source.id, `construct[${index}].id`);
      if (seen.has(id)) throw new RangeError(`Duplicate construct: ${id}`);
      seen.add(id);
      const lifespan = exported ? (source.lifespan || {start_year: source.start_year, end_year: source.end_year}) : source.time;
      return {
        id,
        label: textValue(source.label || source.roster_label || id, `${id}.label`, 200),
        time: interval(lifespan, `${id}.time`, Boolean(exported)),
        metadata: metadataValue(exported ? source : source.metadata, `${id}.metadata`),
      };
    });
  }

  function normalizeComposites(raw, constructIds, strict) {
    if (raw == null) return [];
    if (!Array.isArray(raw) || raw.length > 10000) throw new RangeError("composite constructs must be a list of at most 10,000 entries");
    const seen = new Set(constructIds);
    return raw.map((entry, index) => {
      const source = object(entry, `composite[${index}]`);
      if (strict) exactKeys(source, ["id", "label", "members"], ["minimum_coverage", "metadata"], `composite[${index}]`);
      const id = identifier(source.id, `composite[${index}].id`);
      if (seen.has(id)) throw new RangeError(`Duplicate construct/composite: ${id}`);
      seen.add(id);
      if (!Array.isArray(source.members) || source.members.length < 1 || source.members.length > 1000) {
        throw new RangeError(`${id}.members must contain 1 to 1,000 base constructs`);
      }
      const memberIds = new Set();
      const members = source.members.map((memberEntry, memberIndex) => {
        const member = object(memberEntry, `${id}.member[${memberIndex}]`);
        if (strict) exactKeys(member, ["construct", "weight"], [], `${id}.member[${memberIndex}]`);
        const construct = identifier(member.construct || member.entity_id || member.id, `${id}.member.construct`);
        if (!constructIds.has(construct)) throw new RangeError(`${id} references unknown base construct ${construct}`);
        if (memberIds.has(construct)) throw new RangeError(`${id} repeats member ${construct}`);
        memberIds.add(construct);
        const weight = member.weight == null ? 1 : member.weight;
        if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0 || weight > 100) throw new RangeError(`${id}.member.weight must be in (0, 100]`);
        return {construct, weight};
      });
      return {
        id,
        label: textValue(source.label || id, `${id}.label`, 200),
        members,
        minimumCoverage: unit(source.minimum_coverage == null ? 1 : source.minimum_coverage, `${id}.minimum_coverage`),
        metadata: metadataValue(source.metadata || (strict ? null : source), `${id}.metadata`),
      };
    });
  }

  function observationTime(source) {
    if (source.valid_time && typeof source.valid_time === "object") return interval(source.valid_time, "observation.valid_time", true);
    return interval(source.time, "observation.time", false);
  }

  function normalizeObservations(raw, scalarIds, constructIds, exported) {
    if (!Array.isArray(raw) || raw.length > 1000000) throw new RangeError("observations must be a list of at most 1,000,000 entries");
    const result = [];
    const intervals = new Map();
    const add = (constructValue, scalarValue, value, time, confidence, provenance) => {
      const construct = identifier(constructValue, "observation.construct");
      const scalar = identifier(scalarValue, "observation.scalar");
      if (!constructIds.has(construct)) throw new RangeError(`Unknown observation construct: ${construct}`);
      if (!scalarIds.has(scalar)) throw new RangeError(`Unknown observation scalar: ${scalar}`);
      const validity = time || {start: null, end: null};
      const key = `${construct}\u0000${scalar}`;
      const prior = intervals.get(key) || [];
      if (prior.some((entry) => intervalsOverlap(entry, validity))) {
        throw new RangeError(`Overlapping observations for ${construct}/${scalar}`);
      }
      prior.push(validity);
      intervals.set(key, prior);
      let confidenceValue = null;
      if (confidence != null) confidenceValue = unit(confidence, "observation.confidence");
      result.push({construct, scalar, value: unit(value, "observation.value"), time: validity, confidence: confidenceValue, provenance: metadataValue(provenance, "observation.provenance")});
    };
    raw.forEach((entry, index) => {
      const source = object(entry, `observation[${index}]`);
      if (exported && (source.scalar_values || source.scalars)) {
        const construct = source.entity_id || source.construct;
        const values = object(source.scalar_values || source.scalars, `observation[${index}].scalars`);
        const time = observationTime(source);
        for (const [scalar, rawValue] of Object.entries(values)) {
          const state = rawValue && typeof rawValue === "object" ? rawValue : {value: rawValue};
          add(construct, scalar, state.value, time, state.confidence, {
            basis: state.basis,
            rationale: state.rationale,
            evidence: state.evidence,
          });
        }
      } else {
        exactKeys(source, ["construct", "scalar", "value", "time"], ["confidence", "provenance"], `observation[${index}]`);
        add(source.construct || source.entity_id, source.scalar || source.scalar_id,
          source.value, observationTime(source), source.confidence, source.provenance || source.evidence);
      }
    });
    return result;
  }

  function presetView(layer, scalars) {
    const preset = layer && Array.isArray(layer.axis_presets) ? layer.axis_presets[0] : null;
    if (!preset || !preset.dimensions) return null;
    const byId = new Map(scalars.map((entry) => [entry.id, entry]));
    const axes = [];
    for (const dimension of AXES) {
      const spec = preset.dimensions[dimension];
      if (!spec || !spec.scalar_id || !byId.has(spec.scalar_id)) return null;
      axes.push({
        dimension,
        label: byId.get(spec.scalar_id).label,
        aggregation: "weighted-mean",
        components: [{scalar: spec.scalar_id, weight: 1, invert: false}],
      });
    }
    return {axes, time: {mode: "latest"}, range: {start: null, end: null}, filter: {construct_ids: [], include_composites: true}};
  }

  function buildApplicationIndexes(application) {
    if (applicationIndexes.has(application)) return applicationIndexes.get(application);
    const scalarById = new Map(application.scalars.map((entry) => [entry.id, entry]));
    const constructById = new Map(application.constructs.map((entry) => [entry.id, entry]));
    const compositeById = new Map(application.composites.map((entry) => [entry.id, entry]));
    const observationsByPair = new Map();
    for (const observation of application.observations) {
      const key = `${observation.construct}\u0000${observation.scalar}`;
      const states = observationsByPair.get(key) || [];
      states.push(observation);
      observationsByPair.set(key, states);
    }
    for (const states of observationsByPair.values()) states.sort((a, b) => (a.time.start == null ? -100001 : a.time.start) - (b.time.start == null ? -100001 : b.time.start));
    const indexes = {scalarById, constructById, compositeById, observationsByPair};
    applicationIndexes.set(application, indexes);
    return indexes;
  }

  function normalizeApplication(raw, options) {
    const input = object(raw, "application pack");
    if (input.format === NORMALIZED_FORMAT) {
      if (!normalizedApplications.has(input)) {
        throw new RangeError("Normalized application matter must originate from this Cartographer instance");
      }
      return input;
    }
    const source = copy(input);
    const settings = options || {};
    let appSource;
    let scalars;
    let constructs;
    let observations;
    let composites;
    let truthLayer;
    let defaultViewValue = null;
    if (source.format === "semantic-field.application/1") {
      exactKeys(source, ["format", "version", "application", "scalars", "constructs", "observations", "composite_constructs"], [], "application pack");
      appSource = object(source.application, "application");
      exactKeys(appSource, ["id", "title", "description", "construct_kind"], [], "application");
      scalars = normalizeScalars(source.scalars);
      constructs = normalizeConstructs(source.constructs, false);
      const scalarIds = new Set(scalars.map((entry) => entry.id));
      const constructIds = new Set(constructs.map((entry) => entry.id));
      observations = normalizeObservations(source.observations, scalarIds, constructIds, false);
      composites = normalizeComposites(source.composite_constructs || [], constructIds, true);
      truthLayer = source.truth_layer || "declared";
    } else if (source.format === "semantic-field.application-pack/1") {
      appSource = object(source.application, "application");
      const layers = object(source.truth_layers, "truth_layers");
      const requestedLayer = settings.truthLayer || settings.truth_layer;
      if (!requestedLayer) throw new RangeError("truthLayer must be explicit for a multi-layer application pack");
      const layerName = requestedLayer;
      const layer = object(layers[layerName], `truth_layers.${layerName}`);
      const scalarSource = layer.scalar_registry || layer.scalars;
      scalars = normalizeScalars(scalarSource);
      constructs = normalizeConstructs(source.entities || source.constructs, true);
      const scalarIds = new Set(scalars.map((entry) => entry.id));
      const constructIds = new Set(constructs.map((entry) => entry.id));
      const stateSource = layer.scalar_observations || layer.measurements || layer.values || [];
      observations = normalizeObservations(stateSource, scalarIds, constructIds, true);
      composites = normalizeComposites(layer.composite_constructs || [], constructIds, false);
      truthLayer = layer.review_state || layerName;
      defaultViewValue = presetView(layer, scalars);
    } else {
      throw new RangeError(`Unsupported application format: ${String(source.format)}`);
    }
    if (source.version != null && (!Number.isInteger(source.version) || source.version < 1)) {
      throw new RangeError("application version must be a positive integer");
    }
    const application = {
      format: NORMALIZED_FORMAT,
      version: source.version == null ? 1 : source.version,
      id: identifier(appSource.id, "application.id"),
      title: textValue(appSource.title || appSource.id, "application.title", 200),
      description: textValue(appSource.description == null ? "Semantic field application" : appSource.description, "application.description", 1000),
      constructKind: identifier(appSource.construct_kind || appSource.entity_kind || "construct", "application.construct_kind"),
      truthLayer: String(truthLayer),
      scalars,
      constructs,
      observations,
      composites,
      defaultView: defaultViewValue,
    };
    buildApplicationIndexes(application);
    normalizedApplications.add(application);
    return deepFreeze(application);
  }

  function applicationSummary(application) {
    return {
      id: application.id,
      title: application.title,
      description: application.description,
      construct_kind: application.constructKind,
      truth_layer: application.truthLayer,
      version: application.version,
    };
  }

  function defaultView(applicationValue) {
    const application = normalizeApplication(applicationValue);
    if (application.defaultView) return copy(application.defaultView);
    const axes = AXES.map((dimension, index) => {
      const scalar = application.scalars[index % application.scalars.length];
      return {dimension, label: scalar.label, aggregation: "weighted-mean", components: [{scalar: scalar.id, weight: 1, invert: false}]};
    });
    return {axes, time: {mode: "latest"}, range: {start: null, end: null}, filter: {construct_ids: [], include_composites: true}};
  }

  function validateView(raw, applicationValue) {
    const application = normalizeApplication(applicationValue);
    const indexes = buildApplicationIndexes(application);
    const source = object(raw, "view");
    exactKeys(source, ["axes"], ["time", "range", "filter"], "view");
    const rawAxes = source.axes;
    if (rawAxes.length !== 3) throw new RangeError("A view must declare exactly x, y, and z axes");
    const byDimension = new Map();
    for (const rawAxis of rawAxes) {
      const axis = object(rawAxis, "axis");
      exactKeys(axis, ["dimension", "label", "components"], ["aggregation"], "axis");
      const dimension = textValue(axis.dimension, "axis.dimension", 1).toLowerCase();
      if (!AXES.includes(dimension) || byDimension.has(dimension)) throw new RangeError("Axis dimensions must be unique x, y, and z");
      const aggregation = axis.aggregation || "weighted-mean";
      if (!["weighted-mean", "sum-clamp"].includes(aggregation)) throw new RangeError("Axis aggregation must be weighted-mean or sum-clamp");
      const rawComponents = axis.components;
      if (!Array.isArray(rawComponents) || rawComponents.length < 1 || rawComponents.length > 256) {
        throw new RangeError("An axis needs 1 to 256 scalar components in this format version");
      }
      const used = new Set();
      const components = rawComponents.map((rawComponent) => {
        const component = object(rawComponent, `axis.${dimension}.component`);
        exactKeys(component, ["scalar", "weight"], ["invert"], `axis.${dimension}.component`);
        const scalar = identifier(component.scalar, `axis.${dimension}.scalar`);
        if (!indexes.scalarById.has(scalar)) throw new RangeError(`Unknown scalar: ${scalar}`);
        if (used.has(scalar)) throw new RangeError(`Duplicate scalar on ${dimension}: ${scalar}`);
        used.add(scalar);
        const weight = component.weight;
        if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0 || weight > 100) throw new RangeError(`Weight for ${scalar} must be in (0, 100]`);
        if (component.invert != null && typeof component.invert !== "boolean") throw new TypeError(`Invert for ${scalar} must be boolean`);
        return {scalar, weight, invert: Boolean(component.invert)};
      });
      byDimension.set(dimension, {
        dimension,
        label: textValue(axis.label, `axis.${dimension}.label`, 100),
        aggregation,
        components,
      });
    }
    if (byDimension.size !== 3) throw new RangeError("A view must declare exactly x, y, and z axes");
    const rawTime = source.time == null ? {mode: "latest"} : object(source.time, "time");
    let time;
    if (rawTime.mode === "latest") {
      exactKeys(rawTime, ["mode"], [], "time");
      time = {mode: "latest"};
    } else if (rawTime.mode === "at") {
      exactKeys(rawTime, ["mode", "value"], [], "time");
      time = {mode: "at", value: yearValue(rawTime.value, "time.value")};
    }
    else throw new RangeError("time.mode must be latest or at");
    if (source.range != null) exactKeys(object(source.range, "range"), ["start", "end"], [], "range");
    const range = interval(source.range, "range", false);
    const rawFilter = source.filter == null ? {} : object(source.filter, "filter");
    exactKeys(rawFilter, [], ["construct_ids", "include_composites"], "filter");
    const rawIds = rawFilter.construct_ids || [];
    if (!Array.isArray(rawIds) || rawIds.length > 100000) throw new RangeError("filter.construct_ids must be a list");
    const ids = [];
    for (const rawId of rawIds) {
      const id = identifier(rawId, "filter.construct_id");
      if (!indexes.constructById.has(id) && !indexes.compositeById.has(id)) throw new RangeError(`Unknown filtered construct: ${id}`);
      if (!ids.includes(id)) ids.push(id);
    }
    const includeComposites = rawFilter.include_composites == null ? true : rawFilter.include_composites;
    if (typeof includeComposites !== "boolean") throw new TypeError("filter.include_composites must be boolean");
    return {axes: AXES.map((dimension) => byDimension.get(dimension)), time, range, filter: {construct_ids: ids, include_composites: includeComposites}};
  }

  function defaultEntropyConfig(applicationValue) {
    const application = normalizeApplication(applicationValue);
    const view = validateView(defaultView(application), application);
    return {time: view.time, range: view.range, filter: view.filter};
  }

  function validateEntropyConfig(raw, applicationValue) {
    const application = normalizeApplication(applicationValue);
    const source = raw == null ? {} : object(raw, "entropy config");
    exactKeys(source, [], ["time", "range", "filter"], "entropy config");
    const defaults = defaultEntropyConfig(application);
    const view = validateView({
      axes: defaultView(application).axes,
      time: Object.prototype.hasOwnProperty.call(source, "time") ? source.time : defaults.time,
      range: Object.prototype.hasOwnProperty.call(source, "range") ? source.range : defaults.range,
      filter: Object.prototype.hasOwnProperty.call(source, "filter") ? source.filter : defaults.filter,
    }, application);
    return {time: view.time, range: view.range, filter: view.filter};
  }

  function selectedObservations(application, time) {
    const indexes = buildApplicationIndexes(application);
    const selected = new Map();
    for (const [key, states] of indexes.observationsByPair) {
      const candidates = time.mode === "at" ? states.filter((state) =>
        (state.time.start == null || state.time.start <= time.value) &&
        (state.time.end == null || state.time.end >= time.value)) : states;
      if (!candidates.length) continue;
      selected.set(key, candidates.reduce((latest, state) => {
        const latestStart = latest.time.start == null ? -100001 : latest.time.start;
        const stateStart = state.time.start == null ? -100001 : state.time.start;
        if (stateStart !== latestStart) return stateStart > latestStart ? state : latest;
        const latestEnd = latest.time.end == null ? 100001 : latest.time.end;
        const stateEnd = state.time.end == null ? 100001 : state.time.end;
        return stateEnd > latestEnd ? state : latest;
      }));
    }
    return selected;
  }

  function axisValue(axis, construct, selected) {
    let weighted = 0;
    let total = 0;
    for (const component of axis.components) {
      const state = selected.get(`${construct}\u0000${component.scalar}`);
      if (!state) return null;
      const value = component.invert ? 1 - state.value : state.value;
      weighted += value * component.weight;
      total += component.weight;
    }
    const raw = axis.aggregation === "sum-clamp" ? weighted : weighted / total;
    return {raw, value: clamp(raw, 0, 1)};
  }

  function project(applicationValue, rawView) {
    const application = normalizeApplication(applicationValue);
    const view = validateView(rawView || defaultView(application), application);
    const selected = selectedObservations(application, view.time);
    const axes = Object.fromEntries(view.axes.map((axis) => [axis.dimension, axis]));
    const filterIds = new Set(view.filter.construct_ids);
    const points = [];
    const excluded = [];
    const pointById = new Map();
    const dependencyIds = new Set();
    if (view.filter.include_composites && filterIds.size) {
      for (const composite of application.composites) {
        if (!filterIds.has(composite.id)) continue;
        for (const member of composite.members) dependencyIds.add(member.construct);
      }
    }
    for (const construct of application.constructs) {
      const emitted = !filterIds.size || filterIds.has(construct.id);
      if (!emitted && !dependencyIds.has(construct.id)) continue;
      if (!intervalsOverlap(construct.time, view.range)) continue;
      if (view.time.mode === "at") {
        const declared = construct.time.start != null || construct.time.end != null;
        if (!declared) {
          if (emitted) excluded.push({id: construct.id, label: construct.label, reason: "missing declared lifespan for explicit time"});
          continue;
        }
        if ((construct.time.start != null && view.time.value < construct.time.start) ||
            (construct.time.end != null && view.time.value > construct.time.end)) continue;
      }
      const results = Object.fromEntries(AXES.map((dimension) => [dimension, axisValue(axes[dimension], construct.id, selected)]));
      const missing = AXES.filter((dimension) => !results[dimension]);
      if (missing.length) {
        if (emitted) excluded.push({id: construct.id, label: construct.label, reason: `no discrete scalar state for ${missing.join(", ")}`});
        continue;
      }
      const scalarStates = {};
      for (const scalar of application.scalars) {
        const state = selected.get(`${construct.id}\u0000${scalar.id}`);
        if (state) scalarStates[scalar.id] = {value: state.value, time: copy(state.time), confidence: state.confidence, provenance: state.provenance};
      }
      const point = {
        id: construct.id,
        label: construct.label,
        name: construct.label,
        kind: "construct",
        x: results.x.value,
        y: results.y.value,
        z: results.z.value,
        raw: {x: results.x.raw, y: results.y.raw, z: results.z.raw},
        hover: {id: construct.id, label: construct.label, time: copy(construct.time), metadata: construct.metadata, scalars: scalarStates},
      };
      pointById.set(point.id, point);
      if (emitted) points.push(point);
    }
    if (view.filter.include_composites) {
      for (const composite of application.composites) {
        if (filterIds.size && !filterIds.has(composite.id)) continue;
        const total = composite.members.reduce((sum, member) => sum + member.weight, 0);
        const present = composite.members.flatMap((member) => pointById.has(member.construct) ? [{point: pointById.get(member.construct), weight: member.weight}] : []);
        const coverage = present.reduce((sum, member) => sum + member.weight, 0) / total;
        if (!present.length || coverage < composite.minimumCoverage) {
          excluded.push({id: composite.id, label: composite.label, reason: "composite member coverage below minimum"});
          continue;
        }
        const presentWeight = present.reduce((sum, member) => sum + member.weight, 0);
        const coordinate = (dimension) => present.reduce((sum, member) => sum + member.point[dimension] * member.weight, 0) / presentWeight;
        points.push({
          id: composite.id, label: composite.label, name: composite.label, kind: "composite", coverage,
          x: coordinate("x"), y: coordinate("y"), z: coordinate("z"),
          hover: {id: composite.id, label: composite.label, metadata: composite.metadata,
            members: composite.members.map((member) => ({id: member.construct, weight: member.weight, included: pointById.has(member.construct)}))},
        });
      }
    }
    return {
      format: FIELD_PROJECTION_FORMAT,
      application: applicationSummary(application),
      dataset_version: application.version,
      bounds: BOUNDS,
      config: view,
      points,
      excluded,
    };
  }

  function projectEntropy(applicationValue, rawConfig) {
    const application = normalizeApplication(applicationValue);
    const config = validateEntropyConfig(rawConfig, application);
    const selected = selectedObservations(application, config.time);
    const filterIds = new Set(config.filter.construct_ids);
    const requestedRange = config.range;
    const points = [];
    const excluded = [];
    const pointById = new Map();
    const dependencyIds = new Set();

    if (config.filter.include_composites && filterIds.size) {
      for (const composite of application.composites) {
        if (!filterIds.has(composite.id)) continue;
        for (const member of composite.members) dependencyIds.add(member.construct);
      }
    }

    for (const construct of application.constructs) {
      const emitted = !filterIds.size || filterIds.has(construct.id);
      if (!emitted && !dependencyIds.has(construct.id)) continue;
      if (!intervalsOverlap(construct.time, requestedRange)) continue;
      if (config.time.mode === "at") {
        const declared = construct.time.start != null || construct.time.end != null;
        if (!declared) {
          if (emitted) excluded.push({id: construct.id, label: construct.label, reason: "missing declared lifespan for explicit time"});
          continue;
        }
        if ((construct.time.start != null && config.time.value < construct.time.start) ||
            (construct.time.end != null && config.time.value > construct.time.end)) continue;
      }

      let sum = 0;
      let count = 0;
      const scalarStates = {};
      for (const scalar of application.scalars) {
        const state = selected.get(`${construct.id}\u0000${scalar.id}`);
        if (!state) continue;
        sum += state.value;
        count += 1;
        scalarStates[scalar.id] = {
          value: state.value,
          time: copy(state.time),
          confidence: state.confidence,
          provenance: state.provenance,
        };
      }
      if (!count) {
        if (emitted) excluded.push({id: construct.id, label: construct.label, reason: "no discrete scalar state for Semantic Entropy"});
        continue;
      }
      const entropy = sum / count;
      const coverage = count / application.scalars.length;
      const point = {
        id: construct.id,
        label: construct.label,
        name: construct.label,
        kind: "construct",
        entropy,
        raw: {sum, count},
        coverage,
        hover: {
          id: construct.id,
          label: construct.label,
          time: copy(construct.time),
          metadata: construct.metadata,
          scalars: scalarStates,
          semantic_entropy: {
            sum,
            count,
            registry_count: application.scalars.length,
            coverage,
            value: entropy,
          },
        },
      };
      pointById.set(point.id, point);
      if (emitted) points.push(point);
    }

    if (config.filter.include_composites) {
      for (const composite of application.composites) {
        if (filterIds.size && !filterIds.has(composite.id)) continue;
        const total = composite.members.reduce((sum, member) => sum + member.weight, 0);
        const present = composite.members.flatMap((member) => pointById.has(member.construct) ? [{point: pointById.get(member.construct), weight: member.weight}] : []);
        const coverage = present.reduce((sum, member) => sum + member.weight, 0) / total;
        if (!present.length || coverage < composite.minimumCoverage) {
          excluded.push({id: composite.id, label: composite.label, reason: "composite member coverage below minimum"});
          continue;
        }
        const weightSum = present.reduce((sum, member) => sum + member.weight, 0);
        const weightedSum = present.reduce((sum, member) => sum + member.point.entropy * member.weight, 0);
        const entropy = weightedSum / weightSum;
        points.push({
          id: composite.id,
          label: composite.label,
          name: composite.label,
          kind: "composite",
          entropy,
          raw: {weighted_sum: weightedSum, weight_sum: weightSum},
          coverage,
          hover: {
            id: composite.id,
            label: composite.label,
            metadata: composite.metadata,
            semantic_entropy: {
              value: entropy,
              operation: "weighted-member-mean",
              weighted_sum: weightedSum,
              weight_sum: weightSum,
              member_coverage: coverage,
            },
            members: composite.members.map((member) => ({
              id: member.construct,
              weight: member.weight,
              included: pointById.has(member.construct),
            })),
          },
        });
      }
    }

    return {
      format: ENTROPY_PROJECTION_FORMAT,
      dimension: 1,
      application: applicationSummary(application),
      dataset_version: application.version,
      bounds: BOUNDS,
      measure: {
        id: "semantic-entropy",
        label: "Semantic Entropy",
        operation: "sum-divided-by-count",
        profile: "all available selected scalar constructs",
      },
      config,
      scalar_registry_count: application.scalars.length,
      points,
      excluded,
    };
  }

  function cartographyMode(value) {
    if (value != null && typeof value !== "string") {
      throw new TypeError("Cartographer mode must be field or entropy");
    }
    const mode = value == null ? "field" : value;
    if (mode !== "field" && mode !== "entropy") {
      throw new RangeError("Cartographer mode must be field or entropy");
    }
    return mode;
  }

  function projectForMode(application, view, mode) {
    return mode === "entropy" ? projectEntropy(application, {
      time: view.time,
      range: view.range,
      filter: view.filter,
    }) : project(application, view);
  }

  function matterView(application, settings, mode) {
    const configured = settings.config;
    const configuredHasAxes = Boolean(configured && typeof configured === "object" &&
      !Array.isArray(configured) && Object.prototype.hasOwnProperty.call(configured, "axes"));
    const rawFieldView = settings.view || (configuredHasAxes ? configured : null) || defaultView(application);
    let view = validateView(rawFieldView, application);
    const rawEntropy = settings.entropyConfig || settings.entropy_config ||
      (mode === "entropy" && configured && !configuredHasAxes ? configured : null);
    if (rawEntropy) {
      const selection = validateEntropyConfig(rawEntropy, application);
      view = validateView({
        axes: view.axes,
        time: selection.time,
        range: selection.range,
        filter: selection.filter,
      }, application);
    }
    return view;
  }

  const POINT_VERTEX = `
    attribute vec3 a_position;
    attribute vec4 a_color;
    attribute float a_size;
    uniform mat4 u_viewProjection;
    uniform float u_pixelRatio;
    varying vec4 v_color;
    void main() {
      vec4 clip = u_viewProjection * vec4(a_position, 1.0);
      gl_Position = clip;
      gl_PointSize = clamp(a_size * u_pixelRatio * (90.0 / max(12.0, clip.w)), 2.0, 22.0 * u_pixelRatio);
      v_color = a_color;
    }
  `;
  const POINT_FRAGMENT = `
    precision mediump float;
    varying vec4 v_color;
    void main() {
      vec2 offset = gl_PointCoord - vec2(0.5);
      float radius = length(offset);
      if (radius > 0.5) discard;
      float core = 1.0 - smoothstep(0.10, 0.50, radius);
      float halo = 1.0 - smoothstep(0.28, 0.50, radius);
      gl_FragColor = vec4(v_color.rgb + core * 0.22, v_color.a * max(core, halo * 0.38));
    }
  `;
  const LINE_VERTEX = `
    attribute vec3 a_position;
    uniform mat4 u_viewProjection;
    void main() { gl_Position = u_viewProjection * vec4(a_position, 1.0); }
  `;
  const LINE_FRAGMENT = `
    precision mediump float;
    uniform vec4 u_color;
    void main() { gl_FragColor = u_color; }
  `;

  class Field {
    constructor(options) {
      this.options = Object.assign({
        worldSize: 120,
        gridDivisions: 8,
        moveSpeed: 20,
        lookSpeed: 0.0024,
        background: [0.025, 0.075, 0.055, 1],
        pointColor: [0.84, 0.68, 0.32, 0.94],
        gridColor: [0.62, 0.78, 0.66, 0.16],
        info: true,
        emitTransitions: false,
      }, options || {});
      this.canvas = resolveCanvas(this.options.canvas || "#field-canvas");
      this.gl = null;
      this.error = null;
      this.supported = false;
      this.running = false;
      this.visible = [];
      this.coordinateStacks = new Map();
      this.projection = null;
      this.mode = "field";
      this.projectedAxes = null;
      this.currentTime = null;
      this.keys = new Set();
      this.drag = null;
      this.pointer = null;
      this.hovered = null;
      this.speed = clamp(finite(this.options.moveSpeed, 20), 0.1, 500);
      this.yaw = finite(this.options.yaw, 0);
      this.pitch = clamp(finite(this.options.pitch, 0), -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      const size = clamp(finite(this.options.worldSize, 120), 1, 100000);
      this.worldSize = size;
      const spawn = Array.isArray(this.options.position) ? this.options.position : [0, 0, size * 0.38];
      this.position = [finite(spawn[0], 0), finite(spawn[1], 0), finite(spawn[2], size * 0.38)];
      this.viewProjection = identity();
      this.lastFrame = 0;
      this.raf = 0;
      this.pickRaf = 0;
      this.resizeObserver = null;
      this.listeners = [];
      this.buffers = [];
      this.programs = [];
      if (!this.canvas) {
        this.fail("SemanticFieldCartographer needs a canvas element", new TypeError("Canvas not found"));
        return;
      }
      try {
        this.initializeWebGL();
        this.bindEvents();
        if (this.options.projection) this.setProjection(this.options.projection);
        else this.uploadVisible([], [], [], []);
        if (this.options.autoStart !== false) this.start();
        this.supported = true;
        this.canvas.dataset.semanticFieldState = "ready";
        if (this.options.emitLifecycle !== false) {
          dispatch(this.canvas, "semantic-field:ready", {count: this.visible.length, bounds: BOUNDS});
        }
      } catch (error) {
        this.fail("This browser could not start the semantic field cartographer", error);
      }
    }

    fail(message, error) {
      this.error = error || new Error(message);
      this.supported = false;
      if (this.canvas) {
        this.canvas.dataset.semanticFieldState = "error";
        this.canvas.setAttribute("aria-label", message);
        dispatch(this.canvas, "semantic-field:error", {message});
      }
      if (typeof this.options.onError === "function") this.options.onError(this.error);
      else if (global.console && console.error) console.error(`[SemanticFieldCartographer] ${message}`, this.error);
    }

    initializeWebGL() {
      const attributes = {alpha: false, antialias: true, depth: true, powerPreference: "high-performance"};
      const gl = this.canvas.getContext("webgl", attributes) || this.canvas.getContext("experimental-webgl", attributes);
      if (!gl) throw new Error("WebGL is unavailable");
      this.gl = gl;
      this.pointProgram = createProgram(gl, POINT_VERTEX, POINT_FRAGMENT);
      this.lineProgram = createProgram(gl, LINE_VERTEX, LINE_FRAGMENT);
      this.programs.push(this.pointProgram, this.lineProgram);
      this.pointLocations = {
        position: gl.getAttribLocation(this.pointProgram, "a_position"),
        color: gl.getAttribLocation(this.pointProgram, "a_color"),
        size: gl.getAttribLocation(this.pointProgram, "a_size"),
        matrix: gl.getUniformLocation(this.pointProgram, "u_viewProjection"),
        pixelRatio: gl.getUniformLocation(this.pointProgram, "u_pixelRatio"),
      };
      this.lineLocations = {
        position: gl.getAttribLocation(this.lineProgram, "a_position"),
        matrix: gl.getUniformLocation(this.lineProgram, "u_viewProjection"),
        color: gl.getUniformLocation(this.lineProgram, "u_color"),
      };
      this.positionBuffer = gl.createBuffer();
      this.colorBuffer = gl.createBuffer();
      this.sizeBuffer = gl.createBuffer();
      this.gridBuffer = gl.createBuffer();
      this.buffers.push(this.positionBuffer, this.colorBuffer, this.sizeBuffer, this.gridBuffer);
      this.gridVertexCount = 0;
      this.setGuideGeometry("field");
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    setGuideGeometry(mode) {
      if (!this.gl) return;
      const geometry = mode === "entropy" ? buildEntropyLine(this.worldSize) :
        buildBoundaryGrid(this.worldSize, clamp(Math.round(finite(this.options.gridDivisions, 8)), 2, 32));
      this.gridVertexCount = geometry.length / 3;
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.gridBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, geometry, this.gl.STATIC_DRAW);
    }

    on(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      this.listeners.push(() => target.removeEventListener(type, handler, options));
    }

    bindEvents() {
      const canvas = this.canvas;
      if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
      this.on(canvas, "keydown", (event) => {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target && event.target.tagName)) return;
        const key = event.code;
        if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyC", "Space", "ShiftLeft", "ShiftRight"].includes(key)) {
          this.keys.add(key);
          event.preventDefault();
        }
      });
      this.on(canvas, "keyup", (event) => this.keys.delete(event.code));
      this.on(canvas, "blur", () => this.keys.clear());
      this.on(canvas, "pointerdown", (event) => {
        if (event.button !== 0) return;
        canvas.focus({preventScroll: true});
        this.pointer = {x: event.clientX, y: event.clientY};
        if (!this.pickRaf) this.pickRaf = requestAnimationFrame(() => { this.pickRaf = 0; this.pick(); });
        canvas.setPointerCapture(event.pointerId);
        this.drag = {x: event.clientX, y: event.clientY};
        canvas.dataset.navigating = "true";
      });
      this.on(canvas, "pointermove", (event) => {
        this.pointer = {x: event.clientX, y: event.clientY};
        if (document.pointerLockElement === canvas) {
          this.rotate(event.movementX, event.movementY);
          return;
        }
        if (this.drag) {
          this.rotate(event.clientX - this.drag.x, event.clientY - this.drag.y);
          this.drag = {x: event.clientX, y: event.clientY};
          return;
        }
        if (!this.pickRaf) this.pickRaf = requestAnimationFrame(() => { this.pickRaf = 0; this.pick(); });
      });
      const endDrag = () => { this.drag = null; delete canvas.dataset.navigating; };
      this.on(canvas, "pointerup", endDrag);
      this.on(canvas, "pointercancel", endDrag);
      this.on(canvas, "pointerleave", (event) => {
        if (!this.drag && document.pointerLockElement !== canvas) {
          this.pointer = null;
          if (!event.relatedTarget) this.setHovered(null);
        }
      });
      this.on(global, "blur", () => {
        this.pointer = null;
        this.setHovered(null);
      });
      this.on(canvas, "dblclick", () => {
        if (this.options.pointerLock !== false && canvas.requestPointerLock) canvas.requestPointerLock();
      });
      this.on(canvas, "contextmenu", (event) => event.preventDefault());
      this.on(canvas, "wheel", (event) => {
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * 0.0014);
        this.speed = clamp(this.speed * factor, 0.5, 500);
        dispatch(canvas, "semantic-field:speed", {speed: this.speed});
      }, {passive: false});
      this.on(canvas, "webglcontextlost", (event) => {
        event.preventDefault();
        this.stop();
        this.fail("The semantic field WebGL context was lost", new Error("WebGL context lost"));
      });
      this.on(canvas, "webglcontextrestored", () => {
        dispatch(canvas, "semantic-field:error", {message: "WebGL restored; create a new field instance to resume"});
      });
      if (typeof ResizeObserver === "function") {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas);
      } else this.on(global, "resize", () => this.resize());
      this.resize();
    }

    rotate(dx, dy) {
      const sensitivity = clamp(finite(this.options.lookSpeed, 0.0024), 0.0001, 0.05);
      this.yaw -= dx * sensitivity;
      this.pitch = clamp(this.pitch - dy * sensitivity, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    }

    forward() {
      const cosine = Math.cos(this.pitch);
      return [Math.sin(this.yaw) * cosine, Math.sin(this.pitch), -Math.cos(this.yaw) * cosine];
    }

    move(delta) {
      const forward = this.forward();
      const flatForward = normalize([forward[0], 0, forward[2]]);
      const right = [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
      let x = 0, y = 0, z = 0;
      if (this.keys.has("KeyW")) { x += flatForward[0]; z += flatForward[2]; }
      if (this.keys.has("KeyS")) { x -= flatForward[0]; z -= flatForward[2]; }
      if (this.keys.has("KeyD")) { x += right[0]; z += right[2]; }
      if (this.keys.has("KeyA")) { x -= right[0]; z -= right[2]; }
      if (this.keys.has("KeyE") || this.keys.has("Space")) y += 1;
      if (this.keys.has("KeyQ") || this.keys.has("KeyC")) y -= 1;
      const length = Math.hypot(x, y, z);
      if (length <= EPSILON) return false;
      const boost = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 3 : 1;
      const distance = this.speed * boost * delta / length;
      this.position[0] += x * distance;
      this.position[1] += y * distance;
      this.position[2] += z * distance;
      return true;
    }

    resize() {
      if (!this.canvas || !this.gl) return;
      const bounds = this.canvas.getBoundingClientRect();
      const ratio = clamp(global.devicePixelRatio || 1, 1, 2.5);
      const width = Math.max(1, Math.round(bounds.width * ratio));
      const height = Math.max(1, Math.round(bounds.height * ratio));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
      }
    }

    setProjection(projection) {
      const source = object(projection, "projection");
      const format = source.format == null ? FIELD_PROJECTION_FORMAT : source.format;
      if (format !== FIELD_PROJECTION_FORMAT && format !== ENTROPY_PROJECTION_FORMAT) {
        throw new RangeError("Unsupported projection format");
      }
      const mode = format === ENTROPY_PROJECTION_FORMAT ? "entropy" : "field";
      if (!Array.isArray(source.points)) throw new TypeError("projection.points must be an array");
      const previous = new Map(this.visible.map((item) => [item.id, item]));
      const positions = [];
      const colors = [];
      const sizes = [];
      const visible = [];
      for (const rawPoint of source.points) {
        const point = object(rawPoint, "projected point");
        const pointId = identifier(point.id, "point.id");
        const coordinateValues = mode === "entropy" ?
          [unit(point.entropy, "point.entropy")] :
          AXES.map((axis) => unit(point[axis], `point.${axis}`));
        const coordinates = mode === "entropy" ? {entropy: coordinateValues[0]} :
          {x: coordinateValues[0], y: coordinateValues[1], z: coordinateValues[2]};
        const semanticPosition = mode === "entropy" ? [coordinateValues[0], BOUNDS.center, BOUNDS.center] : coordinateValues;
        const position = semanticToWorld(semanticPosition, this.worldSize);
        const coordinateKey = mode === "entropy" ? `entropy:${String(coordinateValues[0])}` :
          `field:${coordinateValues.map((value) => String(value)).join("|")}`;
        const hover = point.hover && typeof point.hover === "object" ? point.hover : {};
        const metadata = hover.metadata && typeof hover.metadata === "object" ? hover.metadata : {};
        const entity = {
          id: pointId,
          name: point.name || point.label || point.id,
          label: point.label || point.name || point.id,
          kind: point.kind || "construct",
          description: metadata.description || metadata.purpose || "",
          time: hover.time || null,
          metadata,
          hover,
          coverage: point.coverage,
          truthLayer: source.application && source.application.truth_layer,
        };
        const scalarValues = {};
        for (const [id, state] of Object.entries(hover.scalars || {})) {
          scalarValues[id] = unit(object(state, `point.${pointId}.scalar.${id}`).value,
            `point.${pointId}.scalar.${id}.value`);
        }
        const fallbackColor = point.kind === "composite" ? [0.96, 0.94, 0.89, 0.98] : this.options.pointColor;
        const color = parseColor(point.color, fallbackColor);
        const pointSize = clamp(finite(point.pointSize || point.size, point.kind === "composite" ? 10 : 6), 1, 40);
        positions.push(...position);
        colors.push(...color);
        sizes.push(pointSize);
        visible.push({
          id: pointId, source: entity, scalars: scalarValues, stateTime: null,
          coordinates, coordinateKey, position, pointSize, point,
        });
      }
      this.visible = visible;
      this.projection = source;
      this.mode = mode;
      this.projectedAxes = mode === "field" && source.config && source.config.axes ? copy(source.config.axes) : null;
      this.currentTime = source.config && source.config.time && source.config.time.mode === "at" ? source.config.time.value : null;
      this.setGuideGeometry(mode);
      this.uploadVisible(visible, positions, colors, sizes);
      this.refreshCoordinateStacks();
      this.refreshHovered();
      if (this.options.emitTransitions && previous.size) {
        const transitions = visible.flatMap((item) => {
          const before = previous.get(item.id);
          if (!before || before.coordinateKey === item.coordinateKey) return [];
          return [{id: item.id, entity: item.source,
            from: Object.assign({}, before.coordinates), to: Object.assign({}, item.coordinates)}];
        });
        if (transitions.length) dispatch(this.canvas, "semantic-field:state-transition", {
          transitions, time: this.currentTime, count: visible.length,
        });
      }
      if (this.options.emitLifecycle !== false) {
        dispatch(this.canvas, "semantic-field:projection", {projection: source, count: visible.length});
      }
      return this;
    }

    uploadVisible(visible, positions, colors, sizes) {
      if (!this.gl) return;
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sizes), gl.DYNAMIC_DRAW);
    }

    refreshCoordinateStacks() {
      this.coordinateStacks = new Map();
      for (const item of this.visible) {
        const stack = this.coordinateStacks.get(item.coordinateKey) || [];
        stack.push(item);
        this.coordinateStacks.set(item.coordinateKey, stack);
      }
    }

    refreshHovered() {
      if (!this.hovered) return;
      const next = this.visible.find((entry) => entry.id === this.hovered.id) || null;
      this.hovered = null;
      this.setHovered(next);
    }

    updateMatrix() {
      const forward = this.forward();
      const target = [this.position[0] + forward[0], this.position[1] + forward[1], this.position[2] + forward[2]];
      const view = lookAt(this.position, target, [0, 1, 0]);
      const aspect = this.canvas.width / Math.max(1, this.canvas.height);
      const projection = perspective(Math.PI / 3, aspect, 0.08, Math.max(1000, this.worldSize * 15));
      this.viewProjection = multiply(projection, view);
    }

    render() {
      const gl = this.gl;
      if (!gl) return;
      this.resize();
      this.updateMatrix();
      const background = parseColor(this.options.background, [0.025, 0.075, 0.055, 1]);
      gl.clearColor(background[0], background[1], background[2], background[3]);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(this.lineProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
      gl.enableVertexAttribArray(this.lineLocations.position);
      gl.vertexAttribPointer(this.lineLocations.position, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(this.lineLocations.matrix, false, this.viewProjection);
      gl.uniform4fv(this.lineLocations.color, parseColor(this.options.gridColor, [0.62, 0.78, 0.66, 0.16]));
      gl.drawArrays(gl.LINES, 0, this.gridVertexCount);

      gl.useProgram(this.pointProgram);
      gl.uniformMatrix4fv(this.pointLocations.matrix, false, this.viewProjection);
      gl.uniform1f(this.pointLocations.pixelRatio, clamp(global.devicePixelRatio || 1, 1, 2.5));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      gl.enableVertexAttribArray(this.pointLocations.position);
      gl.vertexAttribPointer(this.pointLocations.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
      gl.enableVertexAttribArray(this.pointLocations.color);
      gl.vertexAttribPointer(this.pointLocations.color, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
      gl.enableVertexAttribArray(this.pointLocations.size);
      gl.vertexAttribPointer(this.pointLocations.size, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, this.visible.length);
    }

    frame(time) {
      if (!this.running) return;
      const delta = this.lastFrame ? Math.min(0.05, (time - this.lastFrame) / 1000) : 0;
      this.lastFrame = time;
      const moved = this.move(delta);
      this.render();
      if (moved) dispatch(this.canvas, "semantic-field:camera", this.getCamera());
      this.raf = requestAnimationFrame((next) => this.frame(next));
    }

    pick() {
      if (!this.pointer || !this.canvas || !this.visible.length) return this.setHovered(null);
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = this.pointer.x - rect.left;
      const mouseY = this.pointer.y - rect.top;
      let best = null;
      let bestDistance = Infinity;
      let bestDepth = Infinity;
      for (const item of this.visible) {
        const clip = transformPoint(this.viewProjection, item.position);
        if (clip[3] <= 0 || clip[2] < -clip[3] || clip[2] > clip[3]) continue;
        const screenX = (clip[0] / clip[3] * 0.5 + 0.5) * rect.width;
        const screenY = (1 - (clip[1] / clip[3] * 0.5 + 0.5)) * rect.height;
        const radius = clamp(item.pointSize * 90 / Math.max(12, clip[3]), 5, 20) + 5;
        const distance = Math.hypot(screenX - mouseX, screenY - mouseY);
        const depth = clip[2] / clip[3];
        if (distance <= radius && (distance < bestDistance - EPSILON || (Math.abs(distance - bestDistance) <= EPSILON && depth < bestDepth))) {
          best = item;
          bestDistance = distance;
          bestDepth = depth;
        }
      }
      this.setHovered(best);
    }

    setHovered(item) {
      if ((this.hovered && item && this.hovered.id === item.id) || (!this.hovered && !item)) return;
      this.hovered = item;
      this.canvas.style.cursor = item ? "crosshair" : "grab";
      const stackKey = item ? item.coordinateKey : null;
      const stack = stackKey ? (this.coordinateStacks.get(stackKey) || [item]) : [];
      const detail = item ? {
        entity: item.source,
        id: item.id,
        mode: this.mode,
        coordinates: Object.assign({}, item.coordinates),
        scalars: Object.assign({}, item.scalars),
        axes: this.projectedAxes ? copy(this.projectedAxes) : [],
        measure: this.mode === "entropy" && this.projection.measure ? copy(this.projection.measure) : null,
        time: this.currentTime,
        stateTime: item.stateTime,
        stack: stack.map((entry) => ({
          id: entry.id,
          mode: this.mode,
          entity: entry.source,
          coordinates: Object.assign({}, entry.coordinates),
          scalars: Object.assign({}, entry.scalars),
        })),
      } : {entity: null, id: null};
      if (item && this.options.info !== false) this.writeInfo(detail);
      dispatch(this.canvas, "semantic-field:hover", detail);
      if (typeof this.options.onHover === "function") this.options.onHover(detail);
    }

    writeInfo(detail) {
      if (typeof this.options.info === "function") {
        this.options.info(detail);
        return;
      }
      const item = detail.entity;
      const ids = Object.assign({
        name: "field-entity-name",
        description: "field-entity-description",
        x: "field-x-value",
        y: "field-y-value",
        z: "field-z-value",
        entropy: "field-entropy-value",
      }, this.options.infoIds || {});
      const setText = (id, value) => {
        const element = id && document.getElementById(id);
        if (element && value != null) element.textContent = String(value);
      };
      setText(ids.name, item.name || item.label || item.id || detail.id);
      setText(ids.description, item.description);
      if (detail.mode === "entropy") setText(ids.entropy, `${Math.round(detail.coordinates.entropy * 100)}%`);
      else {
        setText(ids.x, `${Math.round(detail.coordinates.x * 100)}%`);
        setText(ids.y, `${Math.round(detail.coordinates.y * 100)}%`);
        setText(ids.z, `${Math.round(detail.coordinates.z * 100)}%`);
      }
    }

    getCamera() {
      return {position: this.position.slice(), yaw: this.yaw, pitch: this.pitch, speed: this.speed};
    }

    setCamera(camera) {
      if (!camera || typeof camera !== "object") throw new TypeError("Camera must be an object");
      if (Array.isArray(camera.position) && camera.position.length >= 3) {
        this.position = camera.position.slice(0, 3).map((value, index) => finite(value, this.position[index]));
      }
      this.yaw = finite(camera.yaw, this.yaw);
      this.pitch = clamp(finite(camera.pitch, this.pitch), -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      this.speed = clamp(finite(camera.speed, this.speed), 0.5, 500);
      return this;
    }

    start() {
      if (this.running || !this.gl) return this;
      this.running = true;
      this.lastFrame = 0;
      this.raf = requestAnimationFrame((time) => this.frame(time));
      return this;
    }

    stop() {
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      return this;
    }

    destroy() {
      this.stop();
      if (this.pickRaf) cancelAnimationFrame(this.pickRaf);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      for (const remove of this.listeners.splice(0)) remove();
      if (document.pointerLockElement === this.canvas && document.exitPointerLock) document.exitPointerLock();
      if (this.gl) {
        for (const buffer of this.buffers) this.gl.deleteBuffer(buffer);
        for (const program of this.programs) this.gl.deleteProgram(program);
      }
      this.visible = [];
      this.gl = null;
      this.supported = false;
      if (this.canvas) {
        this.canvas.dataset.semanticFieldState = "destroyed";
        if (this.options.emitLifecycle !== false) {
          dispatch(this.canvas, "semantic-field:destroy", {count: 0});
        }
      }
    }
  }

  class Matter {
    constructor(options) {
      const settings = object(options || {}, "Cartographer options");
      const supplied = settings.application || settings.pack || settings.matter;
      if (!supplied) throw new TypeError("Cartographer options require an application pack");
      this.options = settings;
      this.application = normalizeApplication(supplied, {truthLayer: settings.truthLayer || settings.truth_layer});
      this.mode = cartographyMode(settings.mode);
      this.view = deepFreeze(matterView(this.application, settings, this.mode));
      this.projection = deepFreeze(projectForMode(this.application, this.view, this.mode));
      this.renderer = null;
      this.revision = 1;
      this.listeners = new Set();
      this.destroyed = false;
      if (typeof settings.onChange === "function") this.listeners.add(settings.onChange);
      if (settings.canvas) this.attach(settings.canvas, settings.renderer || settings.rendererOptions || settings);
    }

    assertLive() {
      if (this.destroyed) throw new Error("This Semantic Field Cartographer matter has been destroyed");
    }

    event(type) {
      return {
        type,
        revision: this.revision,
        mode: this.mode,
        application: applicationSummary(this.application),
        view: copy(this.view),
        projection: this.projection,
      };
    }

    emit(type) {
      const detail = this.event(type);
      for (const listener of Array.from(this.listeners)) listener(detail);
      if (this.renderer && this.renderer.canvas) dispatch(this.renderer.canvas, `semantic-field:${type}`, detail);
    }

    subscribe(listener) {
      this.assertLive();
      if (typeof listener !== "function") throw new TypeError("subscribe needs a function");
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    attach(canvas, options) {
      this.assertLive();
      if (this.renderer) this.renderer.destroy();
      const rendererOptions = Object.assign({}, options || {}, {
        canvas,
        info: options && Object.prototype.hasOwnProperty.call(options, "info") ? options.info : false,
        emitLifecycle: false,
      });
      delete rendererOptions.application;
      delete rendererOptions.pack;
      delete rendererOptions.matter;
      delete rendererOptions.view;
      delete rendererOptions.config;
      delete rendererOptions.truthLayer;
      delete rendererOptions.truth_layer;
      delete rendererOptions.renderer;
      delete rendererOptions.rendererOptions;
      delete rendererOptions.onChange;
      delete rendererOptions.mode;
      delete rendererOptions.entropyConfig;
      delete rendererOptions.entropy_config;
      const renderer = new Field(rendererOptions);
      if (renderer.supported === false) {
        this.renderer = null;
        throw renderer.error || new Error("Semantic Field Cartographer renderer could not attach");
      }
      this.renderer = renderer;
      this.renderer.setProjection(this.projection);
      this.emit("ready");
      return this;
    }

    detach() {
      this.assertLive();
      if (this.renderer) this.renderer.destroy();
      this.renderer = null;
      return this;
    }

    commit(nextView, type) {
      this.assertLive();
      const validated = deepFreeze(validateView(nextView, this.application));
      const nextProjection = deepFreeze(projectForMode(this.application, validated, this.mode));
      const previousView = this.view;
      const previousProjection = this.projection;
      this.view = validated;
      this.projection = nextProjection;
      try {
        if (this.renderer) this.renderer.setProjection(nextProjection);
      } catch (error) {
        this.view = previousView;
        this.projection = previousProjection;
        try { if (this.renderer) this.renderer.setProjection(previousProjection); } catch (_) { /* preserve the originating error */ }
        throw error;
      }
      this.revision += 1;
      this.emit(type || "projection");
      return this;
    }

    setView(view) {
      return this.commit(view, "projection");
    }

    updateView(patch, type) {
      const changes = object(patch, "view patch");
      exactKeys(changes, [], ["axes", "time", "range", "filter"], "view patch");
      const next = copy(this.view);
      for (const key of ["axes", "time", "range", "filter"]) {
        if (Object.prototype.hasOwnProperty.call(changes, key)) next[key] = changes[key];
      }
      return this.commit(next, type || "projection");
    }

    setAxes(axes) {
      return this.updateView({axes}, "configuration");
    }

    setTime(time) {
      return this.updateView({time}, "time");
    }

    setRange(range) {
      return this.updateView({range});
    }

    setFilter(filter) {
      return this.updateView({filter});
    }

    setMode(modeValue) {
      this.assertLive();
      const nextMode = cartographyMode(modeValue);
      if (nextMode === this.mode) return this;
      const nextProjection = deepFreeze(projectForMode(this.application, this.view, nextMode));
      const previousMode = this.mode;
      const previousProjection = this.projection;
      this.mode = nextMode;
      this.projection = nextProjection;
      try {
        if (this.renderer) this.renderer.setProjection(nextProjection);
      } catch (error) {
        this.mode = previousMode;
        this.projection = previousProjection;
        try { if (this.renderer) this.renderer.setProjection(previousProjection); } catch (_) { /* preserve the originating error */ }
        throw error;
      }
      this.revision += 1;
      this.emit("mode");
      return this;
    }

    replaceApplication(raw, options) {
      this.assertLive();
      const settings = options || {};
      const nextApplication = normalizeApplication(raw, {truthLayer: settings.truthLayer || settings.truth_layer});
      const nextMode = settings.mode == null ? this.mode : cartographyMode(settings.mode);
      const nextView = deepFreeze(matterView(nextApplication, settings, nextMode));
      const nextProjection = deepFreeze(projectForMode(nextApplication, nextView, nextMode));
      const previousApplication = this.application;
      const previousView = this.view;
      const previousMode = this.mode;
      const previousProjection = this.projection;
      this.application = nextApplication;
      this.view = nextView;
      this.mode = nextMode;
      this.projection = nextProjection;
      try {
        if (this.renderer) this.renderer.setProjection(nextProjection);
      } catch (error) {
        this.application = previousApplication;
        this.view = previousView;
        this.mode = previousMode;
        this.projection = previousProjection;
        try { if (this.renderer) this.renderer.setProjection(previousProjection); } catch (_) { /* preserve the originating error */ }
        throw error;
      }
      this.revision += 1;
      this.emit("application");
      return this;
    }

    getCatalog() {
      this.assertLive();
      return {
        application: applicationSummary(this.application),
        bounds: BOUNDS,
        construct_count: this.application.constructs.length,
        composite_count: this.application.composites.length,
        observation_count: this.application.observations.length,
        scalars: this.application.scalars.map((scalar) => ({id: scalar.id, label: scalar.label, description: scalar.description, aliases: scalar.aliases.slice()})),
      };
    }

    getPoint(id) {
      this.assertLive();
      return this.projection.points.find((point) => point.id === String(id)) || null;
    }

    getState() {
      this.assertLive();
      return {
        revision: this.revision,
        mode: this.mode,
        application: applicationSummary(this.application),
        bounds: BOUNDS,
        view: copy(this.view),
        projection: this.projection,
        sceneCamera: this.renderer ? this.renderer.getCamera() : null,
      };
    }

    start() {
      this.assertLive();
      if (this.renderer) this.renderer.start();
      return this;
    }

    stop() {
      this.assertLive();
      if (this.renderer) this.renderer.stop();
      return this;
    }

    destroy() {
      if (this.destroyed) return;
      const renderer = this.renderer;
      const canvas = renderer && renderer.canvas;
      this.renderer = null;
      if (renderer) renderer.destroy();
      const detail = this.event("destroy");
      for (const listener of Array.from(this.listeners)) listener(detail);
      if (canvas) dispatch(canvas, "semantic-field:destroy", detail);
      this.listeners.clear();
      this.destroyed = true;
    }
  }

  const SemanticFieldCartographer = Object.freeze({
    version: "2.1.0",
    bounds: BOUNDS,
    contracts: Object.freeze({
      application: "semantic-field.application/1",
      applicationPack: "semantic-field.application-pack/1",
      projection: FIELD_PROJECTION_FORMAT,
      entropyProjection: ENTROPY_PROJECTION_FORMAT,
    }),
    create(options) {
      if (options && (options.application || options.pack || options.matter)) return new Matter(options);
      return new Field(options);
    },
    createMatter(options) { return new Matter(options); },
    createRenderer(options) { return new Field(options); },
    Matter,
    Field,
    normalizeApplication,
    defaultConfig: defaultView,
    defaultView,
    defaultEntropyConfig,
    validateConfig(application, config) { return validateView(config, application); },
    validateView,
    validateEntropyConfig: (application, config) => validateEntropyConfig(config, application),
    project,
    projectEntropy,
    semanticToWorld,
    worldToSemantic,
  });

  global.SemanticFieldCartographer = SemanticFieldCartographer;
  global.SemanticFieldSimulator = SemanticFieldCartographer;
  global.SemanticField = SemanticFieldCartographer;
  global.TotalityField = SemanticFieldCartographer;
  if (typeof module === "object" && module && module.exports) module.exports = SemanticFieldCartographer;
})(typeof window !== "undefined" ? window : globalThis);
