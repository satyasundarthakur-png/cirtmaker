import { z } from "zod";
import type { EditCommand } from "./types";
export const AVAILABLE_FONTS = [
  "Inter",
  "Montserrat",
  "Playfair Display",
  "Cormorant Garamond",
  "Great Vibes",
  "Noto Sans Oriya",
  "Noto Sans Devanagari",
  "serif",
  "sans-serif",
] as const;
const finite = z.number().finite();
const targets = z.array(z.string().min(1).max(100)).min(1).max(200).optional();
const styleSchema = z
  .object({
    font: z.enum(AVAILABLE_FONTS).optional(),
    fontSize: finite.min(1).max(4096).optional(),
    fontWeight: finite.int().min(100).max(900).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    color: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .optional(),
    wordSpacing: finite.min(-20).max(100).optional(),
    kerning: z.enum(["normal", "none"]).optional(),
    slantAngle: finite.min(-24).max(24).optional(),
    baselineShift: finite.min(-4096).max(4096).optional(),
    letterSpacing: finite.min(-20).max(100).optional(),
    lineHeight: finite.min(0.5).max(5).optional(),
    opacity: finite.min(0).max(1).optional(),
    textEffects: z
      .object({
        strokeColor: z.string().regex(/^#[\da-f]{6}$/i),
        strokeWidth: finite.min(0).max(20),
        shadowColor: z.string().regex(/^#[\da-f]{6}$/i),
        shadowBlur: finite.min(0).max(50),
        shadowX: finite.min(-50).max(50),
        shadowY: finite.min(-50).max(50),
      })
      .strict()
      .optional(),
  })
  .strict();
const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replace"), text: z.string().max(4000), targets }).strict(),
  z
    .object({
      type: z.literal("add"),
      text: z.string().min(1).max(4000),
      x: finite.nonnegative().optional(),
      y: finite.nonnegative().optional(),
    })
    .strict(),
  ...(["delete", "duplicate", "lock", "match"] as const).map((type) =>
    z.object({ type: z.literal(type), targets }).strict(),
  ),
  z
    .object({
      type: z.literal("move"),
      dx: finite.min(-100000).max(100000),
      dy: finite.min(-100000).max(100000),
      targets,
    })
    .strict(),
  z
    .object({
      type: z.literal("resize"),
      width: finite.positive().max(100000).optional(),
      height: finite.positive().max(100000).optional(),
      scale: finite.min(0.1).max(10).optional(),
      targets,
    })
    .strict(),
  z.object({ type: z.literal("rotate"), degrees: finite.min(-360).max(360), targets }).strict(),
  z.object({ type: z.literal("style"), style: styleSchema, targets }).strict(),
  z
    .object({
      type: z.literal("align"),
      axis: z.enum(["horizontal", "vertical", "center"]),
      targets,
    })
    .strict(),
]);
const resultSchema = z
  .object({ explanation: z.string().max(2000), commands: z.array(commandSchema).max(50) })
  .strict();
