-- ============================================================================
-- Data repair: fix malformed Hardcover external_url values on media_items.
--
-- Earlier code generated "https://hardcover.app/book/{slug}" (singular),
-- which 404s on the hardcover.app web app. The canonical format is
-- "https://hardcover.app/books/{slug-or-id}" (plural), which accepts either
-- the book slug or the numeric book id.
-- ============================================================================

UPDATE media_items
SET external_url = 'https://hardcover.app/books/' || substring(external_url FROM 'https://hardcover\.app/book/(\S+)$')
WHERE external_source = 'hardcover'
  AND external_url ~ '^https://hardcover\.app/book/\S+$';
