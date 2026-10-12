import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Braces,
  ExternalLink,
  PenTool,
  QrCode,
  Trash2,
  Download,
  Image as ImageIcon,
  LayoutTemplate,
  Layers,
  Maximize2,
  Palette,
  PenLine,
  Redo2,
  RotateCcw,
  Stamp,
  Table2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import CloneFields, { type PickTarget } from "@/features/certmaker/components/CloneFields";
import { patchField, removeField, samplePixel } from "@/features/certmaker/lib/clone";
import type { CloneEdit } from "@/features/certmaker/components/Preview";
import Preview from "@/features/certmaker/components/Preview";
import TemplatePicker from "@/features/certmaker/components/TemplatePicker";
import ReferencePanel from "@/features/certmaker/components/ReferencePanel";
import EffectsPanel from "@/features/certmaker/components/EffectsPanel";
import { EmptyState, Field, Group, PanelHeading } from "@/features/certmaker/components/bits";
import { DEFAULT_DATA, type CertData, type FontSet } from "@/features/certmaker/lib/types";
import { FONT_SETS } from "@/features/certmaker/lib/themes";
import { REGION_LABELS } from "@/features/certmaker/lib/render";
import CloneAiPanel from "./components/CloneAiPanel";
import { templateLayers, applyTemplateLayers } from "./lib/editing/TemplateAdapter";
import { SelectionManager } from "./lib/editing/SelectionManager";
import { useHistory } from "@/features/certmaker/lib/history";
import { shrinkImage } from "@/features/certmaker/lib/image";
import {
  batchExport,
  download,
  exportWith,
  fileSafe,
  type BatchFormat,
} from "@/features/certmaker/lib/exporter";
import {
  DPI_MAX,
  DPI_MIN,
  PROFILES,
  clampDpi,
  pixelWidth,
  type ExportFormat,
  type ExportProfile,
} from "@/features/certmaker/lib/exporter-utils";
import {
  applyKit,
  kitFrom,
  loadKits,
  saveKits,
  type BrandKit,
} from "@/features/certmaker/lib/brand";
import {
  clearRegister,
  loadRegister,
  registerIssued,
  setRevoked,
  verifyUrl,
  type Issued,
} from "@/features/certmaker/lib/verify";
import {
  BUILT_IN_VARS,
  certForRow,
  missingVariables,
  parseDataset,
} from "@/features/certmaker/lib/merge";

const KEY = "certmaker:v1";
const MAX_BATCH = 300;
const SAMPLE_CSV =
  "Name,Course,Score,Date\nAsha Mohanty,Regional Anaesthesia Workshop,92,12 October 2026\nRavi Kumar,Regional Anaesthesia Workshop,88,12 October 2026\nPriya Nair,Regional Anaesthesia Workshop,95,12 October 2026";
type TextKey = "org" | "title" | "subtitle" | "recipient" | "body";
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

type TabId = "templates" | "content" | "branding" | "colors" | "variables" | "export";
const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "content", label: "Content", icon: PenLine },
  { id: "branding", label: "Branding", icon: Stamp },
  { id: "colors", label: "Colors", icon: Palette },
  { id: "variables", label: "Variables", icon: Table2 },
  { id: "export", label: "Export", icon: Download },
];

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

