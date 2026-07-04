import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, WheelEvent } from "react";
import { exportProjectFile, fetchAiRecommend, fetchSketchAnalysis, parsePoints, uploadPoints, validateProject, type SketchImagePartPayload } from "./api";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  pointInRect,
  projectPoints,
  svgPoint,
  type ScreenPoint,
  type ViewState
} from "./utils/geometry";
import { generateCandidateFeatures } from "./utils/candidateFeature";
import {
  candidateStatusLabel,
  candidateTypeLabel,
  defaultCandidateFilters,
  filterCandidates,
  summarizeCandidates,
  type CandidateFilters
} from "./utils/candidateFilters";
import { CONTROLLED_LAYERS, defaultLayerVisibility, isFeatureVisible, type LayerVisibility } from "./utils/layerVisibility";
import { resolvePointSelectionInput } from "./utils/pointSelection";
import { normalizeImportedProject } from "./utils/projectImport";
import { buildInitialAssistantState, buildLocalPlans, buildStepMessage } from "./utils/assistantPlanner";
import {
  createSketchAttachment,
  defaultSketchView,
  isSketchAttachment,
  normalizeSketchAttachments,
  sanitizeAttachmentsForExport,
  sketchSizeText,
  type SketchViewState
} from "./utils/sketchAttachment";
import {
  createSketchMarkup,
  markupToCandidate,
  markupTypeLabel,
  normalizeMarkupGeometry,
  type SketchMarkupMode
} from "./utils/sketchMarkup";
import {
  FEATURE_TYPES,
  type CandidateFeature,
  type CandidateStatus,
  type CheckState,
  type Feature,
  type FeatureType,
  type FieldMapping,
  type ProjectAttachment,
  type ProjectDocument,
  type ProjectMeta,
  type SketchAttachment,
  type SketchMarkup,
  type SketchMarkupGeometry,
  type SketchMarkupType,
  type SurveyPoint,
  type UploadPreview,
  type ValidationResult
} from "./types/project";
import type { AssistantPlan, AssistantPlanItem, AssistantState, AssistantStep } from "./types/assistant";

type ToolMode = "select" | "box" | "pan";
type LeftPanelTab = "project" | "data" | "sketch";
type RightPanelTab = "candidates" | "check" | "features";
type BoxRect = { x: number; y: number; width: number; height: number };
type CandidateEditDraft = {
  candidateId: string;
  type: FeatureType;
  name: string;
  pointInput: string;
  closed: boolean;
  message: string;
};

type SketchObservationFeatureType = "building" | "road_edge" | "wall" | "green_area" | "water" | "stairs" | "tree" | "manhole" | "unknown";

type ObservationItem = {
  id: string;
  pointIds: string[];
  featureType: SketchObservationFeatureType;
  label: string;
  reason: string;
  confirmed: boolean;
  edited: boolean;
};

type EditSnapshot = {
  features: Feature[];
  candidateFeatures: CandidateFeature[];
  selectedIds: string[];
  selectedCandidateIds: string[];
  candidateDraft: CandidateEditDraft | null;
  hoveredCandidateId: string | null;
  activeCandidateId: string | null;
  checkState: CheckState;
  validation: ValidationResult;
};

const emptyValidation: ValidationResult = { errors: [], warnings: [] };
const featureOrder = Object.keys(FEATURE_TYPES) as FeatureType[];
const candidateEditableTypes: FeatureType[] = ["line", "road_edge", "wall", "stairs", "building", "green_area", "pond", "tree", "manhole"];
const sketchObservationTypes: SketchObservationFeatureType[] = ["building", "road_edge", "wall", "green_area", "water", "stairs", "tree", "manhole", "unknown"];
const sketchObservationTypeLabels: Record<SketchObservationFeatureType, string> = {
  building: "建筑物",
  road_edge: "道路边线",
  wall: "围墙",
  green_area: "绿化带",
  water: "水池",
  stairs: "台阶",
  tree: "独立树",
  manhole: "井盖",
  unknown: "未知"
};
const emptyMapping: FieldMapping = { pointId: "", east: "", north: "", height: "", note: "", code: "" };
const defaultView: ViewState = { zoom: 1, panX: 0, panY: 0 };

