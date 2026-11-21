import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { resetPagedSnapshots } from '../src/hooks/usePagedLibrary';
import { resetScrollPositions } from '../src/hooks/useScrollRestoration';

// Parked rows and scroll positions are module-level; don't let them leak between tests.
afterEach(() => {
  resetPagedSnapshots();
  resetScrollPositions();
});
