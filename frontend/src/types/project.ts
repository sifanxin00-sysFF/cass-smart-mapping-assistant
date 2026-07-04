export type SurveyPoint = {
  id: string;
  east: number;
  north: number;
  height: number | null;
  note: string;
  code: string;
};

export type FeatureType =
  | "building"
  | "road_edge"
  | "green_area"
  | "pond"
  | "stairs"
  | "wall"
  | "tree"
  | "manhole"
  | "line";

export type Feature = {
  id: string;
  type: FeatureType;
  name: string;
  pointIds: string[];
  closed: boolean;
  layer: string;
  note: string;
};

export type CandidateFeature = {
  id: string;
  source: "point_sequence" | "note" | "code" | "sketch_markup";
  status: CandidateStatus;
  type: FeatureType;
  name: string;
  pointIds: string[];
  closed: boolean;
  layer: string;
  confidence: number;
  reason: string;
  acceptedFeatureId?: string;
};

export type CandidateStatus = "pending" | "accepted" | "ignored";

export type ProjectMeta = {
  id: string;
  name: string;
  scale: number;
  coordinateSystem: string;
  createdAt: string;
};

export type ProjectDocument = {
  project: ProjectMeta;
  points: SurveyPoint[];
  features: Feature[];
  attachments: ProjectAttachment[];
};

export type ProjectAttachment = SketchAttachment | Record<string, unknown>;

export type SketchAttachment = {
  id: string;
  type: "sketch";
  fileName: string;
  mimeType: "image/png" | "image/jpeg";
  size: number;
  createdAt: string;
  width?: number;
  height?: number;
  dataUrl?: string;
  previewUrl?: string;
  needsLocalFile?: boolean;
  markups?: SketchMarkup[];
};

export type SketchMarkupType = "rect" | "line" | "point";

export type SketchMarkupGeometry =
  | { x: number; y: number; width: number; height: number }
  | { points: { x: number; y: number }[] };

export type SketchMarkup = {
  id: string;
  sketchAttachmentId: string;
  type: SketchMarkupType;
  label: string;
  geometry: SketchMarkupGeometry;
  linkedPointIds: string[];
  linkedFeatureId?: string;
  note: string;
};

export type FieldMapping = {
  pointId: string;
  east: string;
  north: string;
  height?: string;
  note?: string;
  code?: string;
};

export type UploadPreview = {
  fileId: string;
  columns: string[];
  previewRows: Record<string, string>[];
  detectedMapping: Partial<Record<keyof FieldMapping, string | null>>;
};

export type ValidationIssue = {
  type: string;
  message: string;
  pointId?: string | null;
  featureId?: string | null;
  severity: "error" | "warning";
};

export type ValidationResult = {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type CheckState = "idle" | "passed" | "issues" | "error";

export type FeatureSpec = {
  label: string;
  layer: string;
  closed: boolean;
  point?: boolean;
};

export const FEATURE_TYPES: Record<FeatureType, FeatureSpec> = {
  building: { label: "建筑物", layer: "BUILDING", closed: true },
  road_edge: { label: "道路边线", layer: "ROAD", closed: false },
  green_area: { label: "绿化带", layer: "GREEN", closed: true },
  pond: { label: "水池", layer: "WATER", closed: true },
  stairs: { label: "台阶", layer: "STAIRS", closed: false },
  wall: { label: "围墙", layer: "WALL", closed: false },
  tree: { label: "独立树", layer: "TREE", closed: false, point: true },
  manhole: { label: "井盖", layer: "MANHOLE", closed: false, point: true },
  line: { label: "普通线", layer: "DEFAULT", closed: false }
};
