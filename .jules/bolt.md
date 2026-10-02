## 2025-05-15 - Memoizing Intl.DateTimeFormat in large lists
**Learning:** Instantiating new `Intl.DateTimeFormat` objects inside rendering loops or list processors (like `getLocalDateKey` and `formatDateHeader`) is surprisingly expensive and can cause synchronous main-thread blocking when rendering large timeline feeds.
**Action:** Always memoize and reuse `Intl.DateTimeFormat` (or `Date.prototype.toLocaleDateString` which internally recreates the formatter) in performance-critical paths and large lists.
