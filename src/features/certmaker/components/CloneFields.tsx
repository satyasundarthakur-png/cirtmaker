import { Button } from "@/components/ui/button";
import type { CertData, CloneTextField } from "../lib/types";

interface Props {
  data: CertData;
  setData: (fn: (p: CertData) => CertData) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

export default function CloneFields({ data, setData, selected, onSelect }: Props) {
  const clone = data.clone;
  if (!clone) return <p className="text-sm text-muted">No original certificate loaded.</p>;
  function update(id: string, patch: Partial<CloneTextField>) {
    setData((p) => p.clone ? { ...p, clone: { ...p.clone, fields: p.clone.fields.map((f) => f.id === id ? { ...f, ...patch } : f) } } : p);
  }
  return <div className="grid gap-3">
    <p className="text-xs text-muted">{clone.fields.length} text fields · {clone.filename}</p>
    {!clone.fields.length && <p role="status" className="text-sm text-muted">No text detected. The original remains unchanged.</p>}
    {clone.fields.map((field, i) => <div key={field.id} className="grid min-w-0 gap-2 border-b border-line pb-3">
      <label htmlFor={field.id} className="text-xs font-semibold text-muted">Text {i + 1}: <span className="break-words">{field.original}</span></label>
      <input id={field.id} className="field" value={field.replacement} onFocus={() => onSelect(field.id)} onChange={(e) => update(field.id, { replacement: e.target.value })} />
      {selected === field.id && <>
        <div className="flex gap-3 text-xs">
          <label className="flex items-center gap-1">Text<input aria-label={`Text ${i + 1} ink`} type="color" value={field.color} onChange={(e) => update(field.id, { color: e.target.value })} /></label>
          <label className="flex items-center gap-1">Cover<input aria-label={`Text ${i + 1} cover`} type="color" value={field.cover} onChange={(e) => update(field.id, { cover: e.target.value })} /></label>
        </div>
        <select aria-label={`Text ${i + 1} font`} className="field" value={field.font} onChange={(e) => update(field.id, { font: e.target.value })}>
          {['Inter', 'serif', 'Playfair Display', 'Great Vibes', 'Cormorant Garamond', 'Montserrat', 'Noto Sans Oriya', 'Noto Sans Devanagari'].map((font) => <option key={font}>{font}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          {(['x', 'y', 'w', 'h', 'fontSize'] as const).map((key) => <label key={key} className="text-xs text-muted">{{x: 'Left', y: 'Top', w: 'Width', h: 'Height', fontSize: 'Font size'}[key]}<input className="field" type="number" min={key === 'x' || key === 'y' ? 0 : 1} value={Math.round(field[key])} onChange={(e) => update(field.id, { [key]: Math.max(key === 'x' || key === 'y' ? 0 : 1, Number(e.target.value)) })} /></label>)}
        </div>
        <Button variant="certificate" size="certificate" className="justify-self-start text-xs text-brand underline" onClick={() => update(field.id, { replacement: field.original })}>Restore original text</Button>
      </>}
    </div>)}
  </div>;
}