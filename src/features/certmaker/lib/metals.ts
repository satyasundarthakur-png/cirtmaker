export interface Metal {
  id: string;
  label: string;
  base: string;
  stops: string[]; // six stops at 0, .22, .45, .62, .82, 1
}

export const METALS: Metal[] = [
  { id: "gold", label: "Gold", base: "#c9a24a", stops: ["#f7e08a", "#c9a24a", "#8a6a1f", "#f1d77a", "#b88a2e", "#7a5a18"] },
  { id: "silver", label: "Silver", base: "#b5bbc4", stops: ["#ffffff", "#b5bbc4", "#7d848e", "#eceff3", "#a3aab4", "#6d737c"] },
  { id: "bronze", label: "Bronze", base: "#b0703a", stops: ["#f0b886", "#b0703a", "#6e3f1a", "#e7a46a", "#9a5e2c", "#5f3414"] },
  { id: "rosegold", label: "Rose gold", base: "#d9958a", stops: ["#ffd9d0", "#d9958a", "#8f5148", "#f6c3b9", "#c47f74", "#85463d"] },
];

export const metalById = (id: string) => METALS.find((m) => m.id === id);

const POS = [0, 0.22, 0.45, 0.62, 0.82, 1];

export function metalGradient(c: CanvasRenderingContext2D, m: Metal, x: number, y: number, w: number, h: number) {
  const g = c.createLinearGradient(x, y, x + w * 0.6, y + h * 1.6);
  m.stops.forEach((s, i) => g.addColorStop(POS[i], s));
  return g;
}

export const SWATCHES: { label: string; hex: string }[] = [
  { label: "Black", hex: "#111111" },
  { label: "Charcoal", hex: "#3a3a3c" },
  { label: "Grey", hex: "#7b7f87" },
  { label: "White", hex: "#ffffff" },
  { label: "Cream", hex: "#f4ead0" },
  { label: "Brown", hex: "#6b4226" },
  { label: "Maroon", hex: "#7a1f2b" },
  { label: "Crimson", hex: "#c0182f" },
  { label: "Red", hex: "#e53935" },
  { label: "Coral", hex: "#ff6b57" },
  { label: "Orange", hex: "#f57c00" },
  { label: "Amber", hex: "#ffb300" },
  { label: "Yellow", hex: "#f9d71c" },
  { label: "Lime", hex: "#a6d608" },
  { label: "Green", hex: "#2e9e4f" },
  { label: "Emerald", hex: "#0b6b4d" },
  { label: "Teal", hex: "#0f7c80" },
  { label: "Cyan", hex: "#16b5d8" },
  { label: "Sky", hex: "#3b9ae1" },
  { label: "Blue", hex: "#1f5fd1" },
  { label: "Navy", hex: "#14213d" },
  { label: "Indigo", hex: "#3f3fb5" },
  { label: "Violet", hex: "#7c4ddb" },
  { label: "Purple", hex: "#5b2a86" },
  { label: "Magenta", hex: "#c2185b" },
  { label: "Pink", hex: "#f06fa5" },
];
