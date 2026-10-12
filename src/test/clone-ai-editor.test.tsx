import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CloneAiEditor from "@/features/certmaker/components/CloneAiEditor";
import CloneAiPanel from "@/features/certmaker/components/CloneAiPanel";
import { AIEditingEngine } from "@/features/certmaker/lib/editing/AIEditingEngine";
import { SelectionManager } from "@/features/certmaker/lib/editing/SelectionManager";
import { cloneField } from "@/features/certmaker/lib/clone";
import type { EditPlan } from "@/features/certmaker/lib/editing/types";
import type { CloneSource } from "@/features/certmaker/lib/types";
const source = (): CloneSource => ({
  image: "template",
  width: 1000,
  height: 600,
  filename: "test.png",
  kind: "image",
  fields: [cloneField("Name", 100, 100, 200, 40, 0)],
  suggestions: [],
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup(c = source(), selectedIds = ["clone-0"]) {
  const edit = vi.fn();
  const props = {
    clone: c,
    selected: selectedIds.at(-1) ?? null,
    selectedIds,
    variables: [],
    provider: "gemini" as const,
    apiKey: "key",
    model: "test",
    edit,
  };
  const view = render(<CloneAiEditor {...props} />);
  return { c, edit, props, view };
}
function instruction(text: string) {
  fireEvent.change(screen.getByLabelText("AI editing instruction"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Generate edit preview" }));
}
describe("selection-aware AI editing UI", () => {
  it("uses selection with no ID entry and requires Accept after old/new preview", async () => {
    const { c, edit } = setup();
    instruction("replace with Rabindra");
    await screen.findByRole("button", { name: "Accept edits" });
    expect(edit).not.toHaveBeenCalled();
    expect(screen.getByText('"Rabindra"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept edits" }));
    expect(edit.mock.calls[0]![0](c).fields[0].replacement).toBe("Rabindra");
  });
  it("Reject leaves the document untouched", async () => {
    const { edit } = setup();
    instruction("duplicate this");
    await screen.findByRole("button", { name: "Accept edits" });
    fireEvent.click(screen.getByRole("button", { name: "Reject edits" }));
    expect(edit).not.toHaveBeenCalled();
  });
  it("previews bulk alignment for several selected fields", async () => {
    const c = source();
    c.fields.push(cloneField("Course", 400, 200, 200, 40, 1));
    const { edit } = setup(c, ["clone-0", "clone-1"]);
    instruction("align horizontally");
    await screen.findByRole("button", { name: "Accept edits" });
    fireEvent.click(screen.getByRole("button", { name: "Accept edits" }));
    const next = edit.mock.calls[0]![0](c);
    expect(next.fields[0].y).toBe(next.fields[1].y);
  });
  it("shows best and alternate style matches and creates preview on click", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Match style" }));
    await screen.findByRole("button", { name: /Best Match:/ });
    expect(screen.getByRole("button", { name: /Alternate Match 1:/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alternate Match 2:/ })).toBeInTheDocument();
  });
  it("disables locked layer operations and offers explicit manual unlock preview", () => {
    const c = source();
    c.fields[0]!.locked = true;
    setup(c);
    expect(screen.getByRole("button", { name: "Duplicate" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Preview manual unlock" }));
    expect(screen.getByRole("button", { name: "Accept edits" })).toBeEnabled();
  });
  it("ignores stale asynchronous provider results when selection changes", async () => {
    const { c, props, view, edit } = setup();
    let finish!: (p: EditPlan) => void;
    vi.spyOn(AIEditingEngine, "instruct").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    instruction("Please give the name a more elegant layout");
    view.rerender(<CloneAiEditor {...props} selected={null} selectedIds={[]} />);
    await act(async () => {
      finish(
        AIEditingEngine.plan(c, SelectionManager.resolve(c, ["clone-0"]), [
          { type: "replace", text: "Rabindra" },
        ]),
      );
    });
    await screen.findByText(
      "Selection, certificate or instruction changed. Generate a fresh preview.",
    );
    expect(edit).not.toHaveBeenCalled();
  });
  it("ignores cancelled responses even if provider resolves later", async () => {
    const { c, edit } = setup();
    let finish!: (p: EditPlan) => void;
    vi.spyOn(AIEditingEngine, "instruct").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    instruction("Please rewrite with a nicer formal name");
    fireEvent.click(screen.getByRole("button", { name: "Cancel AI editing" }));
    await act(async () => {
      finish(
        AIEditingEngine.plan(c, SelectionManager.resolve(c, ["clone-0"]), [
          { type: "replace", text: "Rabindra" },
        ]),
      );
    });
    expect(edit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Accept edits" })).not.toBeInTheDocument();
  });
  it("invalidates preview on any changed layer", async () => {
    const { c, props, view } = setup();
    instruction("replace with Rabindra");
    await screen.findByRole("button", { name: "Accept edits" });
    view.rerender(
      <CloneAiEditor
        {...props}
        clone={{ ...c, fields: c.fields.map((f) => ({ ...f, color: "#ffffff" })) }}
      />,
    );
    expect(screen.getByRole("button", { name: "Accept edits" })).toBeDisabled();
  });
  it("is exposed in the existing Clone Mode panel without a provider key for local instructions", async () => {
    sessionStorage.clear();
    render(
      <CloneAiPanel
        clone={source()}
        selected="clone-0"
        variables={[]}
        headers={[]}
        edit={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    instruction("replace with Rabindra");
    await screen.findByRole("button", { name: "Accept edits" });
    expect(screen.getByRole("region", { name: "AI instruction editing" })).toBeInTheDocument();
  });
});
