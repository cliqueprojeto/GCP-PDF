import type { FieldType, FontFamily, ShapeKind } from "../shared/types";
export type Tool =
  | { kind: "select" }
  | { kind: "edit"; mode?: "all" | "text" | "images" }
  | { kind: "text" }
  | { kind: "shape"; shape: ShapeKind; measure?: "distance" | "perimeter" | "area" }
  | { kind: "ink" }
  | { kind: "markup"; style: "highlight" | "underline" | "strike" }
  | { kind: "stamp"; dataUrl: string; name: string; signature: boolean; natural?: boolean }
  | { kind: "field"; field: FieldType }
  | { kind: "sign-area" }
  | { kind: "note" }
  /** Positioning a certificate signature: a ghost of the real stamp follows the pointer; a click signs there. */
  | { kind: "sign-place"; width: number; height: number; lines: string[]; image?: string };
export interface Style {
  stroke: string;
  fill: string | null;
  strokeWidth: number;
  opacity: number;
  highlight: string;
  highlightOpacity: number;
  font: FontFamily;
  size: number;
  textColor: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
}
export const DEFAULT_STYLE: Style = {
  stroke: "#e5484d",
  fill: null,
  strokeWidth: 2,
  opacity: 1,
  highlight: "#ffe066",
  highlightOpacity: 0.45,
  font: "sans",
  size: 14,
  textColor: "#1f1a2e",
  bold: false,
  italic: false,
  align: "left",
};
export const PALETTE = ["#ffe066", "#4f8cff", "#3ecf6e", "#e5484d", "#ff9f1a", "#a855f7", "#1f1a2e", "#ffffff"];
export const SHAPES: { shape: ShapeKind; label: string }[] = [
  { shape: "rect", label: "Retângulo" },
  { shape: "ellipse", label: "Oval" },
  { shape: "line", label: "Linha" },
  { shape: "arrow", label: "Seta" },
  { shape: "polyline", label: "Linhas conectadas" },
  { shape: "cloud", label: "Nuvem" },
  { shape: "polygon", label: "Polígono" },
  { shape: "check", label: "Marca de seleção" },
  { shape: "cross", label: "Marca cruzada" },
];
export const uid = () => crypto.randomUUID();

