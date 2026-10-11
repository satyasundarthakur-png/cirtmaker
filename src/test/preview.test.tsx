import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Preview from "@/features/certmaker/components/Preview";
import { DEFAULT_DATA } from "@/features/certmaker/lib/types";

const mocks = vi.hoisted(() => ({ render: vi.fn(), draw: vi.fn() }));
vi.mock("@/features/certmaker/lib/render", () => ({ certHeight: () => 700, renderToCanvas: mocks.render }));
vi.mock("@/features/certmaker/components/CloneOverlay", () => ({ default: () => null }));

beforeEach(() => {
  vi.useFakeTimers();
  mocks.render.mockReset();
  mocks.draw.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: mocks.draw } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("preview lifecycle", () => {
  it("discards an old frame while the next edit is pending", async () => {
    let finish: ((regions: []) => void) | undefined;
    mocks.render.mockImplementationOnce(() => new Promise<[]>((resolve) => { finish = resolve; }));
    mocks.render.mockResolvedValueOnce([]);
    const props = { selected: null, onSelect: vi.fn() };
    const view = render(<Preview {...props} data={DEFAULT_DATA} />);
    await act(async () => { vi.advanceTimersByTime(60); });
    view.rerender(<Preview {...props} data={{ ...DEFAULT_DATA, recipient: "Latest edit" }} />);
    await act(async () => { finish?.([]); });
    expect(mocks.draw).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(60); });
    expect(mocks.draw).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("clears loading on failure and recovers on a fresh edit", async () => {
    mocks.render.mockRejectedValueOnce(new Error("Image could not be loaded"));
    mocks.render.mockResolvedValueOnce([]);
    const props = { selected: null, onSelect: vi.fn() };
    const view = render(<Preview {...props} data={DEFAULT_DATA} />);
    await act(async () => { vi.advanceTimersByTime(60); });
    expect(screen.getByRole("alert")).toHaveTextContent("Image could not be loaded");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    view.rerender(<Preview {...props} data={{ ...DEFAULT_DATA, recipient: "Fresh edit" }} />);
    await act(async () => { vi.advanceTimersByTime(60); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.draw).toHaveBeenCalledOnce();
  });
});