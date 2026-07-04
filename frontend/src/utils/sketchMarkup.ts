import { FEATURE_TYPES, type CandidateFeature, type Feature, type SketchMarkup, type SketchMarkupType } from "../types/project";

export type SketchMarkupMode = "select" | SketchMarkupType;

export function createSketchMarkup(
  sketchAttachmentId: string,
  type: SketchMarkupType,
  geometry: SketchMarkup["geometry"],
  index: number
): SketchMarkup {
  return {
    id: `markup_${Date.now()}_${index}`,
    sketchAttachmentId,
    type,
    label: defaultMarkupLabel(type, index),
    geometry,
    linkedPointIds: [],
    note: ""
  };
}

export function normalizeMarkupGeometry(type: SketchMarkupType, start: { x: number; y: number }, end: { x: number; y: number }) {
  if (type === "rect") {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    };
  }
  if (type === "line") {
    return { points: [start, end] };
  }
  return { points: [start] };
}

export function markupToCandidate(markup: SketchMarkup, index: number, features: Feature[]): { candidate?: CandidateFeature; error?: string } {
  const uniquePointIds = uniqueInOrder(markup.linkedPointIds);
  const spec = specForMarkup(markup.type);
  if (markup.type === "rect" && uniquePointIds.length < 3) {
    return { error: "矩形标注至少需要绑定 3 个点号才能生成面状候选。" };
  }
  if (markup.type === "line" && uniquePointIds.length < 2) {
    return { error: "线标注至少需要绑定 2 个点号才能生成线状候选。" };
  }
  if (markup.type === "point" && uniquePointIds.length < 1) {
    return { error: "点标注至少需要绑定 1 个点号才能生成点状候选。" };
  }

  const linkedFeature = markup.linkedFeatureId ? features.find((feature) => feature.id === markup.linkedFeatureId) : null;
  return {
    candidate: {
      id: `candidate_sketch_markup_${markup.id}_${index}`,
      source: "sketch_markup",
      status: "pending",
      type: spec.type,
      name: `${markup.label || spec.label}候选`,
      pointIds: spec.point ? [uniquePointIds[0]] : uniquePointIds,
      closed: spec.closed,
      layer: spec.layer,
      confidence: 0.7,
      reason: `由草图${markupTypeLabel(markup.type)}人工标注生成，绑定点号 ${uniquePointIds.join("、")}${linkedFeature ? `，参考地物 ${linkedFeature.name}` : ""}。`
    }
  };
}

export function markupTypeLabel(type: SketchMarkupType) {
  if (type === "rect") return "矩形";
  if (type === "line") return "线";
  return "点";
}

function specForMarkup(type: SketchMarkupType) {
  if (type === "rect") return { type: "building" as const, ...FEATURE_TYPES.building };
  if (type === "line") return { type: "road_edge" as const, ...FEATURE_TYPES.road_edge };
  return { type: "tree" as const, ...FEATURE_TYPES.tree };
}

function defaultMarkupLabel(type: SketchMarkupType, index: number) {
  return `${markupTypeLabel(type)}标注 ${index}`;
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
