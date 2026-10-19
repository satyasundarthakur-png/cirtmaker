import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StyleMatchEngine } from "@/features/certmaker/lib/editing/StyleMatchEngine";
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
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
}
describe("selection-aware AI editing UI", () => {
  it("applies a simple instruction to the selection at once, no ID entry and no extra Accept step", async () => {
    const { c, edit } = setup();
    instruction("replace with Rabindra");
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(edit.mock.calls[0]![0](c).fields[0].replacement).toBe("Rabindra");
    expect(screen.queryByRole("button", { name: "Accept edits" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/^Done:/);
  });
  it("understands natural phrasing when the new text is quoted", async () => {
    const { c, edit } = setup();
    instruction('change the name to "Rabindra Nath"');
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(edit.mock.calls[0]![0](c).fields[0].replacement).toBe("Rabindra Nath");
  });
  it("edits the Candidate name when nothing is selected", async () => {
    const c = source();
    c.fields[0]!.kind = "name";
    const { edit } = setup(c, []);
    expect(screen.getByText(/Editing \(auto-selected\)/)).toBeInTheDocument();
    instruction("replace with Rabindra");
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(edit.mock.calls[0]![0](c).fields[0].replacement).toBe("Rabindra");
  });
  it("asks once, inline, before sending anything to the AI provider", async () => {
    const { c, edit } = setup();
    const instruct = vi
      .spyOn(AIEditingEngine, "instruct")
      .mockImplementation(async (o) =>
        AIEditingEngine.plan(o.clone, o.selection, [{ type: "replace", text: "Rabindra" }]),
      );
    instruction("Please give the name a more elegant look");
    await screen.findByRole("alert");
    expect(instruct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send and apply" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(instruct.mock.calls[0]![0].consent).toBe(true);
    expect(edit.mock.calls[0]![0](c).fields[0].replacement).toBe("Rabindra");
  });
  it("can route edit, erase and add instructions through the selected AI provider", async () => {
    const { c, edit } = setup();
    const instruct = vi.spyOn(AIEditingEngine, "instruct").mockImplementation(async (o) =>
      AIEditingEngine.plan(o.clone, o.selection, [{ type: "delete" }]),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Auto edit with AI/ }));
    instruction("erase the selected writing");
    fireEvent.click(await screen.findByRole("button", { name: "Send and apply" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(instruct.mock.calls[0]![0]).toMatchObject({
      provider: "gemini",
      consent: true,
      instruction: "erase the selected writing",
    });
    expect(edit.mock.calls[0]![0](c).fields[0]).toMatchObject({
      replacement: "",
      deleted: true,
      erase: "smart",
    });
  });
  it("can require review before applying an AI plan", async () => {
    setup();
    vi.spyOn(AIEditingEngine, "instruct").mockImplementation(async (o) =>
      AIEditingEngine.plan(o.clone, o.selection, [{ type: "add", text: "New text" }]),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Ask AI, review before applying/ }));
    instruction("add new text below");
    fireEvent.click(await screen.findByRole("button", { name: "Send for preview" }));
    expect(await screen.findByRole("button", { name: "Accept edits" })).toBeEnabled();
  });
  it("applies bulk alignment for several selected fields in one click", async () => {
    const c = source();
    c.fields.push(cloneField("Course", 400, 200, 200, 40, 1));
    const { edit } = setup(c, ["clone-0", "clone-1"]);
    instruction("align horizontally");
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    const next = edit.mock.calls[0]![0](c);
    expect(next.fields[0].y).toBe(next.fields[1].y);
  });
  it("shows best and alternate style matches and creates preview on click", async () => {
    setup();
    vi.spyOn(StyleMatchEngine, "analyze").mockResolvedValue(
      ["Inter", "Montserrat", "Playfair Display"].map((font, i) => ({
        font,
        score: 95 - i,
        confidence: 95 - i,
        style: {
          font,
          fontSize: 32,
          bold: false,
          italic: false,
          align: "center" as const,
          color: "#17181a",
        },
        source: "typography-fingerprint" as const,
        explanation: "Measured fingerprint",
      })),
    );
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
  it("keeps Reject for previewed edits and leaves the document untouched", () => {
    const c = source();
    c.fields[0]!.locked = true;
    const { edit } = setup(c);
    fireEvent.click(screen.getByRole("button", { name: "Preview manual unlock" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject edits" }));
    expect(edit).not.toHaveBeenCalled();
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
    fireEvent.click(await screen.findByRole("button", { name: "Send and apply" }));
    view.rerender(<CloneAiEditor {...props} selected={null} selectedIds={[]} />);
    await act(async () => {
      finish(
        AIEditingEngine.plan(c, SelectionManager.resolve(c, ["clone-0"]), [
          { type: "replace", text: "Rabindra" },
        ]),
      );
    });
    await screen.findByText("Selection, certificate or instruction changed. Press Apply again.");
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
    fireEvent.click(await screen.findByRole("button", { name: "Send and apply" }));
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
  it("invalidates a previewed edit when any layer changes", () => {
    const c = source();
    c.fields[0]!.locked = true;
    const { props, view } = setup(c);
    fireEvent.click(screen.getByRole("button", { name: "Preview manual unlock" }));
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
    const edit = vi.fn();
    render(
      <CloneAiPanel
        clone={source()}
        selected="clone-0"
        variables={[]}
        headers={[]}
        edit={edit}
        onSelect={vi.fn()}
      />,
    );
    instruction("replace with Rabindra");
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("region", { name: "AI instruction editing" })).toBeInTheDocument();
  });
});
