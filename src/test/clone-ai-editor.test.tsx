import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CloneAiPanel from "@/features/certmaker/components/CloneAiPanel";
import CloneAiEditor from "@/features/certmaker/components/CloneAiEditor";
import { cloneField } from "@/features/certmaker/lib/clone";
import {
  generateEditPlan,
  parseEditPlan,
  type AiEditPlan,
} from "@/features/certmaker/lib/clone-ai-edit";
import type { CloneSource } from "@/features/certmaker/lib/types";
vi.mock("@/features/certmaker/lib/clone-ai-edit", async (original) => ({
  ...(await original<typeof import("@/features/certmaker/lib/clone-ai-edit")>()),
  generateEditPlan: vi.fn(),
}));
const source = (): CloneSource => ({
  image: "template",
  width: 1000,
  height: 600,
  filename: "test.png",
  kind: "image",
  fields: [cloneField("Name", 100, 100, 200, 40, 0)],
  suggestions: [],
});
const makePlan = (
  c: CloneSource,
  actions = [{ type: "command", fieldId: "clone-0", command: "write Asha" }],
) => parseEditPlan(JSON.stringify({ explanation: "Change name", actions }), c, []);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup(c = source()) {
  const edit = vi.fn();
  const props = {
    clone: c,
    selected: "clone-0",
    variables: [],
    provider: "gemini" as const,
    apiKey: "key",
    model: "test",
    edit,
  };
  const view = render(<CloneAiEditor {...props} />);
  fireEvent.change(screen.getByLabelText("AI editing instruction"), {
    target: { value: "Change the name to Asha" },
  });
  return { c, edit, props, view };
}
function consent() {
  fireEvent.click(screen.getByRole("checkbox", { name: /I agree to send/ }));
}
describe("Clone Mode AI editor", () => {
  it("requires consent and review, then applies the AI plan through the editor", async () => {
    const { c, edit } = setup();
    vi.mocked(generateEditPlan).mockResolvedValue(makePlan(c));
    expect(screen.getByRole("button", { name: "Generate AI edit plan" })).toBeDisabled();
    consent();
    fireEvent.click(screen.getByRole("button", { name: "Generate AI edit plan" }));
    await screen.findByText("Change name");
    expect(edit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply AI edits" }));
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0]![0](c).fields[0].replacement).toBe("Asha");
  });
  it("auto-applies only when opted in", async () => {
    const { c, edit } = setup();
    vi.mocked(generateEditPlan).mockResolvedValue(makePlan(c));
    consent();
    fireEvent.click(screen.getByRole("checkbox", { name: /Automatically apply/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit with AI" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
  });
  it("requires review instead of auto-applying overlapping duplicates", async () => {
    const { c, edit } = setup();
    vi.mocked(generateEditPlan).mockResolvedValue(
      makePlan(c, [
        { type: "command", fieldId: "clone-0", command: "duplicate" },
        { type: "command", fieldId: "clone-1", command: "move to 100, 100" },
      ]),
    );
    consent();
    fireEvent.click(screen.getByRole("checkbox", { name: /Automatically apply/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit with AI" }));
    await screen.findByText("Layout warnings require review before applying.");
    expect(edit).not.toHaveBeenCalled();
  });
  it("discards a response when another edit changes the certificate during the request", async () => {
    const { c, edit, props, view } = setup();
    let finish!: (p: AiEditPlan) => void;
    vi.mocked(generateEditPlan).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    consent();
    fireEvent.click(screen.getByRole("button", { name: "Generate AI edit plan" }));
    view.rerender(
      <CloneAiEditor
        {...props}
        clone={{ ...c, fields: c.fields.map((f) => ({ ...f, replacement: "Typed later" })) }}
      />,
    );
    await act(async () => {
      finish(makePlan(c));
    });
    await screen.findByText(
      "The certificate, selection or instruction changed. Generate a new plan.",
    );
    expect(edit).not.toHaveBeenCalled();
  });
  it("ignores cancelled responses even if the provider resolves after cancellation", async () => {
    const { c, edit } = setup();
    let finish!: (p: AiEditPlan) => void;
    vi.mocked(generateEditPlan).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    consent();
    fireEvent.click(screen.getByRole("button", { name: "Generate AI edit plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel AI editing" }));
    await act(async () => {
      finish(makePlan(c));
    });
    expect(edit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Apply AI edits" })).not.toBeInTheDocument();
  });
  it("invalidates review after changing selected box", async () => {
    const { c, props, view } = setup();
    vi.mocked(generateEditPlan).mockResolvedValue(makePlan(c));
    consent();
    fireEvent.click(screen.getByRole("button", { name: "Generate AI edit plan" }));
    await screen.findByText("Change name");
    view.rerender(<CloneAiEditor {...props} selected={null} />);
    expect(screen.getByRole("button", { name: "Apply AI edits" })).toBeDisabled();
  });
});

it("exposes natural-language AI editing alongside the existing detector in Clone Mode", () => {
  sessionStorage.clear();
  render(
    <CloneAiPanel
      clone={source()}
      selected={"clone-0"}
      variables={[]}
      headers={[]}
      edit={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByRole("region", { name: "AI instruction editing" })).toBeInTheDocument();
  expect(screen.getByLabelText("AI editing instruction")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Google Gemini API key"), { target: { value: "key" } });
  fireEvent.change(screen.getByLabelText("AI editing instruction"), {
    target: { value: "Make the name bold" },
  });
  consent();
  expect(screen.getByRole("button", { name: "Generate AI edit plan" })).toBeEnabled();
});
