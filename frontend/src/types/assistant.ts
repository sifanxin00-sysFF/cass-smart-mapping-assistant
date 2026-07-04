import type { FeatureType } from "./project";

export type AssistantStep =
  | "upload_points"
  | "map_fields"
  | "upload_sketch"
  | "generate_plans"
  | "review_accept"
  | "check_export";

export type AssistantPlanSource =
  | "local_point_sequence"
  | "local_note_code"
  | "local_sketch_markup"
  | "ai_text"
  | "ai_vision";

export type AssistantPlanStatus = "pending" | "selected" | "applied" | "rejected";

export type AssistantPlanItem = {
  id: string;
  type: FeatureType;
  name: string;
  pointIds: string[];
  closed: boolean;
  layer: string;
  confidence: number;
  reason: string;
  risks: string[];
  sourceCandidateIds?: string[];
  sourceMarkupIds?: string[];
};

export type AssistantPlan = {
  id: string;
  title: string;
  source: AssistantPlanSource;
  status: AssistantPlanStatus;
  summary: string;
  items: AssistantPlanItem[];
  confidence: number;
  risks: string[];
  createdAt: string;
};

export type AssistantMessage = {
  id: string;
  role: "system" | "assistant" | "user";
  content: string;
  level: "info" | "success" | "warning" | "error";
  createdAt: string;
  relatedPlanId?: string;
};

export type AssistantState = {
  currentStep: AssistantStep;
  plans: AssistantPlan[];
  selectedPlanId: string | null;
  messages: AssistantMessage[];
  isAnalyzing: boolean;
};
