import { Button } from "@/components/ui/button";
import type { CertData } from "@/features/certmaker/lib/types";
import { FX_OPTIONS, type FxType } from "@/features/certmaker/lib/effects";
import { REGION_LABELS } from "@/features/certmaker/lib/render";
import { METALS, SWATCHES } from "@/features/certmaker/lib/metals";

interface Props {
  data: CertData;
  setData: (fn: (p: CertData) => CertData) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
}

export default function EffectsPanel({ data, setData, selected, setSelected }: Props) {
  const ids = Object.keys(REGION_LABELS).filter((id) => id !== "seal" || data.showSeal);
  const cur = selected ? data.fx[selected] : undefined;
  const type: FxType = cur?.type ?? "none";
  const amount = cur?.amount ?? 60;

  const set = (id: string, t: FxType, a: number) =>
    setData((p) => ({ ...p, fx: { ...p.fx, [id]: { type: t, amount: a } } }));

  const setColor = (id: string, v: string | null) =>
    setData((p) => {
      const colors = { ...p.colors };
      if (v) colors[id] = v;
      else delete colors[id];
      return { ...p, colors };
    });
  const curColor = selected ? data.colors[selected] : undefined;
  const metalGrad: Record<string, string> = Object.fromEntries(
    METALS.map((m) => [m.id, `linear-gradient(135deg, ${m.stops[0]}, ${m.stops[1]} 30%, ${m.stops[2]} 50%, ${m.stops[3]} 70%, ${m.stops[5]})`]),
  );

  const textIds = ids.filter((i) => i !== "seal");
  const active = Object.entries(data.fx).filter(([, v]) => v.type !== "none").length;

  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted">Click any part of the certificate in the preview, or pick it below, then choose its colour and effect.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Part of the certificate">
        {ids.map((id) => (
          <Button variant="certificate" size="certificate" key={id} type="button" className="chip" aria-pressed={selected === id} onClick={() => setSelected(selected === id ? null : id)}>
            {REGION_LABELS[id]}
            {(data.fx[id] && data.fx[id].type !== "none") || data.colors[id] ? " ✦" : ""}
          </Button>
        ))}
      </div>

      {selected ? (
        <>
          <div>
            <span className="label">Colour of {(REGION_LABELS[selected] ?? selected).toLowerCase()}</span>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(34px,1fr))] gap-2" role="group" aria-label="Colour">
              <Button variant="certificate" size="certificate" type="button" title="Default for this template" aria-label="Default colour" aria-pressed={!curColor} onClick={() => setColor(selected, null)} className={`grid h-8 place-items-center rounded-full border-2 bg-card text-[10px] font-semibold ${!curColor ? "border-ink" : "border-line"}`}>Auto</Button>
              {METALS.map((m) => (
                <Button variant="certificate" size="certificate" key={m.id} type="button" title={m.label} aria-label={m.label} aria-pressed={curColor === `metal:${m.id}`} onClick={() => setColor(selected, `metal:${m.id}`)} className={`h-8 rounded-full border-2 ${curColor === `metal:${m.id}` ? "border-ink" : "border-card ring-1 ring-line"}`} style={{ background: metalGrad[m.id] }} />
              ))}
              {SWATCHES.map((c) => (
                <Button variant="certificate" size="certificate" key={c.hex} type="button" title={c.label} aria-label={c.label} aria-pressed={curColor === c.hex} onClick={() => setColor(selected, c.hex)} className={`h-8 rounded-full border-2 ${curColor === c.hex ? "border-ink" : "border-card ring-1 ring-line"}`} style={{ background: c.hex }} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-2">
                <input type="color" aria-label="Custom colour" value={curColor && curColor.startsWith("#") ? curColor : "#b8892f"} onChange={(e) => setColor(selected, e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent p-0" />
                Any colour
              </label>
              {curColor && (
                <Button variant="certificate" size="certificate" type="button" className="text-brand underline" onClick={() => setData((p) => ({ ...p, colors: Object.fromEntries(textIds.map((i) => [i, curColor])) }))}>
                  Use this colour on all text
                </Button>
              )}
            </div>
          </div>

          <div role="radiogroup" aria-label={`Effect for ${REGION_LABELS[selected]}`} className="grid grid-cols-2 gap-2">
            {FX_OPTIONS.map((o) => (
              <Button variant="certificate" size="certificate"
                key={o.id}
                type="button"
                role="radio"
                aria-checked={type === o.id}
                onClick={() => set(selected, o.id, amount)}
                className={`rounded-lg border p-2.5 text-left transition hover:border-ink/40 ${type === o.id ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-line bg-card"}`}
              >
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </Button>
            ))}
          </div>
          {type !== "none" && (
            <div>
              <label htmlFor="fxamt" className="label">Strength: {amount}</label>
              <input id="fxamt" type="range" min={5} max={100} step={5} value={amount} onChange={(e) => set(selected, type, +e.target.value)} className="w-full accent-brand" />
            </div>
          )}
        </>
      ) : (
        <p className="rounded-lg border border-dashed border-line p-3 text-center text-sm text-muted">Nothing selected</p>
      )}

      <div className="flex flex-wrap gap-2">
        {selected && type !== "none" && (
          <Button variant="certificate" size="certificate" type="button" className="btn" onClick={() => setData((p) => ({ ...p, fx: Object.fromEntries(textIds.map((i) => [i, { type, amount }])) as CertData["fx"] }))}>
            Apply to all text
          </Button>
        )}
        {Object.keys(data.colors).length > 0 && (
          <Button variant="certificate" size="certificate" type="button" className="btn" onClick={() => setData((p) => ({ ...p, colors: {} }))}>
            Reset colours
          </Button>
        )}
        {active > 0 && (
          <Button variant="certificate" size="certificate" type="button" className="btn" onClick={() => setData((p) => ({ ...p, fx: {} }))}>
            Clear all effects ({active})
          </Button>
        )}
      </div>
    </div>
  );
}
