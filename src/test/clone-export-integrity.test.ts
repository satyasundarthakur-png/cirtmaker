import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DATA, type CertData } from "@/features/certmaker/lib/types";
const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/features/certmaker/lib/render", () => ({ renderToCanvas: render }));
import { exportWith } from "@/features/certmaker/lib/exporter";
const dummy: CertData = {
  ...DEFAULT_DATA,
  cloneMode: true,
  clone: {
    image: "data:image/png;base64,dummy",
    width: 1500,
    height: 1000,
    filename: "dummy-certificate.png",
    kind: "image",
    fields: [],
    suggestions: [],
  },
};
afterEach(() => {
  vi.restoreAllMocks();
  render.mockReset();
});
function successfulCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
    cb(new Blob(["dummy"], { type: "image/png" })),
  );
}
describe("Clone Mode export integrity", () => {
  it("exports at the source width regardless of the selected DPI", async () => {
    successfulCanvas();
    render.mockResolvedValue(undefined);
    await exportWith(dummy, { format: "png", dpi: 72, quality: 1 });
    expect(render).toHaveBeenCalledOnce();
    expect(render.mock.calls[0]![2]).toBe(1500);
  });
  it("reports a native-resolution failure instead of silently downsampling the clone", async () => {
    successfulCanvas();
    render
      .mockRejectedValueOnce(new Error("canvas allocation failed"))
      .mockResolvedValue(undefined);
    await expect(exportWith(dummy, { format: "png", dpi: 300, quality: 1 })).rejects.toThrow(
      "canvas allocation failed",
    );
    expect(render).toHaveBeenCalledOnce();
  });
  it("retains smaller-canvas recovery for generated templates", async () => {
    successfulCanvas();
    render
      .mockRejectedValueOnce(new Error("canvas allocation failed"))
      .mockResolvedValue(undefined);
    await exportWith({ ...DEFAULT_DATA }, { format: "png", dpi: 300, quality: 1 });
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1]![2]).toBeLessThan(render.mock.calls[0]![2]);
  });
});
