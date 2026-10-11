import { fireEvent, render, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CloneOverlay from "@/features/certmaker/components/CloneOverlay";
import { cloneField } from "@/features/certmaker/lib/clone";

afterEach(cleanup);
const clone = { image: "template", filename: "template.png", kind: "image" as const, width: 1000, height: 600, fields: [{ ...cloneField("Original", 100, 100, 200, 40, 0), label: "Name" }], suggestions: [] };

describe("clone text entry", () => {
  it("commits Enter once and cancels Escape without changing text", () => {
    const change = vi.fn();
    render(<CloneOverlay clone={clone} selected="clone-0" onSelect={vi.fn()} onChange={change} onRemove={vi.fn()} />);
    const box = screen.getByRole("button");
    fireEvent.doubleClick(box);
    let input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "New value" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(change).toHaveBeenCalledExactlyOnceWith("clone-0", { replacement: "New value" });
    fireEvent.doubleClick(box);
    input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(change).toHaveBeenCalledOnce();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});