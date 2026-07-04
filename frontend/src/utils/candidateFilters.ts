import { FEATURE_TYPES, type CandidateFeature, type CandidateStatus, type FeatureType } from "../types/project";

export type CandidateSourceFilter = "all" | CandidateFeature["source"];
export type CandidateStatusFilter = "all" | CandidateStatus;
export type CandidateTypeFilter = "all" | FeatureType;

export type CandidateFilters = {
  source: CandidateSourceFilter;
  status: CandidateStatusFilter;
  type: CandidateTypeFilter;
};

export type CandidateStats = {
  total: number;
  pending: number;
  accepted: number;
  ignored: number;
};

export const defaultCandidateFilters: CandidateFilters = {
  source: "all",
  status: "pending",
  type: "all"
};

export function filterCandidates(candidates: CandidateFeature[], filters: CandidateFilters) {
  return candidates.filter((candidate) => {
    if (filters.source !== "all" && candidate.source !== filters.source) return false;
    if (filters.status !== "all" && candidate.status !== filters.status) return false;
    if (filters.type !== "all" && candidate.type !== filters.type) return false;
    return true;
  });
}

export function summarizeCandidates(candidates: CandidateFeature[]): CandidateStats {
  return candidates.reduce<CandidateStats>(
    (stats, candidate) => {
      stats.total += 1;
      stats[candidate.status] += 1;
      return stats;
    },
    { total: 0, pending: 0, accepted: 0, ignored: 0 }
  );
}

export function candidateStatusLabel(status: CandidateStatus) {
  if (status === "pending") return "未处理";
  if (status === "accepted") return "已采纳";
  return "已忽略";
}

export function candidateTypeLabel(type: FeatureType) {
  return FEATURE_TYPES[type]?.label || type;
}
