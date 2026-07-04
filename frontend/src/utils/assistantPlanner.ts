import type {
  AssistantMessage,
  AssistantPlan,
  AssistantPlanItem,
  AssistantPlanSource,
  AssistantState,
  AssistantStep
} from "../types/assistant";
import type { CandidateFeature, SketchMarkup, SurveyPoint } from "../types/project";

type StepMessageContext = {
  pointCount?: number;
  featureCount?: number;
  planCount?: number;
};

type LocalPlanGroup = {
  source: AssistantPlanSource;
  title: string;
  candidates: CandidateFeature[];
};

export function buildLocalPlans(
  candidates: CandidateFeature[],
  markups: SketchMarkup[],
  points: SurveyPoint[]
): AssistantPlan[] {
  const createdAt = new Date().toISOString();
  const groups: LocalPlanGroup[] = [
    {
      source: "local_point_sequence",
      title: "连续点号推荐方案",
      candidates: candidates.filter((candidate) => candidate.source === "point_sequence")
    },
    {
      source: "local_note_code",
      title: "备注/编码推荐方案",
      candidates: candidates.filter((candidate) => candidate.source === "note" || candidate.source === "code")
    },
    {
      source: "local_sketch_markup",
      title: "草图标注推荐方案",
      candidates: candidates.filter((candidate) => candidate.source === "sketch_markup")
    }
  ];

  return groups
    .filter((group) => group.candidates.length > 0)
    .map((group, index) => {
      const items = group.candidates.map((candidate) => candidateToPlanItem(candidate, markups));
      return {
        id: `assistant_plan_${group.source}_${index + 1}`,
        title: group.title,
        source: group.source,
        status: "pending",
        summary: buildPlanSummary(group.source, items.length, points.length),
        items,
        confidence: averageConfidence(items),
        risks: [],
        createdAt
      };
    });
}

export function buildInitialAssistantState(): AssistantState {
  return {
    currentStep: "upload_points",
    plans: [],
    selectedPlanId: null,
    messages: [],
    isAnalyzing: false
  };
}

export function buildStepMessage(step: AssistantStep, context: StepMessageContext = {}): AssistantMessage {
  return {
    id: `assistant_message_${step}_${Date.now()}`,
    role: "system",
    content: stepMessageContent(step, context),
    level: "info",
    createdAt: new Date().toISOString()
  };
}

function candidateToPlanItem(candidate: CandidateFeature, markups: SketchMarkup[]): AssistantPlanItem {
  const sourceMarkupIds = findSourceMarkupIds(candidate, markups);
  return {
    id: `assistant_item_${candidate.id}`,
    type: candidate.type,
    name: candidate.name,
    pointIds: [...candidate.pointIds],
    closed: candidate.closed,
    layer: candidate.layer,
    confidence: candidate.confidence,
    reason: candidate.reason,
    risks: [],
    sourceCandidateIds: [candidate.id],
    ...(sourceMarkupIds.length ? { sourceMarkupIds } : {})
  };
}

function findSourceMarkupIds(candidate: CandidateFeature, markups: SketchMarkup[]) {
  if (candidate.source !== "sketch_markup") return [];
  return markups
    .filter((markup) => candidate.id.includes(markup.id) || samePointSequence(markup.linkedPointIds, candidate.pointIds))
    .map((markup) => markup.id);
}

function samePointSequence(left: string[], right: string[]) {
  return left.length === right.length && left.every((pointId, index) => pointId === right[index]);
}

function averageConfidence(items: AssistantPlanItem[]) {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + item.confidence, 0) / items.length;
}

function buildPlanSummary(source: AssistantPlanSource, itemCount: number, pointCount: number) {
  if (source === "local_point_sequence") {
    return `基于 ${pointCount} 个测点的连续点号，生成 ${itemCount} 个候选地物建议。`;
  }
  if (source === "local_note_code") {
    return `基于 ${pointCount} 个测点的备注/编码分组，生成 ${itemCount} 个候选地物建议。`;
  }
  if (source === "local_sketch_markup") {
    return `基于草图人工标注，生成 ${itemCount} 个候选地物建议。`;
  }
  return `生成 ${itemCount} 个候选地物建议。`;
}

function stepMessageContent(step: AssistantStep, context: StepMessageContext) {
  if (step === "upload_points") return "请上传测量点文件（CSV / XLSX / DAT）";
  if (step === "map_fields") return "请确认字段映射后点击展点";
  if (step === "upload_sketch") return "可上传草图辅助对照，也可跳过直接生成方案";
  if (step === "generate_plans") return `已展点 ${context.pointCount ?? 0} 个，点击生成推荐方案`;
  if (step === "review_accept") return `已生成 ${context.planCount ?? 0} 个方案，请选择一个方案审查采纳`;
  return `已采纳 ${context.featureCount ?? 0} 个地物，请先运行错误检查再导出`;
}
