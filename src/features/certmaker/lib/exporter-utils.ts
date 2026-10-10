export function fileSafe(s: string) {
  return s.replace(/[\\/:*?"<>|\n\r\t]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
}

export function nextId(base: string, i: number) {
  const m = base.match(/(\d+)(\D*)$/);
  if (!m || !m[1]) return base ? `${base}-${i + 1}` : "";
  const n = String(parseInt(m[1], 10) + i).padStart(m[1].length, "0");
  return base.slice(0, m.index) + n + m[2];
}
