import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import '@/lib/i18n';
import { DateInput, MonthInput, TimeInput } from './date-input';

function Controlled(props: { initial?: string; refuseAfter?: string; min?: string }) {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <>
      <DateInput
        aria-label="day"
        value={value}
        min={props.min}
        onChange={(next) => {
          if (props.refuseAfter && next > props.refuseAfter) return;
          setValue(next);
        }}
      />
      <output data-testid="value">{value || 'none'}</output>
    </>
  );
}

const shown = () => screen.getByTestId('value').textContent;

describe('the Mongolian date inputs (owner 2026-11-01)', () => {
  it('takes a date typed in full, a short one on leaving the box', async () => {
    render(<Controlled initial="2026-10-31" />);
    const user = userEvent.setup();
    const box = screen.getByLabelText('day');
    await user.clear(box);
    expect(shown()).toBe('none');
    await user.type(box, '2026-10-15');
    expect(shown()).toBe('2026-10-15');
    await user.clear(box);
    await user.type(box, '2026.1.5');
    expect(shown()).toBe('none');
    await user.tab();
    expect(shown()).toBe('2026-01-05');
    expect(box).toHaveValue('2026-01-05');
  });

  it('shows the kept value when the caller refuses a day, and undoes a broken text', async () => {
    render(<Controlled initial="2026-10-31" refuseAfter="2026-10-31" />);
    const box = screen.getByLabelText('day');
    fireEvent.change(box, { target: { value: '2999-01-01' } });
    expect(box).toHaveValue('2026-10-31');
    const user = userEvent.setup();
    await user.clear(box);
    await user.type(box, '2026-13');
    await user.tab();
    expect(box).toHaveValue('');
  });

  it('picks a day on a Mongolian calendar, Monday first, days before the minimum closed', async () => {
    render(<Controlled initial="2026-11-05" min="2026-11-03" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: mn.common.calendar.open }));
    expect(screen.getByText('2026 оны 11-р сар')).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя', 'Ня']);
    expect(screen.getByRole('gridcell', { name: '2026 оны 11-р сарын 2' })).toBeDisabled();
    await user.click(screen.getByRole('gridcell', { name: '2026 оны 11-р сарын 20' }));
    expect(shown()).toBe('2026-11-20');
  });

  it('moves by keyboard and changes the month', async () => {
    render(<Controlled initial="2026-11-30" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: mn.common.calendar.open }));
    await user.keyboard('{ArrowRight}{Enter}');
    expect(shown()).toBe('2026-12-01');
  });

  it('picks a month and a 24-hour time', async () => {
    function Both() {
      const [month, setMonth] = useState('2026-10');
      const [time, setTime] = useState('08:30');
      return (
        <>
          <MonthInput aria-label="month" value={month} onChange={setMonth} />
          <TimeInput aria-label="time" value={time} onChange={setTime} />
          <output data-testid="both">{`${month} ${time}`}</output>
        </>
      );
    }
    render(<Both />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: mn.common.calendar.open }));
    await user.click(screen.getByRole('button', { name: '3-р сар' }));
    const time = screen.getByLabelText('time');
    await user.clear(time);
    await user.type(time, '1745');
    expect(screen.getByTestId('both').textContent).toBe('2026-03 17:45');
  });
});
