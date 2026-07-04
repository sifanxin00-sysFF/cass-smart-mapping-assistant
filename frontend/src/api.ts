import type { AssistantPlan, AssistantPlanItem } from "./types/assistant";
import {
  FEATURE_TYPES,
  type CandidateFeature,
  type FeatureType,
  type FieldMapping,
  type ProjectDocument,
  type SketchMarkup,
  type SurveyPoint,
  type UploadPreview,
  type ValidationResult
} from "./types/project";

export type AiRecommendResponse = {
  plans: AssistantPlan[];
  source: "ai_text";
  fallback: boolean;
};

export type SketchAnalysisResponse = {
  observation?: string;
  observations: Array<{
    pointIds: string[];
    featureType: string;
    label: string;
    reason: string;
  }>;
  uncertainPoints: string[];
  generalDescription: string;
  rawText: string;
  visionRawParts: Array<{ label: string; text: string }>;
  structureRawText: string;
  success: boolean;
  error: string | null;
};

export type SketchImagePartPayload = {
  imageBase64: string;
  imageMime: string;
  label: string;
};

export async function uploadPoints(file: File): Promise<UploadPreview> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/upload/points", { method: "POST", body });
  return readJson(response);
}

export async function parsePoints(fileId: string, mapping: FieldMapping): Promise<{ points: SurveyPoint[]; validation: ValidationResult }> {
  const response = await fetch("/api/points/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, mapping })
  });
  return readJson(response);
}

export async function validateProject(project: ProjectDocument): Promise<ValidationResult> {
  const response = await fetch("/api/project/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project)
  });
  return readJson(response);
}

