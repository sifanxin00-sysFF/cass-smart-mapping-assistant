import type { Feature } from "../types/project";

export const CONTROLLED_LAYERS = ["BUILDING", "ROAD", "GREEN", "TREE", "MANHOLE", "DEFAULT"] as const;

export type ControlledLayer = typeof CONTROLLED_LAYERS[number];
export type LayerVisibility = Record<ControlledLayer, boolean>;

export const defaultLayerVisibility: LayerVisibility = {
  BUILDING: true,
  ROAD: true,
  GREEN: true,
  TREE: true,
  MANHOLE: true,
  DEFAULT: true
};

export function isFeatureVisible(feature: Feature, visibility: LayerVisibility) {
  return visibility[feature.layer as ControlledLayer] ?? true;
}
