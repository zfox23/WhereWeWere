/** /place-patterns/:kind.svg — place-based background patterns (Settings > Display > Background), drawn as a black-on-transparent SVG used as a CSS mask. */

import { Router, Request, Response } from 'express';
import { currentUserId } from '../../../server/src/auth/context';
import { PLACE_PATTERN_KINDS, getPlacePattern, type PlacePatternKind } from '../services/placePatterns';

export const placePatternsRouter = Router();
placePatternsRouter.get('/:file', async (req: Request, res: Response) => {
  const file = String(req.params.file);
  const kind = file.replace(/\.svg$/, '') as PlacePatternKind;
  if (!file.endsWith('.svg') || !PLACE_PATTERN_KINDS.includes(kind)) {
    return res.status(404).json({ error: 'Unknown pattern' });
  }
  try {
    const svg = await getPlacePattern(currentUserId(), kind);
    if (!svg) return res.status(404).json({ error: 'No check-ins to draw yet' });
    res.setHeader('Content-Type', 'image/svg+xml');
    // Drawn from this user's check-ins: private. Short-lived so new
    // check-ins appear, though the server only re-renders daily anyway.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.send(svg);
  } catch (err) {
    console.error('Error rendering place pattern:', err);
    res.status(502).json({ error: 'Failed to draw the pattern' });
  }
});
