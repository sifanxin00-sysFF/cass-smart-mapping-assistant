import { FEATURE_TYPES, type CandidateFeature, type FeatureType, type SurveyPoint } from "../types/project";

const MIN_SEQUENCE_LENGTH = 4;
const MAX_CANDIDATE_POINT_COUNT = 8;

type NumberedPoint = {
  id: string;
  value: number;
};

type KeywordRule = {
  type: FeatureType;
  label: string;
};

const KEYWORD_RULES: Record<string, KeywordRule> = {
  房角点: { type: "building", label: "建筑物" },
  建筑物: { type: "building", label: "建筑物" },
  building: { type: "building", label: "建筑物" },
  绿化带: { type: "green_area", label: "绿化带" },
  green_area: { type: "green_area", label: "绿化带" },
  道路边线: { type: "road_edge", label: "道路边线" },
  road_edge: { type: "road_edge", label: "道路边线" },
  围墙: { type: "wall", label: "围墙" },
  wall: { type: "wall", label: "围墙" },
  台阶: { type: "stairs", label: "台阶" },
  stairs: { type: "stairs", label: "台阶" },
  独立树: { type: "tree", label: "独立树" },
  tree: { type: "tree", label: "独立树" },
  井盖: { type: "manhole", label: "井盖" },
  manhole: { type: "manhole", label: "井盖" }
};

export function generateCandidateFeatures(points: SurveyPoint[]): CandidateFeature[] {
  return [
    ...generateSequenceCandidates(points),
    ...generateCodeCandidates(points),
    ...generateNoteCandidates(points)
  ];
}

function generateSequenceCandidates(points: SurveyPoint[]): CandidateFeature[] {
  const numberedPoints = points
    .map(toNumberedPoint)
    .filter((point): point is NumberedPoint => Boolean(point))
    .sort((a, b) => a.value - b.value);

  const runs = groupConsecutiveRuns(numberedPoints);
  const candidates: CandidateFeature[] = [];

  for (const run of runs) {
    if (run.length < MIN_SEQUENCE_LENGTH) continue;

    const chunks = splitRun(run, MAX_CANDIDATE_POINT_COUNT);
    for (const chunk of chunks) {
      if (chunk.length < MIN_SEQUENCE_LENGTH) continue;
      candidates.push(createSequenceCandidate(chunk, run.length > MAX_CANDIDATE_POINT_COUNT, candidates.length + 1));
    }
  }

  return candidates;
}

function generateCodeCandidates(points: SurveyPoint[]): CandidateFeature[] {
  return createGroupedCandidates("code", groupByField(points, "code"));
}

function generateNoteCandidates(points: SurveyPoint[]): CandidateFeature[] {
  const pointsWithoutCode = points.filter((point) => !point.code.trim());
  return createGroupedCandidates("note", groupByField(pointsWithoutCode, "note"));
}

function groupByField(points: SurveyPoint[], field: "note" | "code") {
  const groups = new Map<string, SurveyPoint[]>();
  for (const point of points) {
    const value = point[field].trim();
    if (!value) continue;
    const current = groups.get(value) || [];
    current.push(point);
    groups.set(value, current);
  }
  return groups;
}

function createGroupedCandidates(source: "note" | "code", groups: Map<string, SurveyPoint[]>) {
  const candidates: CandidateFeature[] = [];
  for (const [value, groupPoints] of groups.entries()) {
    const rule = resolveKeyword(value);
    const pointIds = groupPoints.map((point) => point.id);
    const type = rule?.type || "line";
    const spec = FEATURE_TYPES[type];
    const isPointFeature = Boolean(spec.point);
    const isAreaFeature = Boolean(spec.closed);

    if (isPointFeature) {
      groupPoints.forEach((point, index) => {
        candidates.push(createGroupedCandidate(source, value, [point.id], type, index + 1, groupPoints, rule));
      });
      continue;
    }

    if (isAreaFeature && pointIds.length < 3) continue;
    if (!isAreaFeature && pointIds.length < 2) continue;

    candidates.push(createGroupedCandidate(source, value, pointIds, type, candidates.length + 1, groupPoints, rule));
  }
  return candidates;
}