export default function CertificateMaker() {
  const h = useHistory<CertData>(DEFAULT_DATA);
  const d = h.present;
  const setD = h.set;
  const [storageReady, setStorageReady] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = { ...DEFAULT_DATA, ...JSON.parse(raw) } as CertData;
        if (saved.template === "inspired" && !saved.custom) saved.template = "classic";
        h.reset({
          ...saved,
          clone: null,
          fx: saved.fx ?? {},
          colors: saved.colors ?? {},
          refBg: "",
          bgMode: "recreate",
        });
      }
    } catch {
      /* storage unavailable */
    }
    setStorageReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [previewRow, setPreviewRow] = useState<number | null>(null);
  const [pick, setPick] = useState<PickTarget | null>(null);
  const [register, setRegister] = useState<Issued[]>([]);
  const [vUrl, setVUrl] = useState("");
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [kitName, setKitName] = useState("");
  const [profileId, setProfileId] = useState<ExportProfile["id"]>("print");
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [dpi, setDpi] = useState(300);
  const [quality, setQuality] = useState(0.95);
  const lastField = useRef<TextKey>("body");
  const csvFile = useRef<HTMLInputElement>(null);
  const [fmt, setFmt] = useState<BatchFormat>("pdf-zip");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [err, setErr] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const sel = selectedIds.at(-1) ?? null;
  const setSel = (id: string | null) => setSelectedIds(id ? [id] : []);
  const selectText = (id: string | null, additive = false) => {
    setSelectedIds((ids) =>
      SelectionManager.select({ ids, primary: ids.at(-1) ?? null, reference: null }, id, additive),
    );
    if (id) setTab("content");
  };
  const [tab, setTab] = useState<TabId>("templates");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!storageReady) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({
            ...d,
            clone: null,
            refBg: "",
            logo: d.logo.length < 400_000 ? d.logo : "",
            sigImgs: d.sigImgs.map((x) => (x.length < 200_000 ? x : "")),
          }),
        );
      } catch {
        /* ignore quota / private mode */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [d, storageReady]);

  const set = <K extends keyof CertData>(k: K, v: CertData[K]) =>
    setD((p) =>
      p.textLayers?.some(
        (f) => f.id === k && (f.locked || (f.protection && f.protection !== "text")),
      )
        ? p
        : { ...p, [k]: v },
    );
  const setSig = (i: number, k: "name" | "role", v: string) =>
    setD((p) => ({ ...p, sigs: p.sigs.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));

  const ds = useMemo(() => parseDataset(csv), [csv]);
  const missing = useMemo(() => missingVariables(d, ds), [d, ds]);
  const rowCount = ds.rows.length;
  const rowIdx = previewRow !== null && previewRow < rowCount ? previewRow : null;
  const shown = useMemo(
    () => (rowIdx !== null && ds.rows[rowIdx] ? certForRow(d, ds.rows[rowIdx], rowIdx) : d),
    [d, ds, rowIdx],
  );
  const slug = fileSafe(shown.recipient) || "certificate";
  const varChoices = useMemo(
    () => [...new Set<string>([...BUILT_IN_VARS, ...ds.headers])],
    [ds.headers],
  );

  const nativeLayers = useMemo(() => templateLayers(d), [d]);
  const editNative = (fn: (c: NonNullable<CertData["clone"]>) => NonNullable<CertData["clone"]>) =>
    setD((p) => applyTemplateLayers(p, fn(templateLayers(p))));

  // Clone Mode: every edit (panel or on-canvas) changes the template, never the CSV-filled preview.
  const editClone = (fn: (c: NonNullable<CertData["clone"]>) => NonNullable<CertData["clone"]>) =>
    setD((p) => (p.clone ? { ...p, clone: fn(p.clone) } : p));
  const cloneEdit: CloneEdit | undefined =
    d.cloneMode && d.clone
      ? {
          clone: d.clone,
          selected: sel,
          selectedIds,
          onSelect: selectText,
          onChange: (id, patch) => editClone((c) => patchField(c, id, patch)),
          onRemove: (id) => {
            editClone((c) => removeField(c, id));
            setSel(null);
          },
          onPixel: pick
            ? (x, y) => {
                const target = pick;
                const src = d.clone?.image ?? "";
                setPick(null);
                samplePixel(src, x, y)
                  .then((hex) => editClone((c) => patchField(c, target.id, { [target.prop]: hex })))
                  .catch((e: unknown) =>
                    setErr(e instanceof Error ? e.message : "Could not read that colour."),
                  );
              }
            : undefined,
        }
      : !d.cloneMode
        ? {
            clone: nativeLayers,
            selected: sel,
            selectedIds,
            onSelect: selectText,
            onChange: (id, patch) => editNative((c) => patchField(c, id, patch)),
            onRemove: (id) =>
              editNative((c) =>
                patchField(c, id, { deleted: true, replacement: "", redraw: true }),
              ),
          }
        : undefined;
  useEffect(() => setRegister(loadRegister()), [tab]);
  useEffect(() => {
    setKits(loadKits());
    try {
      const raw = JSON.parse(localStorage.getItem("certmaker:export:v1") ?? "null") as {
        profileId?: ExportProfile["id"];
        format?: ExportFormat;
        dpi?: number;
        quality?: number;
      } | null;
      if (raw) {
        if (raw.profileId) setProfileId(raw.profileId);
        if (raw.format) setFormat(raw.format);
        if (raw.dpi) setDpi(clampDpi(raw.dpi));
        if (raw.quality) setQuality(Math.min(1, Math.max(0.5, raw.quality)));
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        "certmaker:export:v1",
        JSON.stringify({ profileId, format, dpi, quality }),
      );
    } catch {
      /* ignore */
    }
  }, [profileId, format, dpi, quality]);
  const pickProfile = (p: ExportProfile) => {
    setProfileId(p.id);
    setFormat(p.format);
    setDpi(p.dpi);
    setQuality(p.quality);
  };
  const tweak = (f: () => void) => {
    f();
    setProfileId("custom");
  };
  const px = pixelWidth(d.paper, dpi);
  const exportLabel = `${format === "jpeg" ? "JPEG" : format.toUpperCase()}${format === "pdf" || format === "jpeg" || format === "png" || format === "svg" ? ` · ${dpi} dpi` : ""}`;

  function saveKit() {
    const next = [...kits, kitFrom(d, kitName)].slice(-12);
    if (!saveKits(next))
      return setErr(
        "Couldn't save the kit — browser storage is full or blocked. Try a smaller logo.",
      );
    setErr("");
    setKits(next);
    setKitName("");
  }
  function removeKit(id: string) {
    const next = kits.filter((k) => k.id !== id);
    saveKits(next);
    setKits(next);
  }
  function onSigImg(i: number, file?: File) {
    if (!file) return;
    if (file.size > 1_500_000)
      return setErr("Signature image is over 1.5 MB — please use a smaller one.");
    shrinkImage(file, 600)
      .then((u) =>
        setD((p) => ({ ...p, sigImgs: [0, 1].map((j) => (j === i ? u : (p.sigImgs[j] ?? ""))) })),
      )
      .catch((e: unknown) =>
        setErr(e instanceof Error ? e.message : "That image could not be read."),
      );
  }
  useEffect(() => {
    let live = true;
    verifyUrl(shown).then((u) => live && setVUrl(u));
    return () => {
      live = false;
    };
  }, [shown]);
  const insertVar = (v: string) =>
    set(lastField.current, (d[lastField.current] + `{{${v}}}`) as never);
  const focusKey = (k: TextKey) => () => {
    lastField.current = k;
  };

  function onCsvFile(file?: File) {
    if (!file) return;
    if (file.size > 5_000_000)
      return setErr("That file is over 5 MB — split it into smaller batches.");
    const r = new FileReader();
    r.onload = () => {
      setCsv(String(r.result));
      setPreviewRow(0);
    };
    r.readAsText(file);
  }

  const clampZoom = (z: number) =>
    Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
  const zoomBy = useCallback((f: number) => setZoom((z) => clampZoom(z * f)), []);

  // keyboard shortcuts (ignored while typing so native text undo keeps working)
  const { undo, redo } = h;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (mod && (k === "=" || k === "+")) {
        e.preventDefault();
        zoomBy(1.2);
      } else if (mod && k === "-") {
        e.preventDefault();
        zoomBy(1 / 1.2);
      } else if (mod && k === "0") {
        e.preventDefault();
        setZoom(1);
      } else if (k === "escape") setSel(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, zoomBy]);

  async function run(label: string, fn: () => Promise<void>) {
    setErr("");
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  function onLogo(file?: File) {
    if (!file) return;
    if (file.size > 3_000_000) return setErr("Logo is over 3 MB — please use a smaller image.");
    shrinkImage(file)
      .then((u) => set("logo", u))
      .catch((e: unknown) =>
        setErr(e instanceof Error ? e.message : "That image could not be read."),
      );
  }

  // Clicking a part of the certificate opens its text box so the name/text can be edited right away.
  // The element stays selected, so colours and effects are still one tab away.
  const FIELD_FOR: Record<string, { tab: TabId; input: string }> = {
    org: { tab: "content", input: "org" },
    title: { tab: "content", input: "title" },
    subtitle: { tab: "content", input: "sub" },
    recipient: { tab: "content", input: "rec" },
    body: { tab: "content", input: "body" },
    meta: { tab: "content", input: "date" },
    sig0: { tab: "branding", input: "sn0" },
    sig1: { tab: "branding", input: "sn1" },
    seal: { tab: "branding", input: "seal" },
  };
  const selectElement = (id: string | null) => {
    if (d.cloneMode) {
      setSel(id);
      if (id) {
        setTab("content");
        window.setTimeout(() => {
          const input = document.getElementById(id) as HTMLInputElement | null;
          input?.focus();
        }, 60);
      }
      return;
    }
    if (id === "qr") {
      setSel(null);
      setTab("export");
      return;
    }
    setSel(id);
    const target = id ? FIELD_FOR[id] : undefined;
    if (!target) return;
    setTab(target.tab);
    window.setTimeout(() => {
      const el = document.getElementById(target.input) as
        HTMLInputElement | HTMLTextAreaElement | null;
      if (el) {
        el.focus();
        el.select?.();
      }
    }, 60);
  };

  const exportButtons = (
    <Button
      variant="certificate"
      size="certificate"
      type="button"
      className="btn btn-primary"
      disabled={!!busy || (d.cloneMode && !d.clone)}
      onClick={() =>
        run("export", async () => {
          const r = await exportWith(shown, { format, dpi, quality });
          download(r.blob, `${slug}.${r.ext}`);
          registerIssued([shown]);
          setRegister(loadRegister());
        })
      }
    >
      <Download aria-hidden /> {busy === "export" ? "Preparing…" : `Export ${exportLabel}`}
    </Button>
  );

  return (
    <div className="flex min-h-screen flex-col bg-paper lg:h-screen lg:overflow-hidden">
      {/* top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-card px-3 py-2 sm:px-4">
        <svg width="28" height="28" viewBox="0 0 100 100" aria-hidden className="shrink-0">
          <rect width="100" height="100" rx="20" fill="var(--certificate-icon-ink)" />
          <rect
            x="16"
            y="24"
            width="68"
            height="46"
            rx="3"
            fill="var(--certificate-icon-paper)"
            stroke="var(--certificate-icon-gold)"
            strokeWidth="4"
          />
          <path
            d="M30 42h40M36 52h28"
            stroke="var(--certificate-icon-ink)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle cx="50" cy="74" r="10" fill="var(--certificate-icon-gold)" />
        </svg>
        <div className="min-w-0">
          <h1 className="truncate font-display text-base font-bold leading-none">
            Certificate Studio
          </h1>
          <p className="mt-0.5 hidden text-[11px] text-muted sm:block">
            Design · personalise in bulk · issue &amp; verify
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1" role="toolbar" aria-label="Editor actions">
          <button
            type="button"
            className="tool"
            onClick={h.undo}
            disabled={!h.canUndo}
            aria-label="Undo (Ctrl+Z)"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 aria-hidden />
          </button>
          <button
            type="button"
            className="tool"
            onClick={h.redo}
            disabled={!h.canRedo}
            aria-label="Redo (Ctrl+Shift+Z)"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 aria-hidden />
          </button>
          <button
            type="button"
            className="tool"
            onClick={() => h.rollback(Math.max(0, h.position - 1))}
            disabled={!h.canUndo}
            title="Roll back to previous state"
          >
            Rollback
          </button>
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
          <button
            type="button"
            className="tool hidden sm:grid"
            onClick={() => zoomBy(1 / 1.2)}
            aria-label="Zoom out (Ctrl+−)"
            title="Zoom out (Ctrl+−)"
          >
            <ZoomOut aria-hidden />
          </button>
          <button
            type="button"
            className="hidden min-w-12 rounded-md px-1.5 py-1 text-xs font-semibold tabular-nums hover:bg-secondary sm:block"
            onClick={() => setZoom(1)}
            title="Fit to screen (Ctrl+0)"
            aria-label={`Zoom ${Math.round(zoom * 100)} percent. Reset to fit`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="tool hidden sm:grid"
            onClick={() => zoomBy(1.2)}
            aria-label="Zoom in (Ctrl+=)"
            title="Zoom in (Ctrl+=)"
          >
            <ZoomIn aria-hidden />
          </button>
          <button
            type="button"
            className="tool hidden sm:grid"
            onClick={() => setZoom(1)}
            aria-label="Fit to screen"
            title="Fit to screen (Ctrl+0)"
          >
            <Maximize2 aria-hidden />
          </button>
          <span className="mx-1 hidden h-5 w-px bg-line md:block" />
          <div className="hidden items-center gap-2 md:flex">{exportButtons}</div>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
        {/* sidebar: rail + panel */}
        <aside className="order-2 flex flex-col border-line bg-card lg:order-1 lg:w-[22.5rem] lg:shrink-0 lg:flex-row lg:border-r">
          <nav
            className="flex shrink-0 overflow-x-auto border-b border-line lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r"
            aria-label="Workspace sections"
          >
            <div role="tablist" aria-orientation="vertical" className="flex lg:flex-col">
              {TABS.filter((t) => !d.cloneMode || (t.id !== "branding" && t.id !== "colors")).map(
                (t) => {
                  const on = tab === t.id;
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      id={`tab-${t.id}`}
                      role="tab"
                      type="button"
                      aria-selected={on}
                      aria-controls="side-panel"
                      onClick={() => setTab(t.id)}
                      className={`flex min-w-[4.5rem] flex-1 flex-col items-center gap-1 px-2 py-3 text-[11px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand lg:flex-none ${on ? "bg-secondary text-brand" : "text-muted hover:bg-secondary/60 hover:text-ink"}`}
                    >
                      <Icon className="size-5" aria-hidden />
                      {t.label}
                    </button>
                  );
                },
              )}
            </div>
          </nav>

          <div
            id="side-panel"
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            className="grid min-w-0 flex-1 content-start gap-4 p-4 lg:overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
              <label htmlFor="clone-mode" className="text-sm font-semibold">
                Clone Mode
              </label>
              <Switch
                id="clone-mode"
                checked={d.cloneMode}
                onCheckedChange={(cloneMode) => {
                  setD((p) => ({ ...p, cloneMode }));
                  setSel(null);
                  setTab("templates");
                }}
              />
            </div>
            {tab === "templates" && (
              <>
                <PanelHeading
                  title={d.cloneMode ? "Original certificate" : "Templates"}
                  subtitle={
                    d.cloneMode
                      ? "Background locked"
                      : "Pick a starting point. Everything stays editable."
                  }
                />
                {!d.cloneMode && (
                  <TemplatePicker
                    data={d}
                    onPick={(id, accent) =>
                      setD((p) => ({
                        ...p,
                        template: id,
                        accent: id === "inspired" && p.custom ? p.custom.accent : accent,
                        bgMode: id === "inspired" ? p.bgMode : "recreate",
                      }))
                    }
                  />
                )}
                <Group
                  title={d.cloneMode ? "Original file" : "Match your own certificate"}
                  open={d.cloneMode}
                >
                  <ReferencePanel data={d} setData={setD} />
                </Group>
                {d.cloneMode && d.clone && (
                  <Button
                    variant="certificate"
                    size="certificate"
                    className="btn"
                    onClick={() => setTab("content")}
                  >
                    Text fields
                  </Button>
                )}
              </>
            )}

            {tab === "content" && d.cloneMode && (
              <>
                <PanelHeading title="Text fields" subtitle="Original certificate locked" />
                {d.clone ? (
                  <CloneFields
                    clone={d.clone}
                    edit={editClone}
                    selected={sel}
                    selectedIds={selectedIds}
                    onMultiSelect={(id, additive) => selectText(id, additive)}
                    onSelect={setSel}
                    variables={varChoices}
                    headers={ds.headers}
                    picking={pick}
                    onPick={setPick}
                  />
                ) : (
                  <p className="text-sm text-muted">Upload an original certificate first.</p>
                )}
              </>
            )}
            {tab === "content" && !d.cloneMode && (
              <>
                <CloneAiPanel
                  clone={nativeLayers}
                  selected={sel}
                  selectedIds={selectedIds}
                  previewData={d}
                  detectionEnabled={false}
                  variables={varChoices}
                  headers={ds.headers}
                  edit={editNative}
                  onSelect={setSel}
                />
                <div className="flex flex-wrap gap-2">
                  {nativeLayers.fields
                    .filter((f) => !f.deleted)
                    .map((f) => (
                      <label key={f.id} className="flex gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(f.id)}
                          onChange={() => selectText(f.id, true)}
                        />
                        {f.label}
                      </label>
                    ))}
                </div>
                <PanelHeading title="Content" subtitle="The words on the certificate." />
                <Field label="Organisation" id="org">
                  <input
                    id="org"
                    className="field"
                    onFocus={focusKey("org")}
                    value={d.org}
                    onChange={(e) => set("org", e.target.value)}
                  />
                </Field>
                <Field label="Title" id="title">
                  <input
                    id="title"
                    className="field"
                    onFocus={focusKey("title")}
                    value={d.title}
                    onChange={(e) => set("title", e.target.value)}
                  />
                </Field>
                <Field label="Line above the name" id="sub">
                  <input
                    id="sub"
                    className="field"
                    onFocus={focusKey("subtitle")}
                    value={d.subtitle}
                    onChange={(e) => set("subtitle", e.target.value)}
                  />
                </Field>
                <Field label="Recipient name" id="rec">
                  <input
                    id="rec"
                    className="field"
                    onFocus={focusKey("recipient")}
                    value={d.recipient}
                    onChange={(e) => set("recipient", e.target.value)}
                  />
                </Field>
                <Field label="Description (up to 4 lines)" id="body">
                  <textarea
                    id="body"
                    rows={4}
                    className="field"
                    onFocus={focusKey("body")}
                    value={d.body}
                    onChange={(e) => set("body", e.target.value)}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date" id="date">
                    <input
                      id="date"
                      className="field"
                      value={d.date}
                      onChange={(e) => set("date", e.target.value)}
                    />
                  </Field>
                  <Field label="Certificate ID" id="cid">
                    <input
                      id="cid"
                      className="field"
                      value={d.certId}
                      onChange={(e) => set("certId", e.target.value)}
                    />
                  </Field>
                </div>
                <Group title="Insert variable" open={false}>
                  <p className="text-xs text-muted">
                    Click a variable to add it to the field you last edited. Values come from your
                    table in the Variables tab.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {varChoices.map((v) => (
                      <button
                        key={v}
                        type="button"
                        className="chip font-mono !text-xs"
                        onClick={() => insertVar(v)}
                      >{`{{${v}}}`}</button>
                    ))}
                  </div>
                </Group>
              </>
            )}

            {tab === "branding" && (
              <>
                <PanelHeading
                  title="Branding"
                  subtitle="Save your organisation's identity once, reuse it in one click."
                />
                <Group title={`Brand kits (${kits.length})`}>
                  <div className="flex gap-2">
                    <input
                      aria-label="Kit name"
                      className="field"
                      placeholder="Kit name, e.g. Eye Institute"
                      value={kitName}
                      onChange={(e) => setKitName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveKit();
                      }}
                    />
                    <Button
                      variant="certificate"
                      size="certificate"
                      type="button"
                      className="btn btn-primary shrink-0"
                      onClick={saveKit}
                    >
                      Save
                    </Button>
                  </div>
                  {kits.length === 0 ? (
                    <EmptyState
                      icon={<Stamp className="size-5" aria-hidden />}
                      title="No brand kits yet"
                    >
                      Saves logo, seal, signatories, address, template, colour and fonts.
                    </EmptyState>
                  ) : (
                    <ul className="grid gap-1.5">
                      {kits.map((k) => (
                        <li
                          key={k.id}
                          className="flex items-center gap-2 rounded-lg border border-line p-2"
                        >
                          <span
                            className="size-4 shrink-0 rounded-full border border-line"
                            style={{ background: k.accent }}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                            {k.name}
                          </span>
                          <Button
                            variant="certificate"
                            size="certificate"
                            type="button"
                            className="btn !px-2.5 !py-1 text-xs"
                            onClick={() => setD((p) => applyKit(p, k))}
                          >
                            Apply
                          </Button>
                          <button
                            type="button"
                            className="tool"
                            aria-label={`Delete kit ${k.name}`}
                            onClick={() => removeKit(k.id)}
                          >
                            <Trash2 aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-muted">
                    Kits live in this browser. Cloud sync and team sharing are on the roadmap.
                  </p>
                </Group>
                <Group title="Organisation">
                  <Field label="Name" id="borg">
                    <input
                      id="borg"
                      className="field"
                      value={d.org}
                      onChange={(e) => set("org", e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Address"
                    id="baddr"
                    hint="Available as {{address}} in any text field."
                  >
                    <textarea
                      id="baddr"
                      rows={2}
                      className="field"
                      value={d.address}
                      onChange={(e) => set("address", e.target.value)}
                    />
                  </Field>
                </Group>
                <Group title="Logo">
                  <Field label="Upload (PNG / JPG / SVG)" id="logo">
                    <input
                      id="logo"
                      type="file"
                      accept="image/*"
                      className="field"
                      onChange={(e) => onLogo(e.target.files?.[0])}
                    />
                  </Field>
                  {d.logo ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={d.logo}
                        alt="Uploaded logo"
                        className="h-12 max-w-[8rem] rounded border border-line bg-white object-contain p-1"
                      />
                      <Button
                        variant="certificate"
                        size="certificate"
                        type="button"
                        className="text-xs text-brand underline"
                        onClick={() => set("logo", "")}
                      >
                        Remove logo
                      </Button>
                    </div>
                  ) : (
                    <EmptyState
                      icon={<ImageIcon className="size-5" aria-hidden />}
                      title="No logo yet"
                    >
                      Upload one and it appears at the top of every certificate.
                    </EmptyState>
                  )}
                </Group>
                <Group title="Seal">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={d.showSeal}
                      onChange={(e) => set("showSeal", e.target.checked)}
                      className="accent-brand"
                    />{" "}
                    Show seal
                  </label>
                  <Field label="Seal text (optional, ≤ 8 chars)" id="seal">
                    <input
                      id="seal"
                      maxLength={8}
                      className="field"
                      value={d.sealText}
                      onChange={(e) => set("sealText", e.target.value)}
                      placeholder="★ if empty"
                    />
                  </Field>
                </Group>
                <Group title="Signatories">
                  {d.sigs.map((s, i) => (
                    <div key={i} className="grid grid-cols-2 gap-3">
                      <Field label={`Signatory ${i + 1}`} id={`sn${i}`}>
                        <input
                          id={`sn${i}`}
                          className="field"
                          value={s.name}
                          onChange={(e) => setSig(i, "name", e.target.value)}
                        />
                      </Field>
                      <Field label="Role" id={`sr${i}`}>
                        <input
                          id={`sr${i}`}
                          className="field"
                          value={s.role}
                          onChange={(e) => setSig(i, "role", e.target.value)}
                        />
                      </Field>
                      <div className="col-span-2 flex items-center gap-2">
                        <label htmlFor={`si${i}`} className="btn cursor-pointer text-xs">
                          <PenTool aria-hidden /> {d.sigImgs[i] ? "Replace" : "Add"} signature image
                        </label>
                        <input
                          id={`si${i}`}
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            onSigImg(i, e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                        {d.sigImgs[i] && (
                          <>
                            <img
                              src={d.sigImgs[i]}
                              alt={`Signature ${i + 1}`}
                              className="h-8 max-w-[5rem] rounded border border-line bg-white object-contain"
                            />
                            <button
                              type="button"
                              className="text-xs text-brand underline"
                              onClick={() =>
                                setD((p) => ({
                                  ...p,
                                  sigImgs: p.sigImgs.map((x, j) => (j === i ? "" : x)),
                                }))
                              }
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </Group>
              </>
            )}

            {tab === "colors" && (
              <>
                <PanelHeading
                  title="Colors &amp; effects"
                  subtitle="Select a part of the certificate, then style it."
                />
                <EffectsPanel data={d} setData={setD} selected={sel} setSelected={setSel} />
              </>
            )}

            {tab === "variables" && (
              <>
                <PanelHeading
                  title="Bulk issue"
                  subtitle="Paste or upload a table. Every column becomes a {{variable}} you can use anywhere on the certificate."
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="certificate"
                    size="certificate"
                    type="button"
                    className="btn"
                    onClick={() => csvFile.current?.click()}
                  >
                    <Upload aria-hidden /> Upload CSV
                  </Button>
                  <Button
                    variant="certificate"
                    size="certificate"
                    type="button"
                    className="btn"
                    onClick={() => {
                      setCsv(SAMPLE_CSV);
                      setPreviewRow(0);
                    }}
                  >
                    Load sample
                  </Button>
                  <input
                    ref={csvFile}
                    type="file"
                    accept=".csv,.tsv,.txt,text/csv"
                    className="sr-only"
                    aria-label="Upload CSV file"
                    onChange={(e) => {
                      onCsvFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </div>
                <Field
                  label={`Recipients table (${rowCount}${rowCount > MAX_BATCH ? ` — max ${MAX_BATCH}` : ""})`}
                  id="csv"
                  hint="First row = column names, e.g. Name,Course,Score,Date. A plain list of names also works."
                >
                  <textarea
                    id="csv"
                    rows={7}
                    spellCheck={false}
                    className="field font-mono text-xs"
                    value={csv}
                    onChange={(e) => setCsv(e.target.value)}
                  />
                </Field>

                {rowCount === 0 ? (
                  <EmptyState
                    icon={<Table2 className="size-5" aria-hidden />}
                    title="No recipients yet"
                  >
                    Paste rows above or upload a CSV to start issuing in bulk.
                  </EmptyState>
                ) : (
                  <>
                    <div>
                      <p className="label">Columns detected</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ds.headers.map((h) => (
                          <span
                            key={h}
                            className="rounded-full bg-secondary px-2.5 py-1 font-mono text-xs"
                          >
                            <Braces className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                            {h}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Field label="Preview on canvas" id="prow">
                      <select
                        id="prow"
                        className="field"
                        value={rowIdx ?? -1}
                        onChange={(e) =>
                          setPreviewRow(Number(e.target.value) < 0 ? null : Number(e.target.value))
                        }
                      >
                        <option value={-1}>Template (show {"{{variables}}"})</option>
                        {ds.rows.slice(0, 200).map((r, i) => (
                          <option key={i} value={i}>
                            {i + 1}. {r.name || "(no name)"}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </>
                )}

                {missing.length > 0 && (
                  <p
                    role="status"
                    className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      Not in your table, so these stay as typed:{" "}
                      {missing.map((m) => `{{${m}}}`).join(", ")}
                    </span>
                  </p>
                )}

                <Field
                  label="Output"
                  id="fmt"
                  hint={`Uses the DPI and quality from Export (capped at 300 dpi for bulk). Certificate IDs count up from the ID in Content unless your table has a certificate_id column.`}
                >
                  <select
                    id="fmt"
                    className="field"
                    value={fmt}
                    onChange={(e) => setFmt(e.target.value as BatchFormat)}
                  >
                    <option value="pdf-zip">Separate PDFs (.zip)</option>
                    <option value="png-zip">Separate PNG images (.zip)</option>
                    <option value="jpeg-zip">Separate JPEG images (.zip)</option>
                    <option value="pdf-one">One combined PDF</option>
                  </select>
                </Field>
                <Button
                  variant="certificate"
                  size="certificate"
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    !!busy || rowCount === 0 || rowCount > MAX_BATCH || (d.cloneMode && !d.clone)
                  }
                  onClick={() =>
                    run("batch", async () => {
                      const items = ds.rows.map((r, i) => certForRow(d, r, i));
                      const r = await batchExport(
                        items,
                        fmt,
                        (a, b) => setProgress([a, b]),
                        Math.min(dpi, 300),
                        quality,
                      );
                      download(r.blob, r.filename);
                      registerIssued(items);
                      setRegister(loadRegister());
                    })
                  }
                >
                  {busy === "batch" && progress
                    ? `Generating ${progress[0]} / ${progress[1]}…`
                    : `Generate ${rowCount} certificate${rowCount === 1 ? "" : "s"}`}
                </Button>
              </>
            )}

            {tab === "export" && (
              <>
                <PanelHeading title="Export" subtitle="Download the certificate you are editing." />
                <div role="group" aria-label="Export profiles" className="grid gap-2">
                  {PROFILES.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={profileId === p.id}
                      onClick={() => pickProfile(p)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${profileId === p.id ? "border-brand bg-secondary ring-1 ring-brand" : "border-line hover:border-ink/40"}`}
                    >
                      <span className="block text-sm font-semibold">{p.label}</span>
                      <span className="block text-xs text-muted">{p.hint}</span>
                    </button>
                  ))}
                </div>
                <Group
                  title={profileId === "custom" ? "Custom settings" : "Fine-tune"}
                  open={profileId === "custom"}
                >
                  <Field
                    label="Format"
                    id="xfmt"
                    hint={
                      format === "svg"
                        ? "SVG wraps the artwork as an image at true paper size. It is not editable vector text."
                        : undefined
                    }
                  >
                    <select
                      id="xfmt"
                      className="field"
                      value={format}
                      onChange={(e) => tweak(() => setFormat(e.target.value as ExportFormat))}
                    >
                      <option value="pdf">PDF</option>
                      <option value="png">PNG (lossless)</option>
                      <option value="jpeg">JPEG</option>
                      <option value="svg">SVG (embeds image)</option>
                    </select>
                  </Field>
                  <Field
                    label={`Resolution — ${dpi} dpi`}
                    id="xdpi"
                    hint={`${px.toLocaleString()} px wide${px >= 8000 ? " (capped to protect device memory)" : ""}`}
                  >
                    <input
                      id="xdpi"
                      type="range"
                      min={DPI_MIN}
                      max={DPI_MAX}
                      step={6}
                      value={dpi}
                      onChange={(e) => tweak(() => setDpi(clampDpi(Number(e.target.value))))}
                      className="w-full accent-brand"
                    />
                  </Field>
                  {(format === "pdf" || format === "jpeg") && (
                    <Field label={`Quality — ${Math.round(quality * 100)}%`} id="xq">
                      <input
                        id="xq"
                        type="range"
                        min={50}
                        max={100}
                        step={5}
                        value={Math.round(quality * 100)}
                        onChange={(e) => tweak(() => setQuality(Number(e.target.value) / 100))}
                        className="w-full accent-brand"
                      />
                    </Field>
                  )}
                </Group>
                <div className="flex flex-wrap gap-2">{exportButtons}</div>
                <p className="text-xs text-muted">Bulk downloads live under Variables.</p>

                {!d.cloneMode && (
                  <Group title="QR verification">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={d.qr}
                        onChange={(e) => set("qr", e.target.checked)}
                        className="accent-brand"
                      />{" "}
                      Print a QR code on the certificate
                    </label>
                    <Field
                      label="Verification site"
                      id="vbase"
                      hint="Leave empty to use this site. Use your own domain (e.g. verify.yourdomain.com) once it has a registry."
                    >
                      <input
                        id="vbase"
                        className="field"
                        placeholder="This site"
                        value={d.verifyBase}
                        onChange={(e) => set("verifyBase", e.target.value)}
                      />
                    </Field>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={d.verifyEmbed}
                        onChange={(e) => set("verifyEmbed", e.target.checked)}
                        className="mt-0.5 accent-brand"
                      />{" "}
                      <span>
                        Embed details in the link
                        <span className="block text-xs text-muted">
                          Verifies without a server. Turn off for short links like{" "}
                          <span className="font-mono">/CERT-2026-001</span>.
                        </span>
                      </span>
                    </label>
                    {vUrl && (
                      <div>
                        <p className="label">Link in the QR code</p>
                        <p className="break-all rounded-lg bg-secondary p-2 font-mono text-[11px] leading-snug">
                          {vUrl}
                        </p>
                        <a
                          href={vUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs text-brand underline"
                        >
                          <ExternalLink className="size-3" aria-hidden /> Open verification page
                        </a>
                      </div>
                    )}
                  </Group>
                )}

                <Group title={`Issue register (${register.length})`} open={false}>
                  {register.length === 0 ? (
                    <EmptyState
                      icon={<QrCode className="size-5" aria-hidden />}
                      title="Nothing issued yet"
                    >
                      Certificates you download are listed here so you can revoke them.
                    </EmptyState>
                  ) : (
                    <>
                      <ul className="grid gap-1.5">
                        {register
                          .slice(-8)
                          .reverse()
                          .map((r) => (
                            <li
                              key={r.id}
                              className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs"
                            >
                              <span className="min-w-0 flex-1">
                                <span
                                  className={`block truncate font-semibold ${r.revoked ? "line-through opacity-60" : ""}`}
                                >
                                  {r.name}
                                </span>
                                <span className="block truncate font-mono text-[11px] text-muted">
                                  {r.id}
                                </span>
                              </span>
                              <button
                                type="button"
                                className="text-brand underline"
                                onClick={() => setRegister(setRevoked(r.id, !r.revoked))}
                              >
                                {r.revoked ? "Restore" : "Revoke"}
                              </button>
                            </li>
                          ))}
                      </ul>
                      <p className="text-[11px] text-muted">
                        Stored only in this browser. Showing the latest 8 of {register.length}.
                      </p>
                      <Button
                        variant="certificate"
                        size="certificate"
                        type="button"
                        className="text-xs text-destructive underline"
                        onClick={() => {
                          if (confirm("Clear the whole issue register on this device?")) {
                            clearRegister();
                            setRegister([]);
                          }
                        }}
                      >
                        Clear register
                      </Button>
                    </>
                  )}
                </Group>
              </>
            )}

            {err && (
              <p role="alert" className="text-sm text-destructive">
                {err}
              </p>
            )}
          </div>
        </aside>

        {/* canvas */}
        <main
          className="order-1 min-w-0 flex-1 lg:order-2 lg:overflow-auto"
          aria-label="Certificate canvas"
        >
          <div className="checker min-h-[40vh] p-4 sm:p-8 lg:min-h-full">
            {d.cloneMode && !d.clone ? (
              <div className="grid min-h-[40vh] place-items-center text-sm text-muted">
                No original certificate loaded
              </div>
            ) : (
              <Preview
                data={shown}
                selected={sel}
                onSelect={selectElement}
                zoom={zoom}
                cloneEdit={cloneEdit}
              />
            )}
            <p className="mt-6 text-center text-xs text-muted">
              {d.cloneMode
                ? "Rendering and exports stay in your browser. With consent, AI detection sends the template image; AI editing sends your instruction and selected editable text to Google or Groq."
                : "Rendering and exports stay in your browser. With consent, AI editing sends your instruction and selected editable text to Google or Groq; logos and artwork stay on-device."}
            </p>
          </div>
        </main>

        {/* properties */}
        <aside
          className="order-3 border-t border-line bg-card p-4 lg:w-72 lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0"
          aria-label="Properties"
        >
          <div className="grid content-start gap-4">
            <PanelHeading
              title="Properties"
              subtitle={
                sel
                  ? `Selected: ${REGION_LABELS[sel] ?? sel}`
                  : "Click part of the certificate to select it."
              }
            />
            {d.cloneMode && (
              <p className="text-sm font-semibold text-muted">Original background locked</p>
            )}
            {!d.cloneMode && (
              <Group title="Page">
                <Field label="Paper" id="paper">
                  <select
                    id="paper"
                    className="field"
                    value={d.paper}
                    onChange={(e) => set("paper", e.target.value as CertData["paper"])}
                  >
                    <option value="a4">A4 landscape</option>
                    <option value="letter">US Letter landscape</option>
                  </select>
                </Field>
                <Field label="Accent colour" id="accent">
                  <input
                    id="accent"
                    type="color"
                    value={d.accent}
                    onChange={(e) => set("accent", e.target.value)}
                    className="h-10 w-full cursor-pointer rounded-lg border border-line bg-card p-1"
                  />
                </Field>
              </Group>
            )}
            {!d.cloneMode && (
              <Group title="Typography">
                <Field
                  label="Font set"
                  id="fonts"
                  hint="Odia and Devanagari text works in every set; choose Noto if the whole certificate is in Odia or Hindi."
                >
                  <select
                    id="fonts"
                    className="field"
                    value={d.fontSet}
                    onChange={(e) => set("fontSet", e.target.value as FontSet)}
                  >
                    {(Object.keys(FONT_SETS) as FontSet[]).map((k) => (
                      <option key={k} value={k}>
                        {FONT_SETS[k].label}
                      </option>
                    ))}
                  </select>
                </Field>
              </Group>
            )}
            <Group title="Shortcuts" open={false}>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-xs">
                {[
                  ["Undo", "Ctrl/⌘ Z"],
                  ["Redo", "Ctrl/⌘ Shift Z"],
                  ["Zoom in / out", "Ctrl/⌘ + / −"],
                  ["Fit to screen", "Ctrl/⌘ 0"],
                  ["Deselect", "Esc"],
                ].map(([a, b]) => (
                  <div key={a} className="contents">
                    <dt className="text-muted">{a}</dt>
                    <dd className="font-mono">{b}</dd>
                  </div>
                ))}
              </dl>
            </Group>
            <Button
              variant="certificate"
              size="certificate"
              type="button"
              className="btn"
              onClick={() => {
                if (confirm("Reset everything to the defaults?")) setD(DEFAULT_DATA);
              }}
            >
              <RotateCcw aria-hidden /> Reset design
            </Button>
          </div>
        </aside>
      </div>

      {/* sticky export bar on small screens */}
      <div className="sticky bottom-0 z-30 flex items-center gap-2 border-t border-line bg-card/95 px-3 py-2 backdrop-blur md:hidden">
        <Layers className="size-4 text-muted" aria-hidden />
        <span className="mr-auto truncate text-xs text-muted">{shown.recipient}</span>
        {exportButtons}
      </div>
    </div>
  );
}
