# Postcard Front: Full-Bleed Mosaic Collage

Replace the row of square, cropped thumbnails on the postcard front with a
true collage: every image keeps its **original aspect ratio** (no cropping),
images are **resized to fill the entire front edge-to-edge** with no gaps, and
the card **grows taller as needed** to fit all images.

## Layout: proportional-width horizontal stripes ("mosaic")

For each row of the collage, images share one height `h` and get widths
proportional to their aspect ratios:

```
row: images i with aspect a_i = w_i / h_i
row height  h = W / Σ a_i          (W = card width)
image width w_i = W · a_i / Σ a_i  (so widths sum to exactly W)
```

This tiles the card perfectly — full width, no gaps, zero distortion, zero
cropping (the container's w/h ratio for each image equals its natural ratio).

Rows are formed **greedily** over the images in their (narrative) order: keep
adding an image to the current row while `Σ a_i ≤ TARGET` (≈ 3.5); otherwise
start a new row. Consequences:

- 10 landscape (3:2) images → 3 per row, ~4 rows ≈ 0.9× width tall.
- 10 portrait (2:3) images → 4 per row, 3 rows ≈ 1.1× width tall.
- The card naturally becomes a vertical rectangle; that is the requested
  "increase the height to fit all images".

Narrative order is preserved: reading left-to-right, top-to-bottom matches the
order of the postcard text's subjects.

## Where aspect ratios come from

1. **EXIF from Immich (primary)** — both postcard searches (`/api/search/smart`
   and the metadata backfill) add `withExif: true`; the server stores
   `exifImageWidth`/`exifImageHeight` as `width`/`height` on each
   `PostcardImage` (JSONB — no migration). New postcards lay out instantly.
2. **Client measurement (fallback)** — old persisted postcards have no
   dimensions. A `useImageAspectRatios(images)` hook seeds ratios from
   `width/height` (default 4:3 until measured) and updates them from
   `naturalWidth/naturalHeight` on `onLoad`, re-running the layout. Broken
   images (existing 404 handling) keep the 4:3 placeholder.

## Component changes — `client/src/components/PostcardSection.tsx`

- **Card sizing:** remove the fixed `aspectRatio: '3 / 2'`. The front becomes
  the in-flow, height-defining face; the back stays `absolute inset-0` (so it
  always matches). The back's message already scrolls
  (`overflow-y-auto`), so extra height just gives the message more room.
- **Front:** full-bleed — drop the `p-2`/flex-rail; the collage fills
  `inset-0`. The "View in Immich ↗" chip stays as an overlay.
- **Rendering:** each computed row is a `flex` div of exact-height images
  (`width: a_i/Σa %`, `height: h px`, `object-cover` as a sub-pixel
  safeguard — with exact ratios nothing is cropped). Row container uses the
  measured card width via `ref` + `ResizeObserver`.
- **Empty state:** no images → existing placeholder with a min height
  (~3/2 aspect) so the card is still flip-able.

## Files

| File | Change |
| --- | --- |
| `server/src/routes/llm.ts` | `withExif: true` in both searches; map `exifImageWidth/Height` → `width/height` on `PostcardImage` |
| `client/src/api/client.ts` | `PostcardImage` gains optional `width?: number; height?: number` |
| `client/src/utils/postcardCollage.ts` | new pure `computeCollageRows(images, width, target)` → rows of `{ id, widthPct }` + `rowHeightPx` |
| `client/tests/utils/postcardCollage.test.ts` | new — ratio math, greedy row packing, single/empty list, portrait/landscape mixes |
| `client/src/components/PostcardSection.tsx` | dynamic card height, full-bleed mosaic, ratio hook, ResizeObserver |
| `client/tests/components/PostcardSection.test.tsx` | adjust: full-bleed rows render N images, no fixed aspect, flip still works |
| `server/tests/integration/postcard.integration.test.ts` | mock Immich assets include EXIF dims; assert `width`/`height` persisted |

## Out of scope

- Re-ordering images client-side (server already sets narrative order).
- Masonry (vertical) layout — the stripe mosaic guarantees perfect fill.
- Changing the back of the postcard.
