# Palette's Journal

## 2024-05-18 - Missing ARIA attributes
**Learning:** Many interactive elements across the application, especially icon-only buttons and tab controls, lack standard ARIA labels and roles, impacting screen reader navigation.
**Action:** Implement a pattern of adding descriptive `aria-label`s to all icon-only buttons and standard `role="tab"` with `aria-selected` attributes for custom tab implementations.
