/**
 * Pixel word bubble, drawn rather than blitted.
 *
 * WHY NOT THE PNG. assets/'word bubble.png' is 130x75 and carries over 250
 * distinct colors — the outline reads as 1,1,1 and 0,1,0 and 2,4,6 and 20,20,20
 * rather than one black, with semi-transparent gray smeared along the edges. It
 * has been resampled from something smaller; it is not authored on a pixel grid.
 * Nine-slicing it would tile that mush into every bubble, and the outline
 * thickness varies enough that the slices would not butt cleanly.
 *
 * So this reproduces its DESIGN in three colors: white fill, black outline,
 * and the light blue-gray inner shadow along the bottom that the original does
 * have. Drawing it also solves what an image cannot — text length is arbitrary,
 * so width AND height vary, and the tail has to point at somebody who could be
 * standing anywhere.
 *
 * Sized in SCREEN pixels, not scene pixels. Precedent is x.png, which is loaded
 * outside the sprite pipeline because "it is UI, not world art: it sits on top
 * of the finished scene and must not scale with the house". Text has a
 * legibility floor a house does not, and a pixel face is only crisp near the
 * size it was drawn for.
 */

export const BUBBLE_FONT = '16px Minecraft, ui-monospace, monospace';

const FILL = '#ffffff';
const INK = '#000000';
/** Sampled from the original's inner bottom edge. */
const SHADOW = '#cccfd7';

const PAD_X = 9;
const PAD_Y = 7;
const LINE_H = 19;
const BORDER = 2;
/** Corner notch, in pixels. What makes it read as drawn rather than rounded. */
const NOTCH = 3;
const SHADOW_H = 3;
const TAIL_W = 12;
const TAIL_H = 9;
const MAX_W = 240;
/** Clearance between the tail's point and the speaker's head. */
const LIFT = 6;

/** Greedy wrap to MAX_W. Returns the lines and the width actually needed. */
function wrap(ctx: CanvasRenderingContext2D, text: string): { lines: string[]; w: number } {
  ctx.font = BUBBLE_FONT;
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > MAX_W) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
  return { lines, w: Math.ceil(w) };
}

/**
 * Draw a bubble whose tail points down at (tipX, tipY).
 *
 * The body is clamped to stay on screen while the tail keeps pointing at the
 * speaker, so somebody near the edge of the lot still gets a readable bubble
 * instead of one running off the side.
 */
export function drawBubble(
  ctx: CanvasRenderingContext2D,
  text: string,
  tipX: number,
  tipY: number,
  stageW: number,
): void {
  const { lines, w: textW } = wrap(ctx, text);
  const bw = textW + PAD_X * 2;
  const bh = lines.length * LINE_H + PAD_Y * 2;

  const bottom = Math.round(tipY - LIFT - TAIL_H);
  const top = bottom - bh;
  // Clamp the BODY, not the tail. 4px off the edge so it never touches.
  const left = Math.round(Math.min(Math.max(4, tipX - bw / 2), stageW - bw - 4));

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Outline first as a solid slab, then the fill inset — cheaper than stroking
  // and guaranteed to give a hard, even 2px edge at any size.
  ctx.fillStyle = INK;
  rect(ctx, left, top, bw, bh);
  ctx.fillStyle = FILL;
  rect(ctx, left + BORDER, top + BORDER, bw - BORDER * 2, bh - BORDER * 2);
  // The original has a band of cool gray inside the bottom edge. It is what
  // stops the bubble reading as a plain white box.
  ctx.fillStyle = SHADOW;
  ctx.fillRect(left + BORDER + NOTCH, top + bh - BORDER - SHADOW_H, bw - (BORDER + NOTCH) * 2, SHADOW_H);

  // Tail: a stepped wedge rather than a smooth triangle, so it belongs to the
  // same grid as the body. Kept inside the body's span so it always has a
  // border to hang off, even when the body has been clamped away from the tip.
  const tx = Math.round(Math.min(Math.max(left + NOTCH + 2, tipX - TAIL_W / 2), left + bw - TAIL_W - NOTCH - 2));
  ctx.fillStyle = INK;
  for (let i = 0; i < TAIL_H; i++) {
    const shrink = Math.round((i / TAIL_H) * TAIL_W);
    ctx.fillRect(tx + shrink, top + bh + i, Math.max(2, TAIL_W - shrink), 1);
  }
  ctx.fillStyle = FILL;
  for (let i = 0; i < TAIL_H - BORDER; i++) {
    const shrink = Math.round((i / TAIL_H) * TAIL_W);
    const wdt = Math.max(0, TAIL_W - shrink - BORDER * 2);
    if (wdt > 0) ctx.fillRect(tx + shrink + BORDER, top + bh + i - 1, wdt, 1);
  }

  ctx.fillStyle = INK;
  ctx.textBaseline = 'top';
  ctx.font = BUBBLE_FONT;
  lines.forEach((l, i) => {
    ctx.fillText(l, left + PAD_X, top + PAD_Y + i * LINE_H + 1);
  });
  ctx.restore();
}

/** A rectangle with its corners notched off, which is what makes it pixel art. */
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillRect(x + NOTCH, y, w - NOTCH * 2, h);
  ctx.fillRect(x, y + NOTCH, w, h - NOTCH * 2);
  // Fill the diagonal steps the two bars leave open at each corner.
  for (let i = 0; i < NOTCH; i++) {
    const inset = NOTCH - i - 1;
    ctx.fillRect(x + inset, y + i, w - inset * 2, 1);
    ctx.fillRect(x + inset, y + h - i - 1, w - inset * 2, 1);
  }
}
