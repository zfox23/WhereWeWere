import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();
vi.mock('../../src/api/client', () => ({ settings: { get: () => getMock() } }));

afterEach(() => {
  cleanup();
  getMock.mockReset();
  vi.resetModules();
});

async function setup() {
  const { useImmichEnabled } = await import('../../src/hooks/useImmichEnabled');
  const { notifySettingsChanged } = await import('../../src/utils/settingsEvents');
  function Probe() {
    return <div data-testid="v">{String(useImmichEnabled())}</div>;
  }
  return { Probe, notifySettingsChanged };
}

describe('useImmichEnabled', () => {
  it('picks up newly saved Immich settings without a reload', async () => {
    getMock.mockResolvedValueOnce({});
    const { Probe, notifySettingsChanged } = await setup();
    render(<Probe />);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('v').textContent).toBe('false');

    getMock.mockResolvedValueOnce({ immich_url: 'http://immich', immich_api_key: 'k' });
    await act(async () => {
      notifySettingsChanged();
    });
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('true'));
  });

  it('does not memoize a failed load as "disabled"', async () => {
    getMock.mockRejectedValueOnce(new Error('network'));
    const { Probe } = await setup();
    const first = render(<Probe />);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    first.unmount();

    getMock.mockResolvedValueOnce({ immich_url: 'http://immich', immich_api_key: 'k' });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('true'));
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