export async function exportProjectFile(project: ProjectDocument, kind: "dat" | "dxf"): Promise<Blob> {
  const response = await fetch(`/api/export/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project)
  });
  if (!response.ok) {
    const message = await safeError(response);
    throw new Error(message);
  }
  return response.blob();
}

export async function fetchAiRecommend(
  points: SurveyPoint[],
  candidates: CandidateFeature[],
  markups: SketchMarkup[],
  sketchObservation = "",
  sketchObservations: Array<{ pointIds: string[]; featureType: string; label: string; reason: string }> = []
): Promise<AiRecommendResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch("/api/assistant/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points, candidates, markups, sketch_observation: sketchObservation, sketch_observations: sketchObservations }),
      signal: controller.signal
    });
    if (!response.ok) return fallbackAiRecommend();
    const data = await response.json();
    return normalizeAiRecommendResponse(data);
  } catch {
    return fallbackAiRecommend();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchSketchAnalysis(
  imageBase64: string,
  imageMime: string,
  points: SurveyPoint[],
  imageParts: SketchImagePartPayload[] = []
): Promise<SketchAnalysisResponse> {
  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, 150000);
  try {
    const response = await fetch("/api/assistant/analyze-sketch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: imageBase64,
        image_mime: imageMime,
        image_parts: imageParts.map((part) => ({
          image_base64: part.imageBase64,
          image_mime: part.imageMime,
          label: part.label
        })),
        points
      }),
      signal: controller.signal
    });
    if (!response.ok) return fallbackSketchAnalysis("请求失败");
    const data = await response.json();
    return normalizeSketchAnalysisResponse(data);
  } catch {
    return fallbackSketchAnalysis(didTimeout ? "分析超时，请尝试压缩草图后重试" : "请求失败");
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await safeError(response);
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

async function safeError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data.detail || "请求失败";
  } catch {
    return "请求失败";
  }
}

function fallbackAiRecommend(): AiRecommendResponse {
  return { plans: [], source: "ai_text", fallback: true };
}

function fallbackSketchAnalysis(error: string): SketchAnalysisResponse {
  return { observation: "", observations: [], uncertainPoints: [], generalDescription: "", rawText: "", visionRawParts: [], structureRawText: "", success: false, error };
}

function normalizeSketchAnalysisResponse(data: unknown): SketchAnalysisResponse {
  if (!data || typeof data !== "object") return fallbackSketchAnalysis("请求失败");
  const value = data as {
    observations?: unknown;
    uncertainPoints?: unknown;
    generalDescription?: unknown;
    rawText?: unknown;
    success?: unknown;
    error?: unknown;
  };
  return {
    observations: Array.isArray(value.observations)
      ? value.observations.map(normalizeSketchObservation).filter((item): item is { pointIds: string[]; featureType: string; label: string; reason: string } => Boolean(item))
      : [],
    uncertainPoints: Array.isArray(value.uncertainPoints) ? value.uncertainPoints.map((pointId) => String(pointId)) : [],
    generalDescription: String(value.generalDescription || ""),
    rawText: String(value.rawText || ""),
    visionRawParts: Array.isArray((value as { visionRawParts?: unknown }).visionRawParts)
      ? ((value as { visionRawParts?: unknown }).visionRawParts as unknown[]).map(normalizeVisionRawPart).filter((item): item is { label: string; text: string } => Boolean(item))
      : [],
    structureRawText: String((value as { structureRawText?: unknown }).structureRawText || ""),
    observation: String(value.generalDescription || ""),
    success: Boolean(value.success),
    error: value.error == null ? null : String(value.error)
  };
}

function normalizeVisionRawPart(rawItem: unknown) {
  if (!rawItem || typeof rawItem !== "object") return null;
  const value = rawItem as Record<string, unknown>;
  return {
    label: String(value.label || ""),
    text: String(value.text || "")
  };
}

function normalizeSketchObservation(rawItem: unknown) {
  if (!rawItem || typeof rawItem !== "object") return null;
  const value = rawItem as Record<string, unknown>;
  return {
    pointIds: Array.isArray(value.pointIds) ? value.pointIds.map((pointId) => String(pointId)) : [],
    featureType: String(value.featureType || "unknown"),
    label: String(value.label || ""),
    reason: String(value.reason || "")
  };
}

function normalizeAiRecommendResponse(data: unknown): AiRecommendResponse {
  if (!data || typeof data !== "object") return fallbackAiRecommend();
  const value = data as { plans?: unknown; fallback?: unknown };
  const rawPlans = Array.isArray(value.plans) ? value.plans : [];
  return {
    plans: rawPlans.map(normalizeAiPlan).filter((plan): plan is AssistantPlan => Boolean(plan)),
    source: "ai_text",
    fallback: Boolean(value.fallback)
  };
}

function normalizeAiPlan(rawPlan: unknown, index: number): AssistantPlan | null {
  if (!rawPlan || typeof rawPlan !== "object") return null;
  const value = rawPlan as Record<string, unknown>;
  const rawItems = Array.isArray(value.items) ? value.items : [];
  const items = rawItems.map(normalizeAiPlanItem).filter((item): item is AssistantPlanItem => Boolean(item));
  if (!items.length) return null;

  return {
    id: String(value.id || `ai_plan_${Date.now()}_${index}`),
    title: String(value.title || `AI 推荐方案 ${index + 1}`),
    source: "ai_text",
    status: "pending",
    summary: String(value.summary || "DeepSeek 根据当前数据生成的推荐方案。"),
    items,
    confidence: clampConfidence(value.confidence, averageConfidence(items)),
    risks: stringList(value.risks),
    createdAt: String(value.createdAt || new Date().toISOString())
  };
}

function normalizeAiPlanItem(rawItem: unknown, index: number): AssistantPlanItem | null {
  if (!rawItem || typeof rawItem !== "object") return null;
  const value = rawItem as Record<string, unknown>;
  const pointIds = Array.isArray(value.pointIds) ? value.pointIds.map((pointId) => String(pointId)) : [];
  if (!pointIds.length) return null;

  const layer = String(value.layer || "");
  const type = normalizeAiFeatureType(String(value.type || ""), layer);
  const spec = FEATURE_TYPES[type];
  return {
    id: String(value.id || `ai_item_${Date.now()}_${index}`),
    type,
    name: String(value.name || `AI 推荐地物 ${index + 1}`),
    pointIds,
    closed: typeof value.closed === "boolean" ? value.closed : spec.closed,
    layer: layer || spec.layer,
    confidence: clampConfidence(value.confidence, 0.6),
    reason: String(value.reason || "DeepSeek 根据当前数据生成。"),
    risks: stringList(value.risks)
  };
}

function normalizeAiFeatureType(type: string, layer: string): FeatureType {
  if (isFeatureType(type)) return type;
  const layerText = layer.toUpperCase();

  if (type === "closed_polygon") {
    if (layerText.includes("GREEN")) return "green_area";
    if (layerText.includes("WATER")) return "pond";
    return "building";
  }
  if (type === "point_feature") {
    if (layerText.includes("MANHOLE")) return "manhole";
    return "tree";
  }
  if (type === "line") {
    if (layerText.includes("ROAD")) return "road_edge";
    if (layerText.includes("WALL")) return "wall";
    if (layerText.includes("STAIRS")) return "stairs";
  }
  return "line";
}

function isFeatureType(value: string): value is FeatureType {
  return value in FEATURE_TYPES;
}

function clampConfidence(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function averageConfidence(items: AssistantPlanItem[]): number {
  return items.length ? items.reduce((sum, item) => sum + item.confidence, 0) / items.length : 0;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}