export default function App() {
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const [project, setProject] = useState<ProjectMeta>({
    id: "cass_mvp_project",
    name: "CASS 智能成图助手 MVP",
    scale: 500,
    coordinateSystem: "local",
    createdAt: new Date().toISOString().slice(0, 10)
  });
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>(emptyMapping);
  const [points, setPoints] = useState<SurveyPoint[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [attachments, setAttachments] = useState<ProjectAttachment[]>([]);
  const [candidateFeatures, setCandidateFeatures] = useState<CandidateFeature[]>([]);
  const [candidateFilters, setCandidateFilters] = useState<CandidateFilters>(defaultCandidateFilters);
  const [candidateDraft, setCandidateDraft] = useState<CandidateEditDraft | null>(null);
  const [hoveredCandidateId, setHoveredCandidateId] = useState<string | null>(null);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>(defaultLayerVisibility);
  const [sketchPanelVisible, setSketchPanelVisible] = useState(true);
  const [sketchView, setSketchView] = useState<SketchViewState>(defaultSketchView);
  const [sketchDrag, setSketchDrag] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [sketchMarkupMode, setSketchMarkupMode] = useState<SketchMarkupMode>("select");
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null);
  const [markupDraft, setMarkupDraft] = useState<{ type: SketchMarkupType; start: { x: number; y: number }; current: { x: number; y: number } } | null>(null);
  const [markupPointInput, setMarkupPointInput] = useState("");
  const [markupMessage, setMarkupMessage] = useState("");
  const [sketchObservations, setSketchObservations] = useState<ObservationItem[]>([]);
  const [sketchUncertainPoints, setSketchUncertainPoints] = useState<string[]>([]);
  const [sketchGeneralDescription, setSketchGeneralDescription] = useState("");
  const [sketchAnalyzed, setSketchAnalyzed] = useState(false);
  const [sketchAnalysisMessage, setSketchAnalysisMessage] = useState("");
  const [undoStack, setUndoStack] = useState<EditSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditSnapshot[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pointInput, setPointInput] = useState("");
  const [pointInputMessage, setPointInputMessage] = useState("");
  const [featureType, setFeatureType] = useState<FeatureType>("line");
  const [featureName, setFeatureName] = useState("");
  const [showLabels, setShowLabels] = useState(true);
  const [showHeights, setShowHeights] = useState(false);
  const [mode, setMode] = useState<ToolMode>("select");
  const [view, setView] = useState<ViewState>(defaultView);
  const [drag, setDrag] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [box, setBox] = useState<BoxRect | null>(null);
  const [validation, setValidation] = useState<ValidationResult>(emptyValidation);
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [status, setStatus] = useState("上传 CSV / XLSX / DAT 后确认字段映射，即可在 SVG 画布中展点。");
  const [assistantState, setAssistantState] = useState<AssistantState>(() => buildInitialAssistantState());
  const [busy, setBusy] = useState(false);
  const [leftPanelTab, setLeftPanelTab] = useState<LeftPanelTab>("data");
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("candidates");

  const screenPoints = useMemo(() => projectPoints(points, CANVAS_WIDTH, CANVAS_HEIGHT, view), [points, view]);
  const pointMap = useMemo(() => new Map(screenPoints.map((point) => [point.id, point])), [screenPoints]);
  const availablePointIds = useMemo(() => points.map((point) => point.id), [points]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedCandidateSet = useMemo(() => new Set(selectedCandidateIds), [selectedCandidateIds]);
  const candidateStats = useMemo(() => summarizeCandidates(candidateFeatures), [candidateFeatures]);
  const filteredCandidates = useMemo(() => filterCandidates(candidateFeatures, candidateFilters), [candidateFeatures, candidateFilters]);
  const visibleFeatures = useMemo(() => features.filter((feature) => isFeatureVisible(feature, layerVisibility)), [features, layerVisibility]);
  const activeSketch = useMemo(() => latestSketchAttachment(attachments), [attachments]);
  const activeSketchMarkups = activeSketch?.markups || [];
  const selectedMarkup = useMemo(
    () => activeSketchMarkups.find((markup) => markup.id === selectedMarkupId) || null,
    [activeSketchMarkups, selectedMarkupId]
  );
  const highlightedCandidate = useMemo(
    () => candidateFeatures.find((candidate) => candidate.id === (activeCandidateId || hoveredCandidateId) && candidate.status === "pending") || null,
    [activeCandidateId, candidateFeatures, hoveredCandidateId]
  );
  const projectDocument: ProjectDocument = useMemo(
    () => ({ project, points, features, attachments: sanitizeAttachmentsForExport(attachments) }),
    [attachments, project, points, features]
  );
  const mappingReady = Boolean(preview && mapping.pointId && mapping.east && mapping.north);
  const currentFeature = FEATURE_TYPES[featureType];
  const checkSummary = getCheckSummary(checkState, validation);
  const exportSummary = getExportSummary(points.length, features.length, checkState, validation);
  const workflowStep = getWorkflowStep(Boolean(preview), points.length, features.length, checkState);
  const assistantStepMessage = useMemo(
    () =>
      buildStepMessage(assistantState.currentStep, {
        pointCount: points.length,
        featureCount: features.length,
        planCount: assistantState.plans.length
      }),
    [assistantState.currentStep, assistantState.plans.length, features.length, points.length]
  );

  useEffect(() => {
    const nextStep = getAssistantStep(Boolean(preview), points.length, features.length);
    setAssistantState((current) => (current.currentStep === nextStep ? current : { ...current, currentStep: nextStep }));
  }, [features.length, points.length, preview]);

  useEffect(() => {
    setSketchObservations([]);
    setSketchUncertainPoints([]);
    setSketchGeneralDescription("");
    setSketchAnalyzed(false);
    setSketchAnalysisMessage("");
  }, [activeSketch?.id]);

  function currentSnapshot(): EditSnapshot {
    return {
      features: cloneFeatures(features),
      candidateFeatures: cloneCandidates(candidateFeatures),
      selectedIds: [...selectedIds],
      selectedCandidateIds: [...selectedCandidateIds],
      candidateDraft: candidateDraft ? { ...candidateDraft } : null,
      hoveredCandidateId,
      activeCandidateId,
      checkState,
      validation: cloneValidation(validation)
    };
  }

  function rememberEdit() {
    const snapshot = currentSnapshot();
    setUndoStack((current) => [...current, snapshot].slice(-60));
    setRedoStack([]);
  }

  function restoreSnapshot(snapshot: EditSnapshot) {
    setFeatures(cloneFeatures(snapshot.features));
    setCandidateFeatures(cloneCandidates(snapshot.candidateFeatures));
    setSelectedIds([...snapshot.selectedIds]);
    setSelectedCandidateIds([...snapshot.selectedCandidateIds]);
    setCandidateDraft(snapshot.candidateDraft ? { ...snapshot.candidateDraft } : null);
    setHoveredCandidateId(snapshot.hoveredCandidateId);
    setActiveCandidateId(snapshot.activeCandidateId);
    setCheckState(snapshot.checkState);
    setValidation(cloneValidation(snapshot.validation));
  }

  function clearEditHistory() {
    setUndoStack([]);
    setRedoStack([]);
  }

  function handleUndo() {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, currentSnapshot()].slice(-60));
    restoreSnapshot(previous);
    setStatus("已撤销上一步编辑。");
  }

  function handleRedo() {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current, currentSnapshot()].slice(-60));
    restoreSnapshot(next);
    setStatus("已重做上一步编辑。");
  }

  async function handleSketchUpload(file: File | null) {
    if (!file) return;
    setStatus("正在读取草图...");
    try {
      const result = await createSketchAttachment(file);
      setAttachments((current) => [...current.filter((attachment) => !isSketchAttachment(attachment)), result.attachment]);
      setSelectedMarkupId(null);
      setMarkupPointInput("");
      setMarkupMessage("");
      setSketchPanelVisible(true);
      setSketchView(defaultSketchView);
      setStatus(result.message);
    } catch (error) {
      setStatus(errorMessage(error, "草图读取失败"));
    }
  }

  function resetSketchView() {
    setSketchView(defaultSketchView);
    setStatus("已重置草图视图。");
  }

  function zoomSketch(factor: number) {
    setSketchView((current) => ({
      ...current,
      zoom: Math.min(6, Math.max(0.25, Number((current.zoom * factor).toFixed(2))))
    }));
  }

  function onSketchPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!activeSketch?.previewUrl) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSketchDrag({ x: event.clientX, y: event.clientY, panX: sketchView.panX, panY: sketchView.panY });
  }

  function onSketchPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!sketchDrag) return;
    setSketchView((current) => ({
      ...current,
      panX: sketchDrag.panX + event.clientX - sketchDrag.x,
      panY: sketchDrag.panY + event.clientY - sketchDrag.y
    }));
  }

  function onSketchPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setSketchDrag(null);
  }

  function updateActiveSketchMarkups(updater: (markups: SketchMarkup[]) => SketchMarkup[]) {
    if (!activeSketch) return;
    setAttachments((current) =>
      current.map((attachment) => {
        if (!isSketchAttachment(attachment) || attachment.id !== activeSketch.id) return attachment;
        return { ...attachment, markups: updater(attachment.markups || []) };
      })
    );
  }

  function updateSelectedMarkup(patch: Partial<SketchMarkup>) {
    if (!selectedMarkup) return;
    updateActiveSketchMarkups((markups) =>
      markups.map((markup) => (markup.id === selectedMarkup.id ? { ...markup, ...patch } : markup))
    );
  }

  function deleteSelectedMarkup() {
    if (!selectedMarkup) return;
    updateActiveSketchMarkups((markups) => markups.filter((markup) => markup.id !== selectedMarkup.id));
    setSelectedMarkupId(null);
    setMarkupPointInput("");
    setMarkupMessage("已删除草图标注。");
  }

  function bindMarkupPoints() {
    if (!selectedMarkup) {
      setMarkupMessage("请先选择一个草图标注。");
      return;
    }
    const result = resolvePointSelectionInput(markupPointInput, availablePointIds);
    if (result.error) {
      setMarkupMessage(result.error);
      return;
    }
    if (result.missingIds.length) {
      setMarkupMessage(`点号 ${result.missingIds.join("、")} 不存在，未绑定。`);
      return;
    }
    updateSelectedMarkup({ linkedPointIds: result.pointIds });
    setMarkupMessage(`已绑定点号：${result.pointIds.join("、")}。`);
  }

  function bindMarkupFeature(featureId: string) {
    if (!selectedMarkup) return;
    updateSelectedMarkup({ linkedFeatureId: featureId || undefined });
    setMarkupMessage(featureId ? "已绑定正式地物。" : "已解除地物绑定。");
  }

  function generateCandidateFromSelectedMarkup() {
    if (!selectedMarkup) {
      setMarkupMessage("请先选择一个草图标注。");
      return;
    }
    const result = markupToCandidate(selectedMarkup, candidateFeatures.length + 1, features);
    if (!result.candidate) {
      setMarkupMessage(result.error || "无法从该标注生成候选。");
      return;
    }
    rememberEdit();
    setCandidateFeatures((current) => [...current, result.candidate as CandidateFeature]);
    setCandidateFilters(defaultCandidateFilters);
    setActiveCandidateId(result.candidate.id);
    setMarkupMessage(`已从草图标注生成候选：${result.candidate.name}。候选仍需人工采纳。`);
    setStatus(`已从草图标注生成候选：${result.candidate.name}。`);
  }

  function sketchClientToLocal(clientX: number, clientY: number, viewer: HTMLDivElement, sketch: SketchAttachment) {
    const rect = viewer.getBoundingClientRect();
    const width = sketch.width || 1;
    const height = sketch.height || 1;
    return {
      x: clampNumber((clientX - rect.left - rect.width / 2 - sketchView.panX) / sketchView.zoom + width / 2, 0, width),
      y: clampNumber((clientY - rect.top - rect.height / 2 - sketchView.panY) / sketchView.zoom + height / 2, 0, height)
    };
  }

  function onSketchMarkupPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!activeSketch || sketchMarkupMode === "select") return;
    event.stopPropagation();
    const point = sketchClientToLocal(event.clientX, event.clientY, event.currentTarget, activeSketch);
    if (sketchMarkupMode === "point") {
      const nextMarkup = createSketchMarkup(activeSketch.id, "point", normalizeMarkupGeometry("point", point, point), activeSketchMarkups.length + 1);
      updateActiveSketchMarkups((markups) => [...markups, nextMarkup]);
      setSelectedMarkupId(nextMarkup.id);
      setMarkupPointInput("");
      setMarkupMessage("已添加点标注。");
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setMarkupDraft({ type: sketchMarkupMode, start: point, current: point });
  }

  function onSketchMarkupPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!activeSketch || !markupDraft) return;
    event.stopPropagation();
    const point = sketchClientToLocal(event.clientX, event.clientY, event.currentTarget, activeSketch);
    setMarkupDraft((current) =>
      current ? { ...current, current: point } : current
    );
  }

  function onSketchMarkupPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!activeSketch || !markupDraft) return;
    event.stopPropagation();
    const end = sketchClientToLocal(event.clientX, event.clientY, event.currentTarget, activeSketch);
    const geometry = normalizeMarkupGeometry(markupDraft.type, markupDraft.start, end);
    if (isUsableMarkupGeometry(markupDraft.type, geometry)) {
      const nextMarkup = createSketchMarkup(activeSketch.id, markupDraft.type, geometry, activeSketchMarkups.length + 1);
      updateActiveSketchMarkups((markups) => [...markups, nextMarkup]);
      setSelectedMarkupId(nextMarkup.id);
      setMarkupPointInput("");
      setMarkupMessage(`已添加${markupTypeLabel(markupDraft.type)}标注。`);
    } else {
      setMarkupMessage("标注太小，已忽略。");
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setMarkupDraft(null);
  }

  async function handleUpload(file: File | null) {
    if (!file) return;
    setBusy(true);
    setStatus("正在上传并解析文件表头...");
    try {
      const result = await uploadPoints(file);
      setPreview(result);
      setMapping({
        pointId: result.detectedMapping.pointId || "",
        east: result.detectedMapping.east || "",
        north: result.detectedMapping.north || "",
        height: result.detectedMapping.height || "",
        note: result.detectedMapping.note || "",
        code: result.detectedMapping.code || ""
      });
      setSelectedIds([]);
      setCandidateFeatures([]);
      setCandidateFilters(defaultCandidateFilters);
      setCandidateDraft(null);
      setHoveredCandidateId(null);
      setActiveCandidateId(null);
      setSelectedCandidateIds([]);
      clearEditHistory();
      setPointInput("");
      setPointInputMessage("");
      setCheckState("idle");
      setValidation(emptyValidation);
      setStatus(`已读取 ${file.name}，请确认字段映射后展点。`);
    } catch (error) {
      setStatus(errorMessage(error, "文件解析失败"));
    } finally {
      setBusy(false);
    }
  }

  async function handleParsePoints() {
    if (!preview || !mappingReady) return;
    setBusy(true);
    setStatus("正在按映射生成标准 points...");
    try {
      const result = await parsePoints(preview.fileId, mapping);
      setPoints(result.points);
      setFeatures([]);
      setCandidateFeatures([]);
      setCandidateFilters(defaultCandidateFilters);
      setCandidateDraft(null);
      setHoveredCandidateId(null);
      setActiveCandidateId(null);
      setSelectedCandidateIds([]);
      clearEditHistory();
      setSelectedIds([]);
      setPointInput("");
      setPointInputMessage("");
      setValidation(result.validation);
      setCheckState(checkStateFromValidation(result.validation));
      setView(defaultView);
      setStatus(`已展点 ${result.points.length} 个。`);
    } catch (error) {
      setStatus(errorMessage(error, "生成点数据失败"));
    } finally {
      setBusy(false);
    }
  }

  function togglePoint(pointId: string) {
    setSelectedIds((current) => (current.includes(pointId) ? current.filter((id) => id !== pointId) : [...current, pointId]));
  }

  function resolvePointInput() {
    if (!points.length) {
      return { pointIds: [], missingIds: [], error: "请先导入并展点。" };
    }
    return resolvePointSelectionInput(pointInput, points.map((point) => point.id));
  }

  function handleSelectByPointInput() {
    const result = resolvePointInput();
    if (result.error) {
      setPointInputMessage(result.error);
      setStatus(result.error);
      return;
    }

    setSelectedIds(result.pointIds);
    if (result.missingIds.length) {
      const message = `已按顺序选中 ${result.pointIds.length} 个点；点号 ${result.missingIds.join("、")} 不存在。`;
      setPointInputMessage(message);
      setStatus(message);
      return;
    }

    const message = `已按点号顺序选中 ${result.pointIds.length} 个点。`;
    setPointInputMessage(message);
    setStatus(message);
  }

  function createFeatureByPointInput(mode: "line" | "area") {
    const result = resolvePointInput();
    if (result.error) {
      setPointInputMessage(result.error);
      setStatus(result.error);
      return;
    }
    if (result.missingIds.length) {
      const message = `点号 ${result.missingIds.join("、")} 不存在，未生成地物。`;
      setPointInputMessage(message);
      setStatus(message);
      return;
    }

    const spec = FEATURE_TYPES[featureType];
    if (mode === "line" && (spec.point || spec.closed)) {
      const message = "请先在地物类型中选择普通线、道路边线、台阶或围墙等线状地物。";
      setPointInputMessage(message);
      setStatus(message);
      return;
    }
    if (mode === "area" && (spec.point || !spec.closed)) {
      const message = "请先在地物类型中选择建筑物、绿化带或水池等面状地物。";
      setPointInputMessage(message);
      setStatus(message);
      return;
    }

    if (mode === "line" && result.pointIds.length < 2) {
      const message = "按点号成线至少需要 2 个点。";
      setPointInputMessage(message);
      setStatus(message);
      return;
    }
    if (mode === "area" && result.pointIds.length < 3) {
      const message = "按点号闭合成面至少需要 3 个点。";
      setPointInputMessage(message);
      setStatus(message);
      return;
    }

    const pointIds = mode === "area" && result.pointIds[0] !== result.pointIds[result.pointIds.length - 1]
      ? [...result.pointIds, result.pointIds[0]]
      : result.pointIds;
    addFeature(featureType, pointIds, mode === "area");
    const message = `已按点号顺序生成${mode === "area" ? "闭合面" : "线"}：${pointIds.join(" -> ")}。`;
    setPointInputMessage(message);
    setStatus(message);
  }

  function createFeature(typeOverride?: FeatureType) {
    const nextType = typeOverride || featureType;
    const spec = FEATURE_TYPES[nextType];
    const uniqueIds = Array.from(new Set(selectedIds));

    if (!uniqueIds.length) {
      setStatus("请先在画布中选择点。");
      return;
    }

    if (spec.point) {
      addFeature(nextType, [uniqueIds[0]], spec.closed);
      return;
    }

    if (spec.closed && uniqueIds.length < 3) {
      setStatus("闭合面至少需要 3 个不同点。");
      return;
    }

    if (!spec.closed && uniqueIds.length < 2) {
      setStatus("线状地物至少需要 2 个点。");
      return;
    }

    const pointIds = spec.closed && uniqueIds[0] !== uniqueIds[uniqueIds.length - 1] ? [...uniqueIds, uniqueIds[0]] : uniqueIds;
    addFeature(nextType, pointIds, spec.closed);
  }

  function addFeature(nextType: FeatureType, pointIds: string[], closed: boolean) {
    const spec = FEATURE_TYPES[nextType];
    const nextFeature: Feature = {
      id: `feature_${Date.now()}_${features.length + 1}`,
      type: nextType,
      name: featureName.trim() || spec.label,
      pointIds,
      closed,
      layer: spec.layer,
      note: ""
    };
    rememberEdit();
    setFeatures((current) => [...current, nextFeature]);
    setSelectedIds([]);
    setFeatureName("");
    setCheckState("idle");
    setValidation(emptyValidation);
    setStatus(`已生成地物：${nextFeature.name}。`);
  }

  function deleteFeature(featureId: string) {
    rememberEdit();
    setFeatures((current) => current.filter((feature) => feature.id !== featureId));
    setCheckState("idle");
    setValidation(emptyValidation);
    setStatus("已删除地物。");
  }

  function handleGenerateCandidates() {
    if (!points.length) {
      setStatus("请先导入并展点，再生成候选推荐。");
      return;
    }

    const nextCandidates = generateCandidateFeatures(points);
    setRedoStack([]);
    setCandidateFeatures(nextCandidates);
    setCandidateFilters(defaultCandidateFilters);
    setCandidateDraft(null);
    setHoveredCandidateId(null);
    setActiveCandidateId(null);
    setSelectedCandidateIds([]);
    setStatus(
      nextCandidates.length
        ? `已生成 ${nextCandidates.length} 个候选推荐。候选需人工采纳后才会进入正式地物和导出。`
        : "未发现满足条件的候选。连续数字点号少于 4 个不会推荐。"
    );
  }

  async function handleAnalyzeSketch() {
    const sketchDataUrl = activeSketch?.dataUrl || activeSketch?.previewUrl;
    if (!sketchDataUrl) {
      setSketchAnalysisMessage("当前没有可分析的草图。");
      setStatus("当前没有可分析的草图。");
      return;
    }
    setSketchAnalysisMessage("正在准备草图分区...");
    setStatus("正在准备草图分区...");
    const sketchPayloads = await compressedSketchImagePartsFromDataUrl(sketchDataUrl, activeSketch.mimeType, (message) => {
      setSketchAnalysisMessage(message);
      setStatus(message);
    });
    if (!sketchPayloads.length) {
      setSketchAnalysisMessage("草图数据不可读取，请重新上传草图。");
      setStatus("草图数据不可读取，请重新上传草图。");
      return;
    }

    setAssistantState((current) => ({ ...current, isAnalyzing: true }));
    const partLabels = sketchPayloads.map((part) => part.label).join("、");
    const analyzingMessage = sketchPayloads.length > 1 ? `AI 正在分区域观察草图：${partLabels}...` : "AI 正在观察草图...";
    setSketchAnalysisMessage(analyzingMessage);
    setStatus(analyzingMessage);
    const firstPayload = sketchPayloads[0];
    const result = await fetchSketchAnalysis(
      firstPayload.imageBase64,
      firstPayload.imageMime,
      points,
      sketchPayloads.length > 1 ? sketchPayloads : []
    );
    setAssistantState((current) => ({ ...current, isAnalyzing: false }));

    if (!result.success) {
      setSketchAnalyzed(false);
      setSketchObservations([]);
      setSketchUncertainPoints([]);
      setSketchGeneralDescription("");
      setSketchAnalysisMessage(result.error || "草图分析失败。");
      setStatus(result.error || "草图分析失败。");
      return;
    }

    const nextObservations = result.observations.map((observation, index) => normalizeObservationItem(observation, index));
    setSketchObservations(nextObservations);
    setSketchUncertainPoints(result.uncertainPoints);
    setSketchGeneralDescription(result.generalDescription);
    setSketchAnalyzed(true);
    setSketchAnalysisMessage(
      nextObservations.length
        ? `已识别 ${nextObservations.length} 条草图观察，请确认后生成方案。`
        : "草图已分析，但没有识别到明确点号观察。仍可继续生成方案。"
    );
    setStatus(
      nextObservations.length
        ? `已识别 ${nextObservations.length} 条草图观察，请确认后生成方案。`
        : "草图已分析，但没有识别到明确点号观察。"
    );
  }

  function confirmSketchObservation(observationId: string) {
    setSketchObservations((current) =>
      ensureObservationItems(current).map((observation) => (observation.id === observationId ? { ...observation, confirmed: true } : observation))
    );
  }

  function deleteSketchObservation(observationId: string) {
    setSketchObservations((current) => ensureObservationItems(current).filter((observation) => observation.id !== observationId));
  }

  function updateSketchObservationPointIds(observationId: string, value: string) {
    setSketchObservations((current) =>
      ensureObservationItems(current).map((observation) =>
        observation.id === observationId
          ? { ...observation, pointIds: parsePointList(value), confirmed: false, edited: true }
          : observation
      )
    );
  }

  function updateSketchObservationType(observationId: string, value: SketchObservationFeatureType) {
    setSketchObservations((current) =>
      ensureObservationItems(current).map((observation) =>
        observation.id === observationId
          ? { ...observation, featureType: value, label: sketchObservationTypeLabels[value], confirmed: false, edited: true }
          : observation
      )
    );
  }

  async function confirmAllSketchObservationsAndGenerate() {
    const confirmed = ensureObservationItems(sketchObservations).map((observation) => ({ ...observation, confirmed: true }));
    setSketchObservations(confirmed);
    await handleGenerateAssistantPlans(confirmed);
  }

  async function handleGenerateAssistantPlans(observationOverride?: ObservationItem[]) {
    if (assistantState.isAnalyzing) return;
    if (activeSketch?.dataUrl && !sketchAnalyzed) {
      setSketchAnalysisMessage("请先分析草图并确认观察结果，再生成推荐方案。");
      setStatus("请先分析草图并确认观察结果，再生成推荐方案。");
      return;
    }
    const pendingCandidates = candidateFeatures.filter((candidate) => candidate.status === "pending");
    setAssistantState((current) => ({ ...current, isAnalyzing: true }));
    setStatus("助手正在分析当前测点、候选和草图标注...");

    let sketchObservation = "";
    const sketchPayload = null as { imageBase64: string; imageMime: string } | null;
    if (sketchPayload) {
      setStatus("助手正在分析草图观察结果...");
      const sketchResult = await fetchSketchAnalysis(sketchPayload.imageBase64, sketchPayload.imageMime, points);
      sketchObservation = sketchResult.success ? sketchResult.observation || "" : "";
      setStatus(
        sketchResult.success
          ? "草图观察已完成，正在生成推荐方案..."
          : `草图视觉分析不可用，继续使用测点和候选生成方案：${sketchResult.error || "请求失败"}`
      );
    }

    const observationSource = Array.isArray(observationOverride)
      ? observationOverride
      : Array.isArray(sketchObservations)
      ? sketchObservations
      : [];
    const confirmedObservations = observationSource
      .filter((observation) => observation.confirmed)
      .map((observation) => ({
        pointIds: observation.pointIds,
        featureType: observation.featureType,
        label: observation.label,
        reason: observation.reason
      }));
    const aiResult = await fetchAiRecommend(points, pendingCandidates, activeSketchMarkups, sketchObservation, confirmedObservations);
    const plans = !aiResult.fallback && aiResult.plans.length
      ? aiResult.plans
      : buildLocalPlans(pendingCandidates, activeSketchMarkups, points);
    setAssistantState((current) => ({
      ...current,
      plans,
      selectedPlanId: plans[0]?.id ?? null,
      isAnalyzing: false
    }));
    if (!aiResult.fallback && aiResult.plans.length) {
      setStatus(`助手已生成 ${plans.length} 个 AI 推荐方案。`);
    } else {
      setStatus(plans.length ? `AI 暂不可用，已降级生成 ${plans.length} 个本地推荐方案。` : "暂无可聚合的候选，请先生成候选推荐。");
    }
  }

  function selectAssistantPlan(planId: string) {
    setAssistantState((current) => ({ ...current, selectedPlanId: planId }));
  }

  function acceptAssistantItemAsCandidate(plan: AssistantPlan, item: AssistantPlanItem) {
    const nextCandidate: CandidateFeature = {
      id: `candidate_assistant_${Date.now()}_${item.id}`,
      source: assistantPlanSourceToCandidateSource(plan.source, item, candidateFeatures),
      status: "pending",
      type: item.type,
      name: item.name,
      pointIds: [...item.pointIds],
      closed: item.closed,
      layer: item.layer,
      confidence: item.confidence,
      reason: `由助手方案「${plan.title}」采纳为候选：${item.reason}`
    };
    setCandidateFeatures((current) => [...current, nextCandidate]);
    setCandidateFilters(defaultCandidateFilters);
    setActiveCandidateId(nextCandidate.id);
    setStatus(`已把助手建议「${item.name}」采纳为候选，仍需在候选区正式采纳。`);
  }

  function acceptCandidate(candidateId: string) {
    const candidate = candidateFeatures.find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== "pending") return;

    const result = candidateToFeature(candidate, features.length + 1, availablePointIds);
    if (!result.feature) {
      setStatus(`候选无法采纳：${candidate.name}，${result.error}`);
      return;
    }
    const nextFeature = result.feature;
    rememberEdit();
    setFeatures((current) => [...current, nextFeature]);
    setCandidateFeatures((current) =>
      current.map((item) => (item.id === candidateId ? markCandidateStatus(item, "accepted", nextFeature.id) : item))
    );
    removeCandidateUiState([candidateId]);
    setCheckState("idle");
    setValidation(emptyValidation);
    setStatus(`已采纳候选：${candidate.name}，已进入正式地物。`);
  }

  function startEditCandidate(candidate: CandidateFeature) {
    if (candidate.status !== "pending") {
      setStatus(`候选 ${candidate.name} 已${candidateStatusLabel(candidate.status)}，不能继续编辑。`);
      return;
    }
    setCandidateDraft({
      candidateId: candidate.id,
      type: candidate.type,
      name: candidate.name,
      pointInput: candidate.pointIds.join(","),
      closed: candidate.closed,
      message: ""
    });
    setStatus(`正在编辑候选：${candidate.name}。`);
  }

  function updateCandidateDraft(patch: Partial<CandidateEditDraft>) {
    setCandidateDraft((current) => (current ? { ...current, ...patch, message: patch.message ?? "" } : current));
  }

  function cancelCandidateEdit() {
    setCandidateDraft(null);
    setStatus("已取消候选编辑，候选保持原样。");
  }

  function acceptEditedCandidate() {
    if (!candidateDraft) return;
    const candidate = candidateFeatures.find((item) => item.id === candidateDraft.candidateId);
    if (!candidate || candidate.status !== "pending") {
      setCandidateDraft(null);
      setStatus("候选已不存在，无法采纳。");
      return;
    }

    const result = resolveCandidateEditInput(candidateDraft.pointInput, availablePointIds);
    if (result.error) {
      setCandidateDraft({ ...candidateDraft, message: result.error });
      setStatus(result.error);
      return;
    }
    if (result.missingIds.length) {
      const message = `点号 ${result.missingIds.join("、")} 不存在，无法采纳候选。`;
      setCandidateDraft({ ...candidateDraft, message });
      setStatus(message);
      return;
    }

    const spec = FEATURE_TYPES[candidateDraft.type];
    const uniquePointCount = new Set(result.pointIds).size;
    if (spec.point && uniquePointCount < 1) {
      const message = "点状地物至少需要 1 个点，无法采纳候选。";
      setCandidateDraft({ ...candidateDraft, message });
      setStatus(message);
      return;
    }
    if (!spec.point && candidateDraft.closed && uniquePointCount < 3) {
      const message = "闭合地物至少需要 3 个不同点，无法采纳候选。";
      setCandidateDraft({ ...candidateDraft, message });
      setStatus(message);
      return;
    }
    if (!spec.point && !candidateDraft.closed && uniquePointCount < 2) {
      const message = "线状地物至少需要 2 个点，无法采纳候选。";
      setCandidateDraft({ ...candidateDraft, message });
      setStatus(message);
      return;
    }

    const featurePointIds =
      !spec.point && candidateDraft.closed && result.pointIds[0] !== result.pointIds[result.pointIds.length - 1]
        ? [...result.pointIds, result.pointIds[0]]
        : spec.point ? [result.pointIds[0]] : result.pointIds;
    const nextFeature: Feature = {
      id: `feature_${Date.now()}_${features.length + 1}`,
      type: candidateDraft.type,
      name: candidateDraft.name.trim() || spec.label,
      pointIds: featurePointIds,
      closed: candidateDraft.closed,
      layer: spec.layer,
      note: `由候选编辑后采纳：${candidate.reason}`
    };

    rememberEdit();
    setFeatures((current) => [...current, nextFeature]);
    setCandidateFeatures((current) =>
      current.map((item) => (item.id === candidate.id ? markCandidateStatus(item, "accepted", nextFeature.id) : item))
    );
    removeCandidateUiState([candidate.id]);
    setCandidateDraft(null);
    setCheckState("idle");
    setValidation(emptyValidation);
    setStatus(`已按编辑内容采纳候选：${nextFeature.name}。`);
  }

  function ignoreCandidate(candidateId: string) {
    const candidate = candidateFeatures.find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== "pending") return;
    rememberEdit();
    setCandidateFeatures((current) =>
      current.map((item) => (item.id === candidateId ? markCandidateStatus(item, "ignored") : item))
    );
    removeCandidateUiState([candidateId]);
    setStatus(candidate ? `已忽略候选：${candidate.name}。` : "已忽略候选。");
  }

  function removeCandidateUiState(candidateIds: string[]) {
    const removed = new Set(candidateIds);
    setSelectedCandidateIds((current) => current.filter((id) => !removed.has(id)));
    setHoveredCandidateId((current) => (current && removed.has(current) ? null : current));
    setActiveCandidateId((current) => (current && removed.has(current) ? null : current));
    setCandidateDraft((current) => (current && removed.has(current.candidateId) ? null : current));
  }

  function activateCandidate(candidate: CandidateFeature) {
    if (candidate.status !== "pending") {
      setStatus(`候选 ${candidate.name} 已${candidateStatusLabel(candidate.status)}，不会作为临时预览显示。`);
      return;
    }
    setActiveCandidateId(candidate.id);
    focusCandidate(candidate);
    setStatus(`已高亮候选：${candidate.name}。`);
  }

  function focusCandidate(candidate: CandidateFeature) {
    const candidatePoints = candidate.pointIds.map((id) => pointMap.get(id)).filter((point): point is ScreenPoint => Boolean(point));
    if (!candidatePoints.length) return;

    const minX = Math.min(...candidatePoints.map((point) => point.x));
    const maxX = Math.max(...candidatePoints.map((point) => point.x));
    const minY = Math.min(...candidatePoints.map((point) => point.y));
    const maxY = Math.max(...candidatePoints.map((point) => point.y));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    setView((current) => ({
      ...current,
      panX: current.panX + CANVAS_WIDTH / 2 - centerX,
      panY: current.panY + CANVAS_HEIGHT / 2 - centerY
    }));
  }

  function toggleCandidateSelection(candidateId: string) {
    const candidate = candidateFeatures.find((item) => item.id === candidateId);
    if (!candidate || candidate.status !== "pending") return;
    setSelectedCandidateIds((current) =>
      current.includes(candidateId) ? current.filter((id) => id !== candidateId) : [...current, candidateId]
    );
  }

  function handleBulkIgnore() {
    const ids = selectedCandidateIds.filter((id) => candidateFeatures.some((candidate) => candidate.id === id && candidate.status === "pending"));
    if (!ids.length) {
      setStatus("请先选择要批量忽略的候选。");
      return;
    }

    rememberEdit();
    setCandidateFeatures((current) =>
      current.map((candidate) => (ids.includes(candidate.id) ? markCandidateStatus(candidate, "ignored") : candidate))
    );
    removeCandidateUiState(ids);
    setStatus(`已批量忽略 ${ids.length} 个候选。`);
  }

  function handleBulkAccept() {
    const selected = candidateFeatures.filter((candidate) => selectedCandidateIds.includes(candidate.id) && candidate.status === "pending");
    if (!selected.length) {
      setStatus("请先选择要批量采纳的候选。");
      return;
    }

    const validFeatures: Feature[] = [];
    const acceptedIds: string[] = [];
    const skipped: string[] = [];

    selected.forEach((candidate, index) => {
      const result = candidateToFeature(candidate, features.length + validFeatures.length + index + 1, availablePointIds);
      if (result.feature) {
        validFeatures.push(result.feature);
        acceptedIds.push(candidate.id);
      } else {
        skipped.push(`${candidate.name}：${result.error}`);
      }
    });

    if (validFeatures.length) {
      rememberEdit();
      setFeatures((current) => [...current, ...validFeatures]);
      const featureIdByCandidateId = new Map(acceptedIds.map((id, index) => [id, validFeatures[index].id]));
      setCandidateFeatures((current) =>
        current.map((candidate) =>
          featureIdByCandidateId.has(candidate.id)
            ? markCandidateStatus(candidate, "accepted", featureIdByCandidateId.get(candidate.id))
            : candidate
        )
      );
      removeCandidateUiState(acceptedIds);
      setCheckState("idle");
      setValidation(emptyValidation);
    }

    const message = [
      validFeatures.length ? `已批量采纳 ${validFeatures.length} 个候选。` : "没有候选被采纳。",
      skipped.length ? `跳过 ${skipped.length} 个：${skipped.join("；")}` : ""
    ].filter(Boolean).join(" ");
    setStatus(message);
  }

  async function runValidation(document: ProjectDocument = projectDocument, options?: { silent?: boolean }) {
    setBusy(true);
    try {
      const result = await validateProject(document);
      setValidation(result);
      const nextCheckState = checkStateFromValidation(result);
      setCheckState(nextCheckState);
      const summary = getCheckSummary(nextCheckState, result);
      if (!options?.silent) {
        setStatus(summary);
      }
      return result;
    } catch (error) {
      setCheckState("error");
      const message = `检查失败：${errorMessage(error, "错误检查失败")}`;
      setStatus(message);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function handleImportJson(file: File | null) {
    if (!file) return;
    setBusy(true);
    setStatus("正在导入项目 JSON...");
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new Error(`JSON 格式错误：${errorMessage(error, "无法解析 JSON")}`);
      }

      const imported = normalizeImportedProject(parsed);
      setProject(imported.project);
      setPoints(imported.points);
      setFeatures(imported.features);
      setAttachments(normalizeSketchAttachments(imported.attachments));
      setSelectedMarkupId(null);
      setMarkupPointInput("");
      setMarkupMessage("");
      setCandidateFeatures([]);
      setCandidateFilters(defaultCandidateFilters);
      setCandidateDraft(null);
      setHoveredCandidateId(null);
      setActiveCandidateId(null);
      setSelectedCandidateIds([]);
      setSelectedIds([]);
      clearEditHistory();
      setPointInput("");
      setPointInputMessage("");
      setPreview(null);
      setMapping(emptyMapping);
      setView(defaultView);
      setValidation(emptyValidation);
      setCheckState("idle");
      setFeatureName("");
      const importedSketchCount = normalizeSketchAttachments(imported.attachments).length;
      setStatus(`已导入 ${file.name}，恢复 ${imported.points.length} 个点、${imported.features.length} 个地物、${importedSketchCount} 个草图附件。`);

      const result = await validateProject(imported);
      const nextCheckState = checkStateFromValidation(result);
      setValidation(result);
      setCheckState(nextCheckState);
      setStatus(`已导入 ${file.name}，${getCheckSummary(nextCheckState, result)}${importedSketchCount ? "；草图附件已恢复，缺少图片本体时需要重新选择本地草图文件。" : ""}`);
    } catch (error) {
      setStatus(errorMessage(error, "导入 JSON 失败"));
      setCheckState("idle");
      setValidation(emptyValidation);
    } finally {
      setBusy(false);
      if (jsonInputRef.current) {
        jsonInputRef.current.value = "";
      }
    }
  }

  function exportJson() {
    downloadBlob(new Blob([JSON.stringify(projectDocument, null, 2)], { type: "application/json" }), `${safeFileName(project.id)}.json`);
    setStatus("已导出项目 JSON。");
  }

  async function exportKind(kind: "dat" | "dxf") {
    setBusy(true);
    try {
      const blob = await exportProjectFile(projectDocument, kind);
      downloadBlob(blob, `${safeFileName(project.id)}.${kind}`);
      setStatus(`已导出 ${kind.toUpperCase()}。`);
    } catch (error) {
      setStatus(errorMessage(error, "导出失败"));
    } finally {
      setBusy(false);
    }
  }

  function onSvgPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const current = svgPoint(event, event.currentTarget);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === "box") {
      setBox({ x: current.x, y: current.y, width: 0, height: 0 });
    }
    if (mode === "pan") {
      setDrag({ x: current.x, y: current.y, panX: view.panX, panY: view.panY });
    }
  }

  function onSvgPointerMove(event: PointerEvent<SVGSVGElement>) {
    const current = svgPoint(event, event.currentTarget);
    if (box) {
      setBox({ ...box, width: current.x - box.x, height: current.y - box.y });
    }
    if (drag) {
      setView((value) => ({ ...value, panX: drag.panX + current.x - drag.x, panY: drag.panY + current.y - drag.y }));
    }
  }

  function onSvgPointerUp(event: PointerEvent<SVGSVGElement>) {
    if (box) {
      const ids = screenPoints.filter((point) => pointInRect(point, box)).map((point) => point.id);
      setSelectedIds((current) => Array.from(new Set([...current, ...ids])));
      setStatus(ids.length ? `框选 ${ids.length} 个点。` : "框选范围内没有点。");
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setBox(null);
    setDrag(null);
  }

  function onWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    setView((value) => ({ ...value, zoom: Math.min(10, Math.max(0.25, Number((value.zoom * factor).toFixed(3)))) }));
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">A</div>
          <div>
            <h1>CASS智能成图助手</h1>
            <span>{project.id} · 1:{project.scale} · {project.coordinateSystem}</span>
          </div>
        </div>
        <WorkflowSteps activeStep={workflowStep} />
        <div className="header-actions">
          <span className={busy ? "badge busy" : "badge"}>{busy ? "处理中" : "引擎就绪"}</span>
          <button className="primary" onClick={() => exportKind("dxf")} disabled={busy || !points.length}>导出成果</button>
        </div>
      </header>
      <aside className="sidebar left" aria-label="项目与编辑">
        <nav className="sidebar-tabs" aria-label="左侧工作区">
          <button className={leftPanelTab === "project" ? "active" : ""} onClick={() => setLeftPanelTab("project")}>工程</button>
          <button className={leftPanelTab === "data" ? "active" : ""} onClick={() => setLeftPanelTab("data")}>数据</button>
          <button className={leftPanelTab === "sketch" ? "active" : ""} onClick={() => setLeftPanelTab("sketch")}>草图</button>
        </nav>
        <div className="sidebar-scroll">
        <section className="panel" hidden={leftPanelTab !== "project"}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CASS MVP</p>
              <h1>智能成图工作台</h1>
            </div>
            <span className={busy ? "badge busy" : "badge"}>{busy ? "处理中" : "本地项目"}</span>
          </div>

          <label>
            项目名
            <input value={project.name} onChange={(event) => setProject({ ...project, name: event.target.value })} />
          </label>
          <div className="two-col">
            <label>
              项目 ID
              <input value={project.id} onChange={(event) => setProject({ ...project, id: event.target.value })} />
            </label>
            <label>
              比例尺
              <select value={project.scale} onChange={(event) => setProject({ ...project, scale: Number(event.target.value) })}>
                <option value={500}>1:500</option>
                <option value={1000}>1:1000</option>
                <option value={2000}>1:2000</option>
              </select>
            </label>
          </div>
          <label className="upload-box compact">
            <input ref={jsonInputRef} type="file" accept=".json,application/json" onChange={(event) => handleImportJson(event.target.files?.[0] || null)} />
            <strong>导入项目 JSON</strong>
            <span>恢复项目、点、地物和比例尺，导入后可继续编辑和导出。</span>
          </label>
        </section>

        <section className="panel" hidden={leftPanelTab !== "sketch"}>
          <div className="section-title">草图对照</div>
          <label className="upload-box compact">
            <input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={(event) => handleSketchUpload(event.target.files?.[0] || null)} />
            <strong>选择 PNG / JPG 草图</strong>
            <span>草图只作为人工对照附件，不识别点号，不生成地物。</span>
          </label>
          {activeSketch ? (
            <div className="sketch-meta">
              <strong>{activeSketch.fileName}</strong>
              <span>{sketchSizeText(activeSketch)}</span>
              <small>
                {activeSketch.dataUrl
                  ? "会随项目 JSON 保存；不会进入 DAT/DXF。"
                  : "项目 JSON 只保存元数据，导入后需要重新选择本地草图文件。"}
              </small>
              <button onClick={() => setSketchPanelVisible((value) => !value)}>
                {sketchPanelVisible ? "隐藏草图面板" : "显示草图面板"}
              </button>
            </div>
          ) : (
            <div className="empty">还没有草图附件。</div>
          )}
        </section>

        <section className="panel" hidden={leftPanelTab !== "data"}>
          <div className="section-title">数据上传</div>
          <label className="upload-box">
            <input type="file" accept=".csv,.xlsx,.dat" onChange={(event) => handleUpload(event.target.files?.[0] || null)} />
            <strong>选择 CSV / XLSX / DAT</strong>
            <span>后端读取表头，前端确认映射后展点。</span>
          </label>

          {preview && (
            <>
              <div className="summary-strip">
                <span>{preview.columns.length} 个字段</span>
                <span>{preview.previewRows.length} 行预览</span>
              </div>
              <MappingEditor columns={preview.columns} mapping={mapping} onChange={setMapping} />
              <PreviewTable preview={preview} />
              <button className="primary" disabled={!mappingReady || busy} onClick={handleParsePoints}>
                确认映射并展点
              </button>
            </>
          )}
        </section>

        <section className="panel" hidden={leftPanelTab !== "data"}>
          <div className="section-title">地物编辑</div>
          <div className="segmented" role="group" aria-label="画布工具">
            <button className={mode === "select" ? "active" : ""} onClick={() => setMode("select")}>点选</button>
            <button className={mode === "box" ? "active" : ""} onClick={() => setMode("box")}>框选</button>
            <button className={mode === "pan" ? "active" : ""} onClick={() => setMode("pan")}>平移</button>
          </div>

          <label>
            地物类型
            <select value={featureType} onChange={(event) => setFeatureType(event.target.value as FeatureType)}>
              {featureOrder.map((key) => (
                <option key={key} value={key}>{FEATURE_TYPES[key].label}</option>
              ))}
            </select>
          </label>
          <label>
            地物名
            <input value={featureName} onChange={(event) => setFeatureName(event.target.value)} placeholder={currentFeature.label} />
          </label>

          <div className="point-sequence-box">
            <label>
              点号序列 / 范围
              <input
                value={pointInput}
                onChange={(event) => {
                  setPointInput(event.target.value);
                  setPointInputMessage("");
                }}
                placeholder="53,54,55,56 或 59-66"
              />
            </label>
            <div className="action-grid">
              <button onClick={handleSelectByPointInput} disabled={!points.length}>
                按点号选择
              </button>
              <button onClick={() => createFeatureByPointInput("line")} disabled={!points.length}>
                按点号成线
              </button>
              <button className="primary" onClick={() => createFeatureByPointInput("area")} disabled={!points.length}>
                按点号闭合成面
              </button>
            </div>
            <div className={pointInputMessage.includes("不存在") || pointInputMessage.includes("请先") || pointInputMessage.includes("至少") || pointInputMessage.includes("格式") ? "point-input-message warning" : "point-input-message"}>
              {pointInputMessage || "支持逗号序列和数字范围；66-53 会按反向顺序选择。"}
            </div>
          </div>

          <div className="action-grid">
            <button className="primary" onClick={() => createFeature()} disabled={!selectedIds.length}>
              生成所选类型
            </button>
            <button onClick={() => createFeature("line")} disabled={selectedIds.length < 2}>
              多点成线
            </button>
            <button onClick={() => createFeature("building")} disabled={selectedIds.length < 3}>
              闭合成面
            </button>
            <button onClick={() => createFeature("tree")} disabled={!selectedIds.length}>
              生成树
            </button>
            <button onClick={() => createFeature("manhole")} disabled={!selectedIds.length}>
              生成井盖
            </button>
            <button onClick={() => setSelectedIds([])} disabled={!selectedIds.length}>
              清空选择
            </button>
          </div>
          <div className="selected-line" title={selectedIds.join(" -> ")}>
            已选 {selectedIds.length} 个点{selectedIds.length ? `：${selectedIds.join(" -> ")}` : ""}
          </div>
        </section>
        </div>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div className="metric"><strong>{points.length}</strong><span>点</span></div>
          <div className="metric"><strong>{features.length}</strong><span>地物</span></div>
          <div className="metric"><strong>{selectedIds.length}</strong><span>已选</span></div>
          <div className="metric"><strong>{selectedCandidateIds.length}</strong><span>候选</span></div>
          <button onClick={handleUndo} disabled={!undoStack.length}>撤销</button>
          <button onClick={handleRedo} disabled={!redoStack.length}>重做</button>
          <label className="inline"><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} /> 点号</label>
          <label className="inline"><input type="checkbox" checked={showHeights} onChange={(event) => setShowHeights(event.target.checked)} /> 高程</label>
          <button onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })}>重置视图</button>
          <span className={`check-pill ${checkState}`}>{checkSummary}</span>
          <span className="status">{status}</span>
        </header>

        <div className={`work-area ${sketchPanelVisible && activeSketch ? "with-sketch" : ""}`}>
          <div className="canvas-wrap">
            <svg
              className={`point-canvas mode-${mode}`}
              viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
              onPointerDown={onSvgPointerDown}
              onPointerMove={onSvgPointerMove}
              onPointerUp={onSvgPointerUp}
              onPointerCancel={onSvgPointerUp}
              onWheel={onWheel}
              role="img"
              aria-label="SVG 点位画布"
            >
              <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="canvas-bg" />
              <CanvasGrid />
              {visibleFeatures.map((feature) => (
                <FeatureShape key={feature.id} feature={feature} pointMap={pointMap} />
              ))}
              {highlightedCandidate && <CandidatePreview candidate={highlightedCandidate} pointMap={pointMap} />}
              {screenPoints.map((screenPoint) => (
                <PointNode
                  key={screenPoint.id}
                  screenPoint={screenPoint}
                  selected={selectedSet.has(screenPoint.id)}
                  mode={mode}
                  showLabels={showLabels}
                  showHeights={showHeights}
                  onToggle={togglePoint}
                />
              ))}
              {box && <SelectionBox box={box} />}
            </svg>
            {!points.length && (
              <div className="canvas-empty">
                <strong>等待点文件</strong>
                <span>导入并解析后，点位会显示在这里。</span>
              </div>
            )}
          </div>
          {sketchPanelVisible && activeSketch && (
            <SketchPanel
              sketch={activeSketch}
              markups={activeSketchMarkups}
              selectedMarkup={selectedMarkup}
              mode={sketchMarkupMode}
              draft={markupDraft}
              pointInput={markupPointInput}
              message={markupMessage}
              features={features}
              view={sketchView}
              onModeChange={(nextMode) => setSketchMarkupMode(nextMode)}
              onSelectMarkup={(markup) => {
                setSelectedMarkupId(markup.id);
                setMarkupPointInput(markup.linkedPointIds.join(","));
                setMarkupMessage("");
              }}
              onUpdateMarkup={updateSelectedMarkup}
              onDeleteMarkup={deleteSelectedMarkup}
              onPointInputChange={setMarkupPointInput}
              onBindPoints={bindMarkupPoints}
              onBindFeature={bindMarkupFeature}
              onGenerateCandidate={generateCandidateFromSelectedMarkup}
              onZoom={zoomSketch}
              onReset={resetSketchView}
              onHide={() => setSketchPanelVisible(false)}
              onPanPointerDown={onSketchPointerDown}
              onPanPointerMove={onSketchPointerMove}
              onPanPointerUp={onSketchPointerUp}
              onMarkupPointerDown={onSketchMarkupPointerDown}
              onMarkupPointerMove={onSketchMarkupPointerMove}
              onMarkupPointerUp={onSketchMarkupPointerUp}
            />
          )}
        </div>
      </section>

      <aside className="sidebar right" aria-label="检查与导出">
        <AssistantPanelV2
          state={assistantState}
          stepMessage={assistantStepMessage.content}
          hasSketch={Boolean(activeSketch?.dataUrl || activeSketch?.previewUrl)}
          sketchAnalyzed={sketchAnalyzed}
          sketchObservations={sketchObservations}
          sketchUncertainPoints={sketchUncertainPoints}
          sketchGeneralDescription={sketchGeneralDescription}
          sketchAnalysisMessage={sketchAnalysisMessage}
          onAnalyzeSketch={handleAnalyzeSketch}
          onConfirmObservation={confirmSketchObservation}
          onDeleteObservation={deleteSketchObservation}
          onObservationPointIdsChange={updateSketchObservationPointIds}
          onObservationTypeChange={updateSketchObservationType}
          onConfirmAllAndGenerate={confirmAllSketchObservationsAndGenerate}
          onGeneratePlans={handleGenerateAssistantPlans}
          onSelectPlan={selectAssistantPlan}
          onAcceptItem={acceptAssistantItemAsCandidate}
        />

        <nav className="right-tabs" aria-label="右侧工作区">
          <button className={rightPanelTab === "candidates" ? "active" : ""} onClick={() => setRightPanelTab("candidates")}>
            候选列表 ({candidateStats.pending})
          </button>
          <button className={rightPanelTab === "check" ? "active" : ""} onClick={() => setRightPanelTab("check")}>
            异常检查
          </button>
          <button className={rightPanelTab === "features" ? "active" : ""} onClick={() => setRightPanelTab("features")}>
            图层地物
          </button>
        </nav>

        <div className="right-scroll">
        <section className="panel" hidden={rightPanelTab !== "candidates"}>
          <div className="section-title">候选推荐</div>
          <button className="primary" onClick={handleGenerateCandidates} disabled={!points.length}>
            生成候选推荐
          </button>
          <div className="candidate-summary">
            总候选 {candidateStats.total} 个，未处理 {candidateStats.pending} 个，已采纳 {candidateStats.accepted} 个，已忽略 {candidateStats.ignored} 个，已选 {selectedCandidateIds.length} 个。筛选不影响导出。
          </div>
          <div className="candidate-filters">
            <label>
              来源
              <select
                value={candidateFilters.source}
                onChange={(event) => setCandidateFilters((current) => ({ ...current, source: event.target.value as CandidateFilters["source"] }))}
              >
                <option value="all">全部来源</option>
                <option value="point_sequence">连续点号</option>
                <option value="note">备注</option>
                <option value="code">编码</option>
                <option value="sketch_markup">草图标注</option>
              </select>
            </label>
            <label>
              状态
              <select
                value={candidateFilters.status}
                onChange={(event) => setCandidateFilters((current) => ({ ...current, status: event.target.value as CandidateFilters["status"] }))}
              >
                <option value="all">全部状态</option>
                <option value="pending">未处理</option>
                <option value="accepted">已采纳</option>
                <option value="ignored">已忽略</option>
              </select>
            </label>
            <label>
              类型
              <select
                value={candidateFilters.type}
                onChange={(event) => setCandidateFilters((current) => ({ ...current, type: event.target.value as CandidateFilters["type"] }))}
              >
                <option value="all">全部类型</option>
                {featureOrder.map((key) => (
                  <option key={key} value={key}>{FEATURE_TYPES[key].label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="candidate-bulk-actions">
            <button onClick={handleBulkIgnore} disabled={!selectedCandidateIds.length}>批量忽略</button>
            <button className="primary" onClick={handleBulkAccept} disabled={!selectedCandidateIds.length}>批量采纳</button>
          </div>
          {!candidateFeatures.length && <div className="empty">点击生成候选推荐后显示候选列表。</div>}
          <div className="candidate-list" hidden={!candidateFeatures.length}>
            {filteredCandidates.map((candidate) => {
              const isPending = candidate.status === "pending";
              return (
                <div
                  className={`candidate-row status-${candidate.status} ${activeCandidateId === candidate.id ? "active" : ""} ${selectedCandidateSet.has(candidate.id) ? "checked" : ""}`}
                  key={candidate.id}
                  onMouseEnter={() => isPending && setHoveredCandidateId(candidate.id)}
                  onMouseLeave={() => setHoveredCandidateId((current) => (current === candidate.id ? null : current))}
                  onClick={() => activateCandidate(candidate)}
                >
                  {candidateDraft?.candidateId === candidate.id && isPending ? (
                    <div className="candidate-editor" onClick={(event) => event.stopPropagation()}>
                      <div className="candidate-editor-title">
                        <strong>编辑后采纳</strong>
                        <span>{candidateSourceLabel(candidate.source)} · {candidateRangeText(candidate)} · 原始 {candidate.pointIds.length} 点</span>
                      </div>
                      <label>
                        地物类型
                        <select
                          value={candidateDraft.type}
                          onChange={(event) => {
                            const nextType = event.target.value as FeatureType;
                            updateCandidateDraft({ type: nextType, closed: FEATURE_TYPES[nextType].closed });
                          }}
                        >
                          {candidateEditableTypes.map((key) => (
                            <option key={key} value={key}>{FEATURE_TYPES[key].label}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        地物名
                        <input value={candidateDraft.name} onChange={(event) => updateCandidateDraft({ name: event.target.value })} />
                      </label>
                      <label>
                        点号序列
                        <input
                          value={candidateDraft.pointInput}
                          onChange={(event) => updateCandidateDraft({ pointInput: event.target.value })}
                          placeholder="69,70,72,76"
                        />
                      </label>
                      <label className="inline candidate-closed">
                        <input
                          type="checkbox"
                          checked={candidateDraft.closed}
                          onChange={(event) => updateCandidateDraft({ closed: event.target.checked })}
                        />
                        闭合
                      </label>
                      <div className={candidateDraft.message ? "candidate-edit-message warning" : "candidate-edit-message"}>
                        {candidateDraft.message || "可删除、追加或调整点号顺序；采纳后才会进入正式地物和导出。"}
                      </div>
                      <div className="candidate-actions edit-actions">
                        <button className="primary" onClick={(event) => { event.stopPropagation(); acceptEditedCandidate(); }}>采纳编辑</button>
                        <button onClick={(event) => { event.stopPropagation(); cancelCandidateEdit(); }}>取消编辑</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="candidate-card-main">
                        <label className="candidate-check" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedCandidateSet.has(candidate.id)}
                            disabled={!isPending}
                            onChange={() => toggleCandidateSelection(candidate.id)}
                          />
                          <span>{isPending ? "选择" : candidateStatusLabel(candidate.status)}</span>
                        </label>
                        <div>
                          <strong>{candidate.name}</strong>
                          <span>{candidateStatusLabel(candidate.status)} · {candidateSourceLabel(candidate.source)} · {candidateTypeLabel(candidate.type)} · {candidateRangeText(candidate)} · {candidate.pointIds.length} 点</span>
                          <small>{candidate.reason}</small>
                          <em>置信度 {Math.round(candidate.confidence * 100)}%</em>
                        </div>
                      </div>
                      {isPending ? (
                        <div className="candidate-actions">
                          <button className="primary" onClick={(event) => { event.stopPropagation(); acceptCandidate(candidate.id); }}>采纳</button>
                          <button onClick={(event) => { event.stopPropagation(); startEditCandidate(candidate); }}>编辑</button>
                          <button onClick={(event) => { event.stopPropagation(); ignoreCandidate(candidate.id); }}>忽略</button>
                        </div>
                      ) : (
                        <div className="candidate-state-note">
                          {candidateStatusLabel(candidate.status)}候选只用于追踪状态，不参与批量操作。
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {!candidateFeatures.length && <div className="empty">还没有候选。导入点后点击“生成候选推荐”。</div>}
            {Boolean(candidateFeatures.length && !filteredCandidates.length) && <div className="empty">当前筛选条件下没有候选。</div>}
          </div>
        </section>

        <section className="panel" hidden={rightPanelTab !== "features"}>
          <div className="section-title">图层显示</div>
          <div className="layer-toggle-grid">
            {CONTROLLED_LAYERS.map((layer) => (
              <label className="inline" key={layer}>
                <input
                  type="checkbox"
                  checked={layerVisibility[layer]}
                  onChange={(event) => setLayerVisibility((current) => ({ ...current, [layer]: event.target.checked }))}
                />
                {layer}
              </label>
            ))}
          </div>
          <div className="export-note">只控制画布显示，不删除地物，也不影响 JSON / DAT / DXF 导出。</div>
        </section>

        <section className="panel" hidden={rightPanelTab !== "features"}>
          <div className="section-title">地物列表</div>
          <div className="feature-list">
            {features.map((feature) => (
              <div className="feature-row" key={feature.id}>
                <div>
                  <strong>{feature.name}</strong>
                  <span>{FEATURE_TYPES[feature.type]?.label || feature.type} · {feature.layer} · {feature.pointIds.length} 点</span>
                  <small>{feature.pointIds.join(" - ")}</small>
                </div>
                <button onClick={() => deleteFeature(feature.id)}>删除</button>
              </div>
            ))}
            {!features.length && <div className="empty">还没有地物。选择点后可以生成线、面、树或井盖。</div>}
          </div>
        </section>

        <section className="panel" hidden={rightPanelTab !== "check"}>
          <div className="section-title">错误检查</div>
          <button onClick={() => runValidation()} disabled={busy || !points.length}>重新检查</button>
          <IssueList validation={validation} checkState={checkState} />
        </section>

        </div>

        <section className="panel export-panel">
          <div className="section-title">导出</div>
          <button onClick={exportJson} disabled={!points.length}>导出 JSON</button>
          <button onClick={() => exportKind("dat")} disabled={busy || !points.length}>导出 DAT</button>
          <button className="primary" onClick={() => exportKind("dxf")} disabled={busy || !points.length}>导出 DXF</button>
          <div className="export-note">
            {exportSummary}
          </div>
        </section>
      </aside>
    </main>
  );
}

function SketchPanel({
  sketch,
  markups,
  selectedMarkup,
  mode,
  draft,
  pointInput,
  message,
  features,
  view,
  onModeChange,
  onSelectMarkup,
  onUpdateMarkup,
  onDeleteMarkup,
  onPointInputChange,
  onBindPoints,
  onBindFeature,
  onGenerateCandidate,
  onZoom,
  onReset,
  onHide,
  onPanPointerDown,
  onPanPointerMove,
  onPanPointerUp,
  onMarkupPointerDown,
  onMarkupPointerMove,
  onMarkupPointerUp
}: {
  sketch: SketchAttachment;
  markups: SketchMarkup[];
  selectedMarkup: SketchMarkup | null;
  mode: SketchMarkupMode;
  draft: { type: SketchMarkupType; start: { x: number; y: number }; current: { x: number; y: number } } | null;
  pointInput: string;
  message: string;
  features: Feature[];
  view: SketchViewState;
  onModeChange: (mode: SketchMarkupMode) => void;
  onSelectMarkup: (markup: SketchMarkup) => void;
  onUpdateMarkup: (patch: Partial<SketchMarkup>) => void;
  onDeleteMarkup: () => void;
  onPointInputChange: (value: string) => void;
  onBindPoints: () => void;
  onBindFeature: (featureId: string) => void;
  onGenerateCandidate: () => void;
  onZoom: (factor: number) => void;
  onReset: () => void;
  onHide: () => void;
  onPanPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPanPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPanPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onMarkupPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onMarkupPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onMarkupPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const selectedLinkedFeature = selectedMarkup?.linkedFeatureId
    ? features.find((feature) => feature.id === selectedMarkup.linkedFeatureId)
    : null;
  const linkedFeatureMissing = Boolean(selectedMarkup?.linkedFeatureId && !selectedLinkedFeature);
  const contentStyle = {
    width: sketch.width || 640,
    height: sketch.height || 420,
    transform: `translate(-50%, -50%) translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`
  };
  return (
    <aside className="sketch-panel" aria-label="草图对照面板">
      <div className="sketch-panel-header">
        <div>
          <strong>草图对照</strong>
          <span>{sketch.fileName}</span>
        </div>
        <button onClick={onHide}>隐藏</button>
      </div>
      <div className="sketch-tools">
        <button onClick={() => onZoom(1.2)}>放大</button>
        <button onClick={() => onZoom(0.82)}>缩小</button>
        <button onClick={onReset}>重置</button>
      </div>
      <div className="sketch-markup-tools">
        {(["select", "rect", "line", "point"] as SketchMarkupMode[]).map((item) => (
          <button className={mode === item ? "active" : ""} key={item} onClick={() => onModeChange(item)}>
            {item === "select" ? "选择" : markupTypeLabel(item)}
          </button>
        ))}
      </div>
      <div
        className="sketch-viewer"
        onPointerDown={mode === "select" ? onPanPointerDown : onMarkupPointerDown}
        onPointerMove={mode === "select" ? onPanPointerMove : onMarkupPointerMove}
        onPointerUp={mode === "select" ? onPanPointerUp : onMarkupPointerUp}
        onPointerCancel={mode === "select" ? onPanPointerUp : onMarkupPointerUp}
      >
        {sketch.previewUrl ? (
          <div className="sketch-content" style={contentStyle}>
            <img src={sketch.previewUrl} alt={`草图 ${sketch.fileName}`} draggable={false} />
            <svg viewBox={`0 0 ${sketch.width || 640} ${sketch.height || 420}`} className="sketch-markup-layer">
              {markups.map((markup) => (
                <SketchMarkupShape
                  key={markup.id}
                  markup={markup}
                  selected={selectedMarkup?.id === markup.id}
                  linkedFeatureMissing={Boolean(markup.linkedFeatureId && !features.some((feature) => feature.id === markup.linkedFeatureId))}
                  selectable={mode === "select"}
                  onSelect={onSelectMarkup}
                />
              ))}
              {draft && <SketchMarkupDraft type={draft.type} geometry={normalizeMarkupGeometry(draft.type, draft.start, draft.current)} />}
            </svg>
          </div>
        ) : (
          <div className="sketch-missing">
            <strong>需要重新选择本地草图文件</strong>
            <span>项目 JSON 中只有草图元数据，没有图片本体。</span>
          </div>
        )}
      </div>
      <div className="sketch-note">
        草图仅供人工对照，不配准坐标，不生成地物，不进入 DAT/DXF。
      </div>
      <div className="markup-editor">
        <div className="section-title">标注绑定</div>
        {selectedMarkup ? (
          <>
            <label>
              标注名称
              <input value={selectedMarkup.label} onChange={(event) => onUpdateMarkup({ label: event.target.value })} />
            </label>
            <label>
              备注
              <input value={selectedMarkup.note} onChange={(event) => onUpdateMarkup({ note: event.target.value })} />
            </label>
            <label>
              绑定点号
              <input value={pointInput} onChange={(event) => onPointInputChange(event.target.value)} placeholder="B1,B2,B3,B4" />
            </label>
            <div className="candidate-bulk-actions">
              <button onClick={onBindPoints}>绑定点号</button>
              <button onClick={onGenerateCandidate} className="primary">生成候选</button>
            </div>
            <label>
              绑定正式地物
              <select value={selectedMarkup.linkedFeatureId || ""} onChange={(event) => onBindFeature(event.target.value)}>
                <option value="">不绑定地物</option>
                {features.map((feature) => (
                  <option key={feature.id} value={feature.id}>{feature.name}</option>
                ))}
              </select>
            </label>
            <div className={message.includes("不存在") || message.includes("至少") || linkedFeatureMissing ? "markup-message warning" : "markup-message"}>
              {message || markupBindingSummary(selectedMarkup, selectedLinkedFeature?.name, linkedFeatureMissing)}
            </div>
            <button onClick={onDeleteMarkup}>删除标注</button>
          </>
        ) : (
          <div className="empty">选择标注后可编辑名称、绑定点号或生成候选。</div>
        )}
      </div>
    </aside>
  );
}

function SketchMarkupShape({
  markup,
  selected,
  linkedFeatureMissing,
  selectable,
  onSelect
}: {
  markup: SketchMarkup;
  selected: boolean;
  linkedFeatureMissing: boolean;
  selectable: boolean;
  onSelect: (markup: SketchMarkup) => void;
}) {
  const className = `sketch-markup-shape ${selected ? "selected" : ""} ${linkedFeatureMissing ? "missing-link" : ""}`;
  return (
    <g
      className={className}
      onPointerDown={(event) => {
        if (!selectable) return;
        event.stopPropagation();
        onSelect(markup);
      }}
    >
      {markup.type === "rect" && isRectGeometry(markup.geometry) && (
        <rect x={markup.geometry.x} y={markup.geometry.y} width={markup.geometry.width} height={markup.geometry.height} />
      )}
      {markup.type === "line" && isPointsGeometry(markup.geometry) && (
        <polyline points={markup.geometry.points.map((point) => `${point.x},${point.y}`).join(" ")} />
      )}
      {markup.type === "point" && isPointsGeometry(markup.geometry) && markup.geometry.points[0] && (
        <circle cx={markup.geometry.points[0].x} cy={markup.geometry.points[0].y} r={10} />
      )}
      <text x={markupLabelPoint(markup).x + 8} y={markupLabelPoint(markup).y - 8}>{markup.label}</text>
    </g>
  );
}

function SketchMarkupDraft({ type, geometry }: { type: SketchMarkupType; geometry: SketchMarkupGeometry }) {
  return (
    <g className="sketch-markup-draft">
      {type === "rect" && isRectGeometry(geometry) && <rect x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} />}
      {type === "line" && isPointsGeometry(geometry) && <polyline points={geometry.points.map((point) => `${point.x},${point.y}`).join(" ")} />}
    </g>
  );
}

function MappingEditor({
  columns,
  mapping,
  onChange
}: {
  columns: string[];
  mapping: FieldMapping;
  onChange: (mapping: FieldMapping) => void;
}) {
  const fields: { key: keyof FieldMapping; label: string; required?: boolean }[] = [
    { key: "pointId", label: "点号", required: true },
    { key: "east", label: "东坐标", required: true },
    { key: "north", label: "北坐标", required: true },
    { key: "height", label: "高程" },
    { key: "note", label: "备注" },
    { key: "code", label: "编码" }
  ];

  return (
    <div className="mapping-grid">
      {fields.map((field) => (
        <label key={field.key}>
          {field.label}{field.required ? " *" : ""}
          <select value={mapping[field.key] || ""} onChange={(event) => onChange({ ...mapping, [field.key]: event.target.value })}>
            <option value="">不使用</option>
            {columns.map((column) => (
              <option key={column} value={column}>{column}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function PreviewTable({ preview }: { preview: UploadPreview }) {
  const columns = preview.columns.slice(0, 5);
  const rows = preview.previewRows.slice(0, 4);
  if (!rows.length) return <div className="empty">文件里暂时没有可预览的数据行。</div>;

  return (
    <div className="preview-table" aria-label="文件预览">
      <table>
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CanvasGrid() {
  return (
    <g className="grid">
      {Array.from({ length: 25 }).map((_, index) => (
        <line key={`v${index}`} x1={index * 40} y1={0} x2={index * 40} y2={CANVAS_HEIGHT} />
      ))}
      {Array.from({ length: 16 }).map((_, index) => (
        <line key={`h${index}`} x1={0} y1={index * 40} x2={CANVAS_WIDTH} y2={index * 40} />
      ))}
    </g>
  );
}

function PointNode({
  screenPoint,
  selected,
  mode,
  showLabels,
  showHeights,
  onToggle
}: {
  screenPoint: ScreenPoint;
  selected: boolean;
  mode: ToolMode;
  showLabels: boolean;
  showHeights: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <g
      className={`point ${selected ? "selected" : ""}`}
      onPointerDown={(event) => {
        if (mode === "select") event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (mode === "select") onToggle(screenPoint.id);
      }}
    >
      <circle cx={screenPoint.x} cy={screenPoint.y} r={4.8} />
      {showLabels && <text x={screenPoint.x + 8} y={screenPoint.y - 8}>{screenPoint.id}</text>}
      {showHeights && screenPoint.point.height !== null && (
        <text className="height" x={screenPoint.x + 8} y={screenPoint.y + 15}>{screenPoint.point.height.toFixed(2)}</text>
      )}
    </g>
  );
}

function FeatureShape({ feature, pointMap }: { feature: Feature; pointMap: Map<string, ScreenPoint> }) {
  const points = feature.pointIds.map((id) => pointMap.get(id)).filter((point): point is ScreenPoint => Boolean(point));
  if (!points.length) return null;

  const className = `feature feature-${feature.type}`;
  if (FEATURE_TYPES[feature.type]?.point) {
    const point = points[0];
    return (
      <g className={className}>
        <circle cx={point.x} cy={point.y} r={13} />
        {feature.type === "tree" && (
          <>
            <line x1={point.x - 8} y1={point.y} x2={point.x + 8} y2={point.y} />
            <line x1={point.x} y1={point.y - 8} x2={point.x} y2={point.y + 8} />
          </>
        )}
        {feature.type === "manhole" && <rect x={point.x - 7} y={point.y - 7} width={14} height={14} />}
        <text x={point.x + 16} y={point.y + 5}>{feature.name}</text>
      </g>
    );
  }

  const d = points.map((point) => `${point.x},${point.y}`).join(" ");
  if (feature.closed) {
    return <polygon className={className} points={d} />;
  }
  return <polyline className={className} points={d} />;
}

function CandidatePreview({ candidate, pointMap }: { candidate: CandidateFeature; pointMap: Map<string, ScreenPoint> }) {
  const points = candidate.pointIds.map((id) => pointMap.get(id)).filter((point): point is ScreenPoint => Boolean(point));
  if (!points.length) return null;

  const previewPoints = candidate.closed && points.length >= 3 && points[0].id !== points[points.length - 1].id ? [...points, points[0]] : points;
  const d = previewPoints.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <g className="candidate-preview" aria-label={`候选预览 ${candidate.name}`}>
      {previewPoints.length >= 2 && <polyline points={d} />}
      {points.map((point) => (
        <g key={point.id} className="candidate-preview-point">
          <circle cx={point.x} cy={point.y} r={10} />
          <text x={point.x + 12} y={point.y - 12}>{point.id}</text>
        </g>
      ))}
    </g>
  );
}

function SelectionBox({ box }: { box: BoxRect }) {
  const rect = normalizeBox(box);
  return <rect className="selection-box" x={rect.x} y={rect.y} width={rect.width} height={rect.height} />;
}

function IssueList({ validation, checkState }: { validation: ValidationResult; checkState: CheckState }) {
  const issues = [...validation.errors, ...validation.warnings];
  if (checkState === "idle") return <div className="empty">当前项目尚未检查。</div>;
  if (checkState === "passed") return <div className="empty success">检查通过，未发现问题。</div>;
  if (checkState === "error") return <div className="empty danger">检查失败，请查看顶部状态。</div>;
  if (!issues.length) return <div className="empty">当前项目尚未检查。</div>;

  return (
    <div className="issue-list">
      {issues.slice(0, 14).map((issue, index) => (
        <div className={`issue ${issue.severity}`} key={`${issue.type}-${index}`}>
          <strong>{issue.severity === "error" ? "错误" : "提醒"} · {issue.type}</strong>
          <span>{issue.message}</span>
        </div>
      ))}
      {issues.length > 14 && <div className="empty">还有 {issues.length - 14} 条未显示。</div>}
    </div>
  );
}

function WorkflowSteps({ activeStep }: { activeStep: number }) {
  const steps = [
    "导入点文件",
    "确认字段映射",
    "展点",
    "生成/审查地物",
    "错误检查",
    "导出"
  ];
  return (
    <nav className="workflow-steps" aria-label="成图流程">
      {steps.map((label, index) => {
        const step = index + 1;
        const className = `workflow-step ${step === activeStep ? "active" : ""} ${step < activeStep ? "done" : ""}`;
        return (
          <div className={className} key={label}>
            <span data-step={step}>第{step}步</span>
            <strong>{label}</strong>
          </div>
        );
      })}
    </nav>
  );
}

function AssistantPanelV2({
  state,
  stepMessage,
  hasSketch,
  sketchAnalyzed,
  sketchObservations,
  sketchUncertainPoints,
  sketchGeneralDescription,
  sketchAnalysisMessage,
  onAnalyzeSketch,
  onConfirmObservation,
  onDeleteObservation,
  onObservationPointIdsChange,
  onObservationTypeChange,
  onConfirmAllAndGenerate,
  onGeneratePlans,
  onSelectPlan,
  onAcceptItem
}: {
  state: AssistantState;
  stepMessage: string;
  hasSketch: boolean;
  sketchAnalyzed: boolean;
  sketchObservations: ObservationItem[];
  sketchUncertainPoints: string[];
  sketchGeneralDescription: string;
  sketchAnalysisMessage: string;
  onAnalyzeSketch: () => void | Promise<void>;
  onConfirmObservation: (observationId: string) => void;
  onDeleteObservation: (observationId: string) => void;
  onObservationPointIdsChange: (observationId: string, value: string) => void;
  onObservationTypeChange: (observationId: string, value: SketchObservationFeatureType) => void;
  onConfirmAllAndGenerate: () => void | Promise<void>;
  onGeneratePlans: () => void | Promise<void>;
  onSelectPlan: (planId: string) => void;
  onAcceptItem: (plan: AssistantPlan, item: AssistantPlanItem) => void;
}) {
  const selectedPlan = state.plans.find((plan) => plan.id === state.selectedPlanId) || null;
  const safeSketchObservations = ensureObservationItems(sketchObservations);
  const safeSketchUncertainPoints = Array.isArray(sketchUncertainPoints) ? sketchUncertainPoints : [];
  return (
    <section className="panel assistant-panel">
      <div className="assistant-panel-header">
        <div>
          <div className="section-title">智能成图方案</div>
          <span>{assistantStepLabel(state.currentStep)}</span>
        </div>
        <div className="scheme-step-badge">4 / 6</div>
      </div>
      <div className="assistant-step-message">{stepMessage}</div>
      {hasSketch && (
        <div className="assistant-item-list">
          <div className="assistant-selected-title">AI草图观察结果，请确认后生成方案</div>
          <button className="primary" onClick={onAnalyzeSketch} disabled={state.isAnalyzing}>
            {state.isAnalyzing ? "分析中..." : "分析草图"}
          </button>
          {sketchAnalysisMessage && <div className="assistant-step-message">{sketchAnalysisMessage}</div>}
          {sketchGeneralDescription && <small>{sketchGeneralDescription}</small>}
          {safeSketchUncertainPoints.length > 0 && (
            <div className="empty warning">以下点号AI不确定：{safeSketchUncertainPoints.join(", ")}，请手动分配</div>
          )}
          {safeSketchObservations.map((observation) => (
            <div className="assistant-item-row" key={observation.id}>
              <div>
                <label>
                  点号列表
                  <input
                    value={observation.pointIds.join(",")}
                    onChange={(event) => onObservationPointIdsChange(observation.id, event.target.value)}
                    placeholder="53,54,55,56"
                  />
                </label>
                <label>
                  地物类型
                  <select
                    value={observation.featureType}
                    onChange={(event) => onObservationTypeChange(observation.id, event.target.value as SketchObservationFeatureType)}
                  >
                    {sketchObservationTypes.map((type) => (
                      <option key={type} value={type}>{type} / {sketchObservationTypeLabels[type]}</option>
                    ))}
                  </select>
                </label>
                <em>{observation.reason || "AI 未给出原因。"}</em>
                <small>{observation.confirmed ? "已确认" : observation.edited ? "已修改，待确认" : "待确认"}</small>
              </div>
              <div className="candidate-actions">
                <button className="primary" onClick={() => onConfirmObservation(observation.id)}>确认</button>
                <button onClick={() => onDeleteObservation(observation.id)}>删除</button>
              </div>
            </div>
          ))}
          {sketchAnalyzed && (
            <button className="primary" onClick={() => onConfirmAllAndGenerate()} disabled={state.isAnalyzing}>
              全部确认并生成方案
            </button>
          )}
        </div>
      )}
      <button className="primary" onClick={() => onGeneratePlans()} disabled={state.isAnalyzing}>
        {state.isAnalyzing ? "分析中..." : "生成推荐方案"}
      </button>
      <div className="assistant-plan-list">
        {state.plans.map((plan) => (
          <div className={`assistant-plan-row ${plan.id === state.selectedPlanId ? "active" : ""}`} key={plan.id}>
            <div>
              <strong>{plan.title}</strong>
              <span>{plan.summary}</span>
              <small>置信度 {Math.round(plan.confidence * 100)}% · {plan.items.length} 项</small>
            </div>
            <button onClick={() => onSelectPlan(plan.id)}>选择</button>
          </div>
        ))}
        {!state.plans.length && <div className="empty">还没有助手方案。点击生成推荐方案后再审查采纳。</div>}
      </div>
      {selectedPlan && (
        <div className="assistant-item-list">
          <div className="assistant-selected-title">当前方案：{selectedPlan.title}</div>
          {selectedPlan.items.map((item) => (
            <div className="assistant-item-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>{candidateTypeLabel(item.type)} · {item.layer} · {item.pointIds.length} 点 · 置信度 {Math.round(item.confidence * 100)}%</span>
                <small>{item.pointIds.join(" - ")}</small>
                <em>{item.reason}</em>
              </div>
              <button className="primary" onClick={() => onAcceptItem(selectedPlan, item)}>采纳为候选</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AssistantPanel({
  state,
  stepMessage,
  onGeneratePlans,
  onSelectPlan,
  onAcceptItem
}: {
  state: AssistantState;
  stepMessage: string;
  onGeneratePlans: () => void | Promise<void>;
  onSelectPlan: (planId: string) => void;
  onAcceptItem: (plan: AssistantPlan, item: AssistantPlanItem) => void;
}) {
  const selectedPlan = state.plans.find((plan) => plan.id === state.selectedPlanId) || null;
  return (
    <section className="panel assistant-panel">
      <div className="assistant-panel-header">
        <div>
          <div className="section-title">助手面板</div>
          <span>{assistantStepLabel(state.currentStep)}</span>
        </div>
        <button className="primary" onClick={() => onGeneratePlans()} disabled={state.isAnalyzing}>
          {state.isAnalyzing ? "分析中..." : "生成推荐方案"}
        </button>
      </div>
      <div className="assistant-step-message">{stepMessage}</div>
      <div className="assistant-plan-list">
        {state.plans.map((plan) => (
          <div className={`assistant-plan-row ${plan.id === state.selectedPlanId ? "active" : ""}`} key={plan.id}>
            <div>
              <strong>{plan.title}</strong>
              <span>{plan.summary}</span>
              <small>置信度 {Math.round(plan.confidence * 100)}% · {plan.items.length} 项</small>
            </div>
            <button onClick={() => onSelectPlan(plan.id)}>选择</button>
          </div>
        ))}
        {!state.plans.length && <div className="empty">还没有助手方案。先生成候选后，可在这里聚合为方案。</div>}
      </div>
      {selectedPlan && (
        <div className="assistant-item-list">
          <div className="assistant-selected-title">当前方案：{selectedPlan.title}</div>
          {selectedPlan.items.map((item) => (
            <div className="assistant-item-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>{candidateTypeLabel(item.type)} · {item.layer} · {item.pointIds.length} 点 · 置信度 {Math.round(item.confidence * 100)}%</span>
                <small>{item.pointIds.join(" - ")}</small>
                <em>{item.reason}</em>
              </div>
              <button className="primary" onClick={() => onAcceptItem(selectedPlan, item)}>采纳为候选</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function assistantStepLabel(step: AssistantStep) {
  if (step === "upload_points") return "第1步：导入点文件";
  if (step === "map_fields") return "第2步：确认字段映射";
  if (step === "upload_sketch") return "第3步：上传草图";
  if (step === "generate_plans") return "第4步：生成方案";
  if (step === "review_accept") return "第5步：审查采纳";
  return "第6步：检查导出";
}

function getWorkflowStep(hasPreview: boolean, pointCount: number, featureCount: number, checkState: CheckState) {
  if (!pointCount) return hasPreview ? 2 : 1;
  if (!featureCount) return 4;
  if (checkState === "passed") return 6;
  return 5;
}

function getAssistantStep(hasPreview: boolean, pointCount: number, featureCount: number): AssistantStep {
  if (!pointCount) return hasPreview ? "map_fields" : "upload_points";
  if (!featureCount) return "generate_plans";
  return "check_export";
}

function checkStateFromValidation(validation: ValidationResult): CheckState {
  return validation.errors.length || validation.warnings.length ? "issues" : "passed";
}

function getCheckSummary(checkState: CheckState, validation: ValidationResult) {
  if (checkState === "idle") return "尚未检查";
  if (checkState === "passed") return "检查通过，未发现问题";
  if (checkState === "error") return "检查失败";
  return `${validation.errors.length} 个错误，${validation.warnings.length} 个提醒`;
}

function getExportSummary(pointCount: number, featureCount: number, checkState: CheckState, validation: ValidationResult) {
  const prefix = `当前项目包含 ${pointCount} 个点、${featureCount} 个地物`;
  if (checkState === "idle") return `${prefix}，当前项目尚未检查。`;
  if (checkState === "passed") return `${prefix}，0 个错误，0 个提醒。`;
  if (checkState === "error") return `${prefix}，检查失败。`;
  return `${prefix}，${validation.errors.length} 个错误，${validation.warnings.length} 个提醒。`;
}

function candidateRangeText(candidate: CandidateFeature) {
  if (!candidate.pointIds.length) return "0 点";
  const first = candidate.pointIds[0];
  const last = candidate.pointIds[candidate.pointIds.length - 1];
  return first === last ? first : `${first}-${last}`;
}

function candidateSourceLabel(source: CandidateFeature["source"]) {
  if (source === "point_sequence") return "连续点号";
  if (source === "note") return "备注";
  if (source === "sketch_markup") return "草图标注";
  return "编码";
}

function assistantPlanSourceToCandidateSource(
  source: AssistantPlan["source"],
  item: AssistantPlanItem,
  candidates: CandidateFeature[]
): CandidateFeature["source"] {
  const sourceCandidate = item.sourceCandidateIds
    ?.map((candidateId) => candidates.find((candidate) => candidate.id === candidateId))
    .find((candidate): candidate is CandidateFeature => Boolean(candidate));
  if (sourceCandidate) return sourceCandidate.source;
  if (source === "local_point_sequence") return "point_sequence";
  if (source === "local_sketch_markup") return "sketch_markup";
  return "note";
}

function candidateToFeature(candidate: CandidateFeature, index: number, availablePointIds: string[]): { feature?: Feature; error?: string } {
  const available = new Set(availablePointIds);
  const missingIds = candidate.pointIds.filter((id) => !available.has(id));
  if (missingIds.length) {
    return { error: `缺少点号 ${uniqueInOrder(missingIds).join("、")}` };
  }

  const spec = FEATURE_TYPES[candidate.type];
  const uniquePointCount = new Set(candidate.pointIds).size;
  if (spec.point && uniquePointCount < 1) {
    return { error: "点状地物少于 1 个点" };
  }
  if (!spec.point && candidate.closed && uniquePointCount < 3) {
    return { error: "闭合地物少于 3 个不同点" };
  }
  if (!spec.point && !candidate.closed && uniquePointCount < 2) {
    return { error: "线状地物少于 2 个不同点" };
  }

  return {
    feature: {
      id: `feature_${Date.now()}_${index}`,
      type: candidate.type,
      name: candidate.name,
      pointIds: spec.point
        ? [candidate.pointIds[0]]
        : candidate.closed && candidate.pointIds[0] !== candidate.pointIds[candidate.pointIds.length - 1]
        ? [...candidate.pointIds, candidate.pointIds[0]]
        : candidate.pointIds,
      closed: candidate.closed,
      layer: candidate.layer || spec.layer,
      note: candidate.reason
    }
  };
}

function markCandidateStatus(candidate: CandidateFeature, status: CandidateStatus, acceptedFeatureId?: string): CandidateFeature {
  return {
    ...candidate,
    status,
    acceptedFeatureId: status === "accepted" ? acceptedFeatureId : undefined
  };
}

function resolveCandidateEditInput(input: string, availablePointIds: string[]) {
  const normalized = input.trim().replace(/\s*-\s*/g, "-");
  if (!normalized) {
    return { pointIds: [], missingIds: [], error: "请输入候选点号序列，例如 69,70,72。" };
  }

  const available = new Set(availablePointIds);
  const tokens = normalized.split(/[\s,，;；]+/).map((token) => token.trim()).filter(Boolean);
  const pointIds: string[] = [];
  const missingIds: string[] = [];

  for (const token of tokens) {
    const range = parseCandidateRangeToken(token);
    if (range.error) {
      return { pointIds: [], missingIds: [], error: range.error };
    }
    const ids = range.ids.length ? range.ids : [token];
    for (const id of ids) {
      if (available.has(id)) {
        pointIds.push(id);
      } else {
        missingIds.push(id);
      }
    }
  }

  return {
    pointIds,
    missingIds: uniqueInOrder(missingIds)
  };
}

function parseCandidateRangeToken(token: string): { ids: string[]; error?: string } {
  if (!token.includes("-")) return { ids: [] };

  const match = token.match(/^(\d+)-(\d+)$/);
  if (!match) {
    return { ids: [], error: `点号范围 ${token} 格式不正确，请使用 69-76 这种数字范围。` };
  }

  const startText = match[1];
  const endText = match[2];
  const start = Number(startText);
  const end = Number(endText);
  const step = start <= end ? 1 : -1;
  const width = Math.max(startText.length, endText.length);
  const ids: string[] = [];

  for (let value = start; step > 0 ? value <= end : value >= end; value += step) {
    ids.push(String(value).padStart(width, "0"));
  }

  return { ids };
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

function normalizeBox(box: BoxRect) {
  const x = Math.min(box.x, box.x + box.width);
  const y = Math.min(box.y, box.y + box.height);
  return {
    x,
    y,
    width: Math.abs(box.width),
    height: Math.abs(box.height)
  };
}

function cloneFeatures(features: Feature[]) {
  return features.map((feature) => ({
    ...feature,
    pointIds: [...feature.pointIds]
  }));
}

function cloneCandidates(candidates: CandidateFeature[]) {
  return candidates.map((candidate) => ({
    ...candidate,
    pointIds: [...candidate.pointIds]
  }));
}

function cloneValidation(validation: ValidationResult): ValidationResult {
  return {
    errors: validation.errors.map((issue) => ({ ...issue })),
    warnings: validation.warnings.map((issue) => ({ ...issue }))
  };
}

function latestSketchAttachment(attachments: ProjectAttachment[]) {
  const sketches = attachments.filter(isSketchAttachment);
  return sketches[sketches.length - 1] || null;
}

function normalizeObservationItem(
  observation: { pointIds: string[]; featureType: string; label: string; reason: string },
  index: number
): ObservationItem {
  const featureType = isSketchObservationFeatureType(observation.featureType) ? observation.featureType : "unknown";
  return {
    id: `sketch_observation_${Date.now()}_${index}`,
    pointIds: observation.pointIds.map((pointId) => String(pointId)).filter(Boolean),
    featureType,
    label: observation.label || sketchObservationTypeLabels[featureType],
    reason: observation.reason || "",
    confirmed: false,
    edited: false
  };
}

function isSketchObservationFeatureType(value: string): value is SketchObservationFeatureType {
  return sketchObservationTypes.includes(value as SketchObservationFeatureType);
}

function ensureObservationItems(value: unknown): ObservationItem[] {
  return Array.isArray(value) ? value.filter(isObservationItem) : [];
}

function isObservationItem(value: unknown): value is ObservationItem {
  return Boolean(value && typeof value === "object" && "id" in value && "pointIds" in value);
}

function parsePointList(value: string) {
  return value.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean);
}

const SKETCH_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const SKETCH_IMAGE_MAX_EDGE = 2200;
const SKETCH_SPLIT_HEIGHT_THRESHOLD = 1500;

async function compressedSketchImagePartsFromDataUrl(
  dataUrl: string,
  fallbackMime: string,
  onProgress?: (message: string) => void
): Promise<SketchImagePartPayload[]> {
  try {
    const image = await loadImage(dataUrl);
    if ((image.naturalHeight || 0) <= SKETCH_SPLIT_HEIGHT_THRESHOLD) {
      onProgress?.("正在分析草图完整图...");
      const payload = await compressedImagePayloadFromDataUrl(dataUrl, fallbackMime);
      return payload ? [{ ...payload, label: "完整图" }] : [];
    }

    const splitY = Math.floor(image.naturalHeight / 2);
    const sourceParts = [
      { label: "上半部分", x: 0, y: 0, width: image.naturalWidth, height: splitY },
      { label: "下半部分", x: 0, y: splitY, width: image.naturalWidth, height: image.naturalHeight - splitY }
    ];
    const payloads: SketchImagePartPayload[] = [];
    for (const part of sourceParts) {
      onProgress?.(`正在分析草图${part.label}...`);
      const dataUrlPart = cropImageToDataUrl(image, part.x, part.y, part.width, part.height);
      const payload = await compressedImagePayloadFromDataUrl(dataUrlPart, fallbackMime);
      if (payload) payloads.push({ ...payload, label: part.label });
    }
    return payloads;
  } catch {
    return [];
  }
}

function cropImageToDataUrl(image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

async function compressedImagePayloadFromDataUrl(dataUrl: string, fallbackMime: string, maxBytes = SKETCH_IMAGE_MAX_BYTES) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
  if (!match) return null;
  const originalPayload = {
    imageMime: match[1] || fallbackMime,
    imageBase64: match[2]
  };
  const image = await loadImage(dataUrl);
  const originalBytes = base64ByteLength(originalPayload.imageBase64);
  const originalInfo = {
    width: image.naturalWidth || 1,
    height: image.naturalHeight || 1,
    bytes: originalBytes
  };
  const initialScale = Math.min(1, SKETCH_IMAGE_MAX_EDGE / Math.max(originalInfo.width, originalInfo.height));
  if (originalBytes <= maxBytes && initialScale === 1) {
    logSketchCompression(originalInfo, { ...originalInfo, bytes: originalBytes }, originalPayload.imageMime, null);
    return originalPayload;
  }

  let scale = initialScale;
  let bestPayload = originalPayload;
  let bestInfo = {
    width: Math.max(1, Math.round(originalInfo.width * scale)),
    height: Math.max(1, Math.round(originalInfo.height * scale)),
    bytes: originalBytes
  };
  let bestQuality: number | null = null;
  const qualities = [0.85, 0.78, 0.7, 0.62, 0.54, 0.46];

  for (let round = 0; round < 6; round += 1) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) break;
    context.drawImage(image, 0, 0, width, height);

    for (const quality of qualities) {
      const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
      const payload = imagePayloadFromDataUrl(compressedDataUrl, "image/jpeg");
      if (!payload) continue;
      bestPayload = payload;
      bestInfo = { width, height, bytes: base64ByteLength(payload.imageBase64) };
      bestQuality = quality;
      if (bestInfo.bytes <= maxBytes) {
        logSketchCompression(originalInfo, bestInfo, payload.imageMime, bestQuality);
        return payload;
      }
    }
    scale *= 0.85;
  }
  logSketchCompression(originalInfo, bestInfo, bestPayload.imageMime, bestQuality);
  return bestPayload;
}

function logSketchCompression(
  original: { width: number; height: number; bytes: number },
  output: { width: number; height: number; bytes: number },
  imageMime: string,
  quality: number | null
) {
  console.info("[sketch-compression]", {
    originalSize: `${original.width}x${original.height}`,
    outputSize: `${output.width}x${output.height}`,
    originalBytes: original.bytes,
    outputBytes: output.bytes,
    originalMB: bytesToMegabytes(original.bytes),
    outputMB: bytesToMegabytes(output.bytes),
    imageMime,
    quality
  });
}

function bytesToMegabytes(bytes: number) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

function imagePayloadFromDataUrl(dataUrl: string, fallbackMime: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
  if (!match) return null;
  return {
    imageMime: match[1] || fallbackMime,
    imageBase64: match[2]
  };
}

function base64ByteLength(base64: string) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("草图图片压缩失败"));
    image.src = src;
  });
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number(value.toFixed(2))));
}

function isRectGeometry(geometry: SketchMarkupGeometry): geometry is { x: number; y: number; width: number; height: number } {
  return "x" in geometry && "y" in geometry && "width" in geometry && "height" in geometry;
}

function isPointsGeometry(geometry: SketchMarkupGeometry): geometry is { points: { x: number; y: number }[] } {
  return "points" in geometry && Array.isArray(geometry.points);
}

function isUsableMarkupGeometry(type: SketchMarkupType, geometry: SketchMarkupGeometry) {
  if (type === "rect" && isRectGeometry(geometry)) return geometry.width >= 8 && geometry.height >= 8;
  if (type === "line" && isPointsGeometry(geometry) && geometry.points.length >= 2) {
    const [start, end] = geometry.points;
    return Math.hypot(end.x - start.x, end.y - start.y) >= 8;
  }
  return type === "point";
}

function markupLabelPoint(markup: SketchMarkup) {
  if (isRectGeometry(markup.geometry)) {
    return { x: markup.geometry.x, y: markup.geometry.y };
  }
  if (isPointsGeometry(markup.geometry) && markup.geometry.points[0]) {
    return markup.geometry.points[0];
  }
  return { x: 0, y: 0 };
}

function markupBindingSummary(markup: SketchMarkup, linkedFeatureName?: string, linkedFeatureMissing?: boolean) {
  const points = markup.linkedPointIds.length ? `已绑定点号：${markup.linkedPointIds.join("、")}` : "尚未绑定点号";
  if (linkedFeatureMissing) return `${points}；绑定的地物已不存在。`;
  if (linkedFeatureName) return `${points}；已绑定地物：${linkedFeatureName}`;
  return points;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|\s]+/g, "_") || "cass_project";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