function createGroupedCandidate(
  source: "note" | "code",
  value: string,
  pointIds: string[],
  type: FeatureType,
  index: number,
  groupPoints: SurveyPoint[],
  rule?: KeywordRule
): CandidateFeature {
  const spec = FEATURE_TYPES[type];
  const sourceLabel = source === "code" ? "编码" : "备注";
  const pointText = pointIds.length === 1 ? "1 个点" : `${pointIds.length} 个点`;
  const conflictNotes = source === "code" ? conflictingNotes(value, groupPoints) : [];
  const hasConflict = conflictNotes.length > 0;
  const confidence = hasConflict ? 0.48 : rule ? 0.82 : 0.56;
  const featureText = spec.point ? spec.label : spec.closed ? `${spec.label}闭合面` : spec.label;
  const reason = hasConflict
    ? `code 与 note 存在冲突，已优先使用 code=${value}，note=${conflictNotes.join("、")}，请人工确认。`
    : rule
      ? `${sourceLabel}=${value}，${pointText}具有相同${sourceLabel}，推荐为${featureText}。`
      : `${pointText}具有相同${sourceLabel}：${value}，未识别明确类型，先推荐为普通线。`;

  return {
    id: `candidate_${source}_${normalizeKey(value)}_${pointIds[0]}_${index}`,
    source,
    status: "pending",
    type,
    name: `${spec.label}候选 ${value}`,
    pointIds,
    closed: spec.closed,
    layer: spec.layer,
    confidence,
    reason
  };
}

function conflictingNotes(code: string, points: SurveyPoint[]) {
  const codeRule = resolveKeyword(code);
  if (!codeRule) return [];
  const conflicts: string[] = [];
  for (const point of points) {
    const note = point.note.trim();
    if (!note) continue;
    const noteRule = resolveKeyword(note);
    if (noteRule && noteRule.type !== codeRule.type) {
      conflicts.push(note);
    }
  }
  return uniqueInOrder(conflicts);
}

function resolveKeyword(value: string) {
  return KEYWORD_RULES[normalizeKeyword(value)];
}

function normalizeKeyword(value: string) {
  return value.trim().toLowerCase();
}

function normalizeKey(value: string) {
  return normalizeKeyword(value).replace(/[^\da-z\u4e00-\u9fa5]+/gi, "_") || "group";
}

function toNumberedPoint(point: SurveyPoint): NumberedPoint | null {
  if (!/^\d+$/.test(point.id)) return null;
  return { id: point.id, value: Number(point.id) };
}

function groupConsecutiveRuns(points: NumberedPoint[]) {
  const runs: NumberedPoint[][] = [];
  let current: NumberedPoint[] = [];

  for (const point of points) {
    const previous = current[current.length - 1];
    if (!previous || point.value === previous.value + 1) {
      current.push(point);
      continue;
    }

    runs.push(current);
    current = [point];
  }

  if (current.length) runs.push(current);
  return runs;
}

function splitRun(run: NumberedPoint[], maxLength: number) {
  const chunks: NumberedPoint[][] = [];
  for (let index = 0; index < run.length; index += maxLength) {
    const chunk = run.slice(index, index + maxLength);
    if (chunk.length >= MIN_SEQUENCE_LENGTH) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

function createSequenceCandidate(points: NumberedPoint[], wasSplit: boolean, index: number): CandidateFeature {
  const first = points[0];
  const last = points[points.length - 1];
  const type = "line";
  const spec = FEATURE_TYPES[type];
  const rangeText = `${first.id}-${last.id}`;
  return {
    id: `candidate_point_sequence_${first.id}_${last.id}_${index}`,
    source: "point_sequence",
    status: "pending",
    type,
    name: `候选连线 ${rangeText}`,
    pointIds: points.map((point) => point.id),
    closed: spec.closed,
    layer: spec.layer,
    confidence: wasSplit ? 0.58 : 0.68,
    reason: wasSplit
      ? `检测到超长连续数字点号，已拆分为 ${points.length} 点候选段 ${rangeText}，需要人工确认是否成线。`
      : `检测到连续数字点号 ${rangeText}，可作为候选连线，需人工采纳后才成为正式地物。`
  };
}

function uniqueInOrder(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}
