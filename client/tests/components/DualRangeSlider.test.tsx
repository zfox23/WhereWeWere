import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DualRangeSlider from '../../src/components/DualRangeSlider';

function renderSlider(props: Partial<Parameters<typeof DualRangeSlider>[0]> = {}) {
  const onLowChange = props.onLowChange ?? vi.fn();
  const onHighChange = props.onHighChange ?? vi.fn();
  const utils = render(
    <DualRangeSlider
      min={0}
      max={9}
      lowValue={0}
      highValue={9}
      lowLabel="low handle"
      highLabel="high handle"
      {...props}
      onLowChange={onLowChange}
      onHighChange={onHighChange}
    />
  );
  return { ...utils, onLowChange, onHighChange };
}

describe('DualRangeSlider', () => {
  afterEach(cleanup);

  it('renders two range inputs with the given values', () => {
    renderSlider({ lowValue: 2, highValue: 7 });
    const low = screen.getByRole('slider', { name: 'low handle' });
    const high = screen.getByRole('slider', { name: 'high handle' });
    expect(low).toHaveAttribute('value', '2');
    expect(high).toHaveAttribute('value', '7');
    expect(low).toHaveAttribute('min', '0');
    expect(low).toHaveAttribute('max', '9');
  });

  it('reports value changes from each handle', () => {
    const { onLowChange, onHighChange } = renderSlider();
    fireEvent.change(screen.getByRole('slider', { name: 'low handle' }), {
      target: { value: '4' },
    });
    expect(onLowChange).toHaveBeenCalledWith(4);
    fireEvent.change(screen.getByRole('slider', { name: 'high handle' }), {
      target: { value: '3' },
    });
    expect(onHighChange).toHaveBeenCalledWith(3);
  });

  it('keeps the handles minGap apart', () => {
    const { onLowChange, onHighChange } = renderSlider({
      minGap: 1,
      lowValue: 4,
      highValue: 5,
    });
    // Low handle trying to cross the high handle is clamped to high - minGap.
    fireEvent.change(screen.getByRole('slider', { name: 'low handle' }), {
      target: { value: '9' },
    });
    expect(onLowChange).toHaveBeenCalledWith(4);
    // High handle trying to cross the low handle is clamped to low + minGap.
    fireEvent.change(screen.getByRole('slider', { name: 'high handle' }), {
      target: { value: '0' },
    });
    expect(onHighChange).toHaveBeenCalledWith(5);
  });

  it('clamps values to the min/max bounds', () => {
    const { onLowChange, onHighChange } = renderSlider({
      min: 2,
      max: 10,
      lowValue: 5,
      highValue: 8,
    });
    fireEvent.change(screen.getByRole('slider', { name: 'low handle' }), {
      target: { value: '0' },
    });
    expect(onLowChange).toHaveBeenCalledWith(2);
    fireEvent.change(screen.getByRole('slider', { name: 'high handle' }), {
      target: { value: '100' },
    });
    expect(onHighChange).toHaveBeenCalledWith(10);
  });

  it('renders optional end captions', () => {
    renderSlider({ minLabel: '9:41 AM', maxLabel: '10:02 AM' });
    expect(screen.getByText('9:41 AM')).toBeInTheDocument();
    expect(screen.getByText('10:02 AM')).toBeInTheDocument();
  });
});
