/**
 * Which of black and white reads better on a badge background — or `null`
 * when the background can't be read as an opaque colour.
 *
 * Only what can be read exactly is read: `#rgb`, `#rrggbb`, and `rgb()` /
 * `rgba()` with integer channels 0–255 in either comma or space syntax and,
 * if given, an alpha of exactly 1 (whitespace around and letter case don't
 * matter). A translucent colour, a percentage channel, a named colour, and
 * anything unresolved (`var()`, `color-mix()`, `hsl()`) are `null`: what
 * such a badge ends up on — or what it is — isn't known here, and a guess
 * would promise a contrast it can't keep.
 *
 * Between the two, the one with the larger WCAG contrast ratio wins.
 */
export function readableTextOn(background: string): "#000000" | "#ffffff" | null {
  const channels = parseOpaque(background.trim());
  if (channels === null) return null;
  const luminance = relativeLuminance(channels);
  const onWhite = 1.05 / (luminance + 0.05);
  const onBlack = (luminance + 0.05) / 0.05;
  return onBlack > onWhite ? "#000000" : "#ffffff";
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const ALPHA_ONE = String.raw`(?:1|1\.0+)`;
// Channels are integers of any spelling (`000255` included); the range is checked on the number.
const COMMA_RGB = new RegExp(String.raw`^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*${ALPHA_ONE}\s*)?\)$`, "i");
const SPACE_RGB = new RegExp(String.raw`^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*${ALPHA_ONE}\s*)?\)$`, "i");

function parseOpaque(colour: string): [number, number, number] | null {
  const hex = HEX.exec(colour);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit) : [hex[1].slice(0, 2), hex[1].slice(2, 4), hex[1].slice(4, 6)];
    return [parseInt(digits[0], 16), parseInt(digits[1], 16), parseInt(digits[2], 16)];
  }
  const rgb = COMMA_RGB.exec(colour) ?? SPACE_RGB.exec(colour);
  if (!rgb) return null;
  const values: [number, number, number] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return values.every((value) => value <= 255) ? values : null;
}

/** WCAG 2 relative luminance of an sRGB colour. */
function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}