const unquote = (s: string) => s.trim().replace(/^("|')([\s\S]*)\1$/, "$2");
export class CommandParser {
  static parseResponse(raw: string): { explanation: string; commands: EditCommand[] } {
    try {
      const result = resultSchema.parse(
        JSON.parse(
          raw
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "")
            .trim(),
        ),
      );
      return result as { explanation: string; commands: EditCommand[] };
    } catch {
      throw new Error("AI returned an invalid or unsupported edit plan. Nothing changed.");
    }
  }
  static validate(commands: EditCommand[]) {
    return z.array(commandSchema).min(1).max(50).parse(commands);
  }
  static local(instruction: string): EditCommand[] | null {
    const text = instruction.trim();
    let m: RegExpMatchArray | null;
    if (!text || text.length > 4000) throw new Error("Enter an instruction of 1–4000 characters.");
    if (
      (m = text.match(
        /^(?:replace(?:\s+(?:this|all selected names|all selected fields|text))?\s+(?:with|to)|write|set text to)\s+([\s\S]+)$/i,
      ))
    )
      return [{ type: "replace", text: unquote(m[1]!) }];
    if ((m = text.match(/^add(?: text)?\s+([\s\S]+)$/i)))
      return [{ type: "add", text: unquote(m[1]!) }];
    if (
      /^(?:delete|remove)(?:\s+(?:this|selected))?(?:\s+text)?(?:\s+layer)?$/i.test(text) ||
      /^erase(?: this| text)?$/i.test(text)
    )
      return [{ type: "delete" }];
    if (/^(?:duplicate|replicate)(?: this| selected(?: layers?)?)?$/i.test(text))
      return [{ type: "duplicate" }];
    if (/^(?:match(?: this)? style|make all selected fields use matching style)$/i.test(text))
      return [{ type: "match" }];
    if (/^lock(?: this| selected(?: layers?)?)?$/i.test(text)) return [{ type: "lock" }];
    if (
      (m = text.match(
        /^move(?: this)?\s+(?:(slightly)\s+)?(?:(\d+(?:\.\d+)?)\s*(?:px|pixels)?\s+)?(up|down|left|right)(?:\s+(\d+(?:\.\d+)?)\s*(?:px|pixels)?)?$/i,
      ))
    ) {
      const amount = Number(m[2] ?? m[4] ?? 10);
      const dir = m[3]!.toLowerCase();
      return [
        {
          type: "move",
          dx: /left|right/.test(dir) ? amount * (dir === "left" ? -1 : 1) : 0,
          dy: /up|down/.test(dir) ? amount * (dir === "up" ? -1 : 1) : 0,
        },
      ];
    }
    if (/^make(?: this)? (larger|smaller)$/i.test(text))
      return [{ type: "resize", scale: /larger$/i.test(text) ? 1.15 : 0.85 }];
    if ((m = text.match(/^resize(?: this)? to (\d+(?:\.\d+)?)\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)$/i)))
      return [{ type: "resize", width: Number(m[1]), height: Number(m[2]) }];
    if ((m = text.match(/^rotate(?: this)?\s+(-?\d+(?:\.\d+)?)\s*(?:degrees?|°)?$/i)))
      return [{ type: "rotate", degrees: Number(m[1]) }];
    if (/^(?:center(?: this| all selected fields)?|centre(?: this)?)$/i.test(text))
      return [{ type: "align", axis: "center" }];
    if (/^align horizontally$/i.test(text)) return [{ type: "align", axis: "horizontal" }];
    if (/^align vertically$/i.test(text)) return [{ type: "align", axis: "vertical" }];
    if ((m = text.match(/^align (left|center|right)$/i)))
      return [
        { type: "style", style: { align: m[1]!.toLowerCase() as "left" | "center" | "right" } },
      ];
    if ((m = text.match(/^(?:change )?colou?r(?: to)?\s+(#[\da-f]{6})$/i)))
      return [{ type: "style", style: { color: m[1]! } }];
    if ((m = text.match(/^font size(?: to)?\s+(\d+(?:\.\d+)?)$/i)))
      return [{ type: "style", style: { fontSize: Number(m[1]) } }];
    if ((m = text.match(/^font(?: to)?\s+(.+)$/i))) {
      const font = AVAILABLE_FONTS.find((f) => f.toLowerCase() === m![1]!.toLowerCase());
      if (font) return [{ type: "style", style: { font } }];
    }
    if ((m = text.match(/^(bold|italic)\s+(on|off)$/i)))
      return [{ type: "style", style: { [m[1]!.toLowerCase()]: m[2]!.toLowerCase() === "on" } }];
    if ((m = text.match(/^(letter spacing|line height|opacity)(?: to)?\s+(-?\d+(?:\.\d+)?)$/i)))
      return [
        {
          type: "style",
          style: {
            [/letter/i.test(m[1]!)
              ? "letterSpacing"
              : /line/i.test(m[1]!)
                ? "lineHeight"
                : "opacity"]: Number(m[2]),
          },
        },
      ];
    return null;
  }
}
