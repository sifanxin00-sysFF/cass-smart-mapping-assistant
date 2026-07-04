import type { SurveyPoint } from "../types/project";
import type { PointerEvent, WheelEvent } from "react";

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 620;

export type ViewState = {
  zoom: number;
  panX: number;
  panY: number;
};

export type ScreenPoint = {
  id: string;
  x: number;
  y: number;
  point: SurveyPoint;
};

export function projectPoints(points: SurveyPoint[], width: number, height: number, view: ViewState): ScreenPoint[] {
  if (!points.length) return [];

  const bounds = getBounds(points);
  const margin = 54;
  const eastSpan = Math.max(bounds.maxEast - bounds.minEast, 1);
  const northSpan = Math.max(bounds.maxNorth - bounds.minNorth, 1);
  const baseScale = Math.min((width - margin * 2) / eastSpan, (height - margin * 2) / northSpan);
  const plottedWidth = eastSpan * baseScale * view.zoom;
  const plottedHeight = northSpan * baseScale * view.zoom;
  const centerX = (width - plottedWidth) / 2;
  const centerY = (height - plottedHeight) / 2;

  return points.map((point) => ({
    id: point.id,
    x: (point.east - bounds.minEast) * baseScale * view.zoom + centerX + view.panX,
    y: (bounds.maxNorth - point.north) * baseScale * view.zoom + centerY + view.panY,
    point
  }));
}

export function getBounds(points: SurveyPoint[]) {
  return {
    minEast: Math.min(...points.map((point) => point.east)),
    maxEast: Math.max(...points.map((point) => point.east)),
    minNorth: Math.min(...points.map((point) => point.north)),
    maxNorth: Math.max(...points.map((point) => point.north))
  };
}

export function pointInRect(point: ScreenPoint, rect: { x: number; y: number; width: number; height: number }) {
  const x1 = Math.min(rect.x, rect.x + rect.width);
  const x2 = Math.max(rect.x, rect.x + rect.width);
  const y1 = Math.min(rect.y, rect.y + rect.height);
  const y2 = Math.max(rect.y, rect.y + rect.height);
  return point.x >= x1 && point.x <= x2 && point.y >= y1 && point.y <= y2;
}

export function svgPoint(event: PointerEvent<SVGSVGElement> | WheelEvent<SVGSVGElement>, svg: SVGSVGElement) {
  const rect = svg.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
  const y = ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;
  return { x, y };
}
