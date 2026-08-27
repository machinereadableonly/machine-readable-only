// Shared rasteriser: SVG string -> PNG bytes or RGBA pixels, via resvg (Rust).
import { Resvg } from "@resvg/resvg-js";

export function svgToPng(svg, widthPx = 1024) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: widthPx } });
  return r.render().asPng();
}

export function svgToRgba(svg, widthPx = 1024) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: widthPx } });
  const img = r.render();
  return { data: new Uint8ClampedArray(img.pixels), width: img.width, height: img.height };
}
