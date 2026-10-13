import type { DetectView } from "../lib/clone-debug";
import type { CloneSource, CloneTextField } from "../lib/types";

interface Props {
  clone: CloneSource;
  view: Exclude<DetectView, "off">;
  onAssignName?: ((id: string) => void) | undefined;
}

/**
 * Debug overlay: every detected region with its label and confidence. In "pickName" mode each
 * region is a button; clicking the real name marks it as the Candidate name.
 */
export default function DetectionLayer({ clone, view, onAssignName }: Props) {
  const all: { f: CloneTextField; other: boolean }[] = [
    ...clone.fields.filter((f) => !f.deleted).map((f) => ({ f, other: false })),
    ...clone.suggestions.map((f) => ({ f, other: true })),
  ];
  const picking = view === "pickName";
  return (
    <div className="absolute inset-0" style={{ pointerEvents: picking ? "auto" : "none" }}>
      {all.map(({ f, other }) => {
        const d = f.detection;
        const rejected = !!d && !d.accepted && d.rawKind === "name";
        const tone = rejected
          ? "border-red-500 bg-red-500/10"
          : other
            ? "border-slate-400 bg-slate-400/10"
            : f.kind === "name"
              ? "border-emerald-500 bg-emerald-500/15"
              : "border-sky-500 bg-sky-500/10";
        const tag = `${rejected ? "✗ " : ""}${other ? "other" : f.kind}${d ? ` · ${d.confidence}%` : ""}`;
        const style = {
          left: `${(f.x / clone.width) * 100}%`,
          top: `${(f.y / clone.height) * 100}%`,
          width: `${(f.w / clone.width) * 100}%`,
          height: `${(f.h / clone.height) * 100}%`,
        };
        const common = `absolute rounded-[2px] border-2 ${tone}`;
        const label = (
          <span className="pointer-events-none absolute -top-4 left-0 z-20 max-w-[16rem] truncate whitespace-nowrap rounded bg-card/95 px-1 text-[9px] font-semibold text-foreground shadow">
            {tag}
          </span>
        );
        return picking ? (
          <button
            key={f.id}
            type="button"
            aria-label={`Use "${f.original}" as the Candidate name`}
            title={`Use "${f.original}" as the Candidate name`}
            className={`${common} cursor-crosshair hover:ring-2 hover:ring-brand`}
            style={style}
            onClick={(e) => {
              e.stopPropagation();
              onAssignName?.(f.id);
            }}
          >
            {label}
          </button>
        ) : (
          <div key={f.id} className={common} style={style} aria-hidden>
            {label}
          </div>
        );
      })}
    </div>
  );
}
