import { Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectionRows, type DetectView } from "../lib/clone-debug";
import { debugDetectionEnabled, setDebugDetection } from "../lib/clone-name-validation";
import type { CloneSource } from "../lib/types";

interface Props {
  clone: CloneSource;
  view: DetectView;
  onView: (v: DetectView) => void;
  message: string;
}

/** Detection report: what was found, how it was classified, how sure we are, and the raw model JSON. */
export default function DetectionDebug({ clone, view, onView, message }: Props) {
  const rows = detectionRows(clone);
  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-xs font-semibold text-muted">
        Detection check ({rows.length} regions)
      </summary>
      <div className="mt-3 grid gap-3 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={view === "debug"}
            onChange={(e) => {
              setDebugDetection(e.target.checked);
              onView(e.target.checked ? "debug" : "off");
            }}
          />
          Show every detected box with its type and confidence on the certificate
        </label>
        <Button
          variant="certificate"
          size="certificate"
          type="button"
          className="justify-self-start"
          aria-pressed={view === "pickName"}
          onClick={() => onView(view === "pickName" ? "off" : "pickName")}
        >
          <Crosshair aria-hidden />
          {view === "pickName"
            ? "Cancel: click the name on the certificate"
            : "Pick the candidate name on the certificate"}
        </Button>
        {view === "pickName" && (
          <p className="text-muted">
            Click the real name text on the certificate. Any other name box becomes plain text.
          </p>
        )}
        {message && (
          <p role="status" className="text-brand">
            {message}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-[11px]">
            <thead className="text-muted">
              <tr>
                <th className="pr-2">Text</th>
                <th className="pr-2">Type</th>
                <th className="pr-2">Box x,y w×h</th>
                <th className="pr-2">Conf.</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="max-w-[10rem] break-words pr-2">{r.text}</td>
                  <td className="pr-2">
                    {r.kind}
                    {r.rawKind !== r.kind ? ` (model: ${r.rawKind})` : ""}
                  </td>
                  <td className="whitespace-nowrap pr-2">
                    {r.box.x},{r.box.y} {r.box.w}×{r.box.h}
                  </td>
                  <td className="pr-2">{r.confidence === null ? "—" : `${r.confidence}%`}</td>
                  <td>
                    {r.status === "rejected" ? `rejected: ${r.reason}` : r.reason || r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {clone.debug && (
          <details>
            <summary className="cursor-pointer text-muted">
              Raw {clone.debug.provider} JSON (exactly what the model returned)
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-secondary/40 p-2 text-[10px]">
              {clone.debug.raw}
            </pre>
          </details>
        )}
        {debugDetectionEnabled() && (
          <p className="text-muted">Console logging is on for the next detection.</p>
        )}
      </div>
    </details>
  );
}
