import { FEATURE_TYPES, type Feature, type FeatureType, type ProjectAttachment, type ProjectDocument, type ProjectMeta, type SketchAttachment, type SketchMarkup, type SketchMarkupGeometry, type SketchMarkupType, type SurveyPoint } from "../types/project";

export function normalizeImportedProject(raw: unknown): ProjectDocument {
  if (!isRecord(raw)) {
    throw new Error("JSON 根对象必须是项目对象。");
  }
  if (!isRecord(raw.project)) {
    throw new Error("JSON 缺少 project 字段。");
  }
  if (!Array.isArray(raw.points)) {
    throw new Error("JSON 缺少 points 数组。");
  }
  if (!Array.isArray(raw.features)) {
    throw new Error("JSON 缺少 features 数组。");
  }

  const project = normalizeProject(raw.project);
  const points = raw.points.map((point, index) => normalizePoint(point, index));
  const features = raw.features.map((feature, index) => normalizeFeature(feature, index));
  const attachments = Array.isArray(raw.attachments) ? raw.attachments.filter(isRecord).map(normalizeAttachment) : [];

  return { project, points, features, attachments };
}

function normalizeAttachment(raw: Record<string, unknown>): ProjectAttachment {
  if (raw.type === "sketch") {
    const attachment: SketchAttachment = {
      id: stringOrDefault(raw.id, `sketch_${Date.now()}`),
      type: "sketch",
      fileName: stringOrDefault(raw.fileName, "未命名草图"),
      mimeType: raw.mimeType === "image/png" ? "image/png" : "image/jpeg",
      size: numberOrDefault(raw.size, 0),
      createdAt: stringOrDefault(raw.createdAt, new Date().toISOString()),
      width: optionalNumber(raw.width),
      height: optionalNumber(raw.height),
      dataUrl: typeof raw.dataUrl === "string" ? raw.dataUrl : undefined,
      previewUrl: typeof raw.dataUrl === "string" ? raw.dataUrl : undefined,
      needsLocalFile: typeof raw.dataUrl !== "string",
      markups: Array.isArray(raw.markups) ? raw.markups.filter(isRecord).map((markup, index) => normalizeMarkup(markup, index, stringOrDefault(raw.id, "sketch"))) : []
    };
    return attachment;
  }
  return { ...raw };
}

function normalizeMarkup(raw: Record<string, unknown>, index: number, sketchAttachmentId: string): SketchMarkup {
  const type: SketchMarkupType = raw.type === "rect" || raw.type === "line" || raw.type === "point" ? raw.type : "rect";
  return {
    id: stringOrDefault(raw.id, `markup_${index + 1}`),
    sketchAttachmentId: stringOrDefault(raw.sketchAttachmentId, sketchAttachmentId),
    type,
    label: stringOrDefault(raw.label, `草图标注 ${index + 1}`),
    geometry: normalizeMarkupGeometryFromJson(raw.geometry, type),
    linkedPointIds: Array.isArray(raw.linkedPointIds) ? raw.linkedPointIds.map((pointId) => String(pointId).trim()).filter(Boolean) : [],
    linkedFeatureId: typeof raw.linkedFeatureId === "string" ? raw.linkedFeatureId : undefined,
    note: stringOrDefault(raw.note, "")
  };
}

function normalizeMarkupGeometryFromJson(raw: unknown, type: SketchMarkupType): SketchMarkupGeometry {
  if (type === "rect" && isRecord(raw)) {
    return {
      x: numberOrDefault(raw.x, 0),
      y: numberOrDefault(raw.y, 0),
      width: numberOrDefault(raw.width, 80),
      height: numberOrDefault(raw.height, 60)
    };
  }
  if (isRecord(raw) && Array.isArray(raw.points)) {
    return {
      points: raw.points.filter(isRecord).map((point) => ({
        x: numberOrDefault(point.x, 0),
        y: numberOrDefault(point.y, 0)
      }))
    };
  }
  return type === "rect" ? { x: 0, y: 0, width: 80, height: 60 } : { points: [{ x: 0, y: 0 }] };
}

function normalizeProject(raw: Record<string, unknown>): ProjectMeta {
  const id = stringOrDefault(raw.id, "cass_imported_project");
  const name = stringOrDefault(raw.name, "导入项目");
  const scale = numberOrDefault(raw.scale, 500);
  return {
    id,
    name,
    scale: [500, 1000, 2000].includes(scale) ? scale : 500,
    coordinateSystem: stringOrDefault(raw.coordinateSystem, "local"),
    createdAt: stringOrDefault(raw.createdAt, new Date().toISOString().slice(0, 10))
  };
}

function normalizePoint(raw: unknown, index: number): SurveyPoint {
  if (!isRecord(raw)) {
    throw new Error(`points[${index}] 必须是对象。`);
  }
  const id = requiredString(raw.id, `points[${index}].id`);
  const east = requiredNumber(raw.east, `points[${index}].east`);
  const north = requiredNumber(raw.north, `points[${index}].north`);
  return {
    id,
    east,
    north,
    height: nullableNumber(raw.height, `points[${index}].height`),
    note: stringOrDefault(raw.note, ""),
    code: stringOrDefault(raw.code, "")
  };
}

function normalizeFeature(raw: unknown, index: number): Feature {
  if (!isRecord(raw)) {
    throw new Error(`features[${index}] 必须是对象。`);
  }
  const id = requiredString(raw.id, `features[${index}].id`);
  const type = requiredString(raw.type, `features[${index}].type`) as FeatureType;
  if (!Array.isArray(raw.pointIds)) {
    throw new Error(`features[${index}].pointIds 必须是数组。`);
  }
  const pointIds = raw.pointIds.map((pointId, pointIndex) => requiredString(pointId, `features[${index}].pointIds[${pointIndex}]`));
  const spec = FEATURE_TYPES[type];
  return {
    id,
    type,
    name: stringOrDefault(raw.name, spec?.label || id),
    pointIds,
    closed: typeof raw.closed === "boolean" ? raw.closed : Boolean(spec?.closed),
    layer: stringOrDefault(raw.layer, spec?.layer || "DEFAULT"),
    note: stringOrDefault(raw.note, "")
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${label} 缺失或类型错误。`);
  }
  const text = String(value).trim();
  if (!text) {
    throw new Error(`${label} 不能为空。`);
  }
  return text;
}

function requiredNumber(value: unknown, label: string): number {
  const number = toNumber(value);
  if (number === null) {
    throw new Error(`${label} 缺失或不是数字。`);
  }
  return number;
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = toNumber(value);
  if (number === null) {
    throw new Error(`${label} 不是数字。`);
  }
  return number;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return toNumber(value) ?? fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return toNumber(value) ?? undefined;
}

function stringOrDefault(value: unknown, fallback: string): string {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text || fallback;
  }
  return fallback;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}
