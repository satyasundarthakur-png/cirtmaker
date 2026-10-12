import type { CloneSource, CloneTextField } from "../types";
export type LayerStyle = Pick<
  CloneTextField,
  | "font"
  | "fontSize"
  | "bold"
  | "italic"
  | "align"
  | "color"
  | "fontWeight"
  | "letterSpacing"
  | "lineHeight"
  | "opacity"
  | "textEffects"
>;
export type EditCommand =
  | { type: "replace"; text: string; targets?: string[] }
  | { type: "add"; text: string; x?: number; y?: number }
  | { type: "delete" | "duplicate" | "lock" | "match"; targets?: string[] }
  | { type: "move"; dx: number; dy: number; targets?: string[] }
  | { type: "resize"; width?: number; height?: number; scale?: number; targets?: string[] }
  | { type: "rotate"; degrees: number; targets?: string[] }
  | { type: "style"; style: Partial<LayerStyle>; targets?: string[] }
  | { type: "align"; axis: "horizontal" | "vertical" | "center"; targets?: string[] };
export interface Selection {
  ids: string[];
  primary: string | null;
  reference: string | null;
}
export interface LayerDiff {
  id: string;
  label: string;
  before: CloneTextField | null;
  after: CloneTextField | null;
  properties: string[];
}
export interface EditPlan {
  revision: string;
  selection: Selection;
  commands: EditCommand[];
  changes: LayerDiff[];
  warnings: string[];
  next: CloneSource;
  summary: string;
}
export interface StyleMatch {
  font: string;
  score: number;
  confidence: number;
  style: LayerStyle;
  source: "editable-properties" | "raster-similarity";
  explanation: string;
}
