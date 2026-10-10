import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import type { CertData } from "@/features/certmaker/lib/types";
import { THEMES, themeFromCustom, type Theme } from "@/features/certmaker/lib/themes";
import { renderToCanvas } from "@/features/certmaker/lib/render";

interface Props {
  data: CertData;
  onPick: (id: string, accent: string) => void;
}

export default function TemplatePicker({ data, onPick }: Props) {
  const list: Theme[] = data.custom ? [themeFromCustom(data.custom), ...THEMES] : THEMES;
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const out: Record<string, string> = {};
      for (const th of list) {
        if (!live) return;
        const c = document.createElement("canvas");
        await renderToCanvas(c, { ...data, template: th.id, bgMode: th.id === data.template ? data.bgMode : "recreate", accent: th.id === data.template ? data.accent : th.accent }, 360);
        out[th.id] = c.toDataURL("image/jpeg", 0.8);
      }
      if (live) setThumbs(out);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [data]);

  return (
    <div className="grid grid-cols-2 gap-3">
      {list.map((t) => {
        const on = data.template === t.id;
        return (
          <Button variant="certificate" size="certificate"
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(t.id, t.accent)}
            className={`flex-col items-stretch gap-0 overflow-hidden rounded-lg border bg-card text-left transition hover:border-ink/40 ${on ? "border-brand ring-2 ring-brand" : "border-line"}`}
          >
            <div className="aspect-[1.414] w-full bg-paper">{thumbs[t.id] && <img src={thumbs[t.id]} alt="" className="h-full w-full object-cover" />}</div>
            <span className="block px-2.5 py-1.5 text-xs font-semibold">{t.id === "inspired" ? "Inspired (yours)" : t.name}</span>
          </Button>
        );
      })}
    </div>
  );
}
