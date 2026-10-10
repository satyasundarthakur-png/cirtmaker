import type { ReactNode } from "react";

export function Field({ label, id, children, hint }: { label: string; id: string; children: ReactNode; hint?: string | undefined }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function PanelHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-1">
      <h2 className="font-display text-base font-bold leading-tight">{title}</h2>
      {subtitle && <p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>}
    </div>
  );
}

export function Group({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-xl border border-line bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
        {title}
        <span aria-hidden className="text-muted transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="grid gap-3.5 px-4 pb-4">{children}</div>
    </details>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <div className="grid size-10 place-items-center rounded-full bg-secondary text-muted">{icon}</div>
      <p className="text-sm font-semibold">{title}</p>
      {children && <p className="max-w-[28ch] text-xs leading-relaxed text-muted">{children}</p>}
    </div>
  );
}
