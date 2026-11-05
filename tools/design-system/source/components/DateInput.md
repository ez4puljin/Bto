Every date, month and time field: the value stays text that can be typed, and a button opens a Mongolian calendar.

**When:** `DateInput`, `MonthInput`, `TimeInput` everywhere a date, month or time is asked; `DateFilter` and `DateRangeFilter` build the pills of a filter bar on them.

**Props:** `id`, `value` (`YYYY-MM-DD`, `YYYY-MM`, `HH:mm` in 24 hours), `onChange(value)`, `min`, `max`, `required`, `variant` (`filter`, `bare`), `label`.

**Behaviour:** `2026.11.01`, `20261101` and `0830` are accepted too. The calendar reads «2026 оны 11-р сар», «Да … Ня», Monday first, with ← → ↑ ↓ PgUp PgDn, «Өнөөдөр» and «Цэвэрлэх». A react-hook-form field goes through a `Controller`.

**Don't** use `<input type="date">`.
