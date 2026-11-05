A single-line field, 40 px high on a white ground, with a real boundary in `input`.

**When:** any typed value. Dates, months and times use `DateInput`, codes and scans use `ScanBox`, a list's search uses `SearchField`.

**Consumer provides:** an `id` tied to a `Label`, `FormRow` or `FormField`, which set `aria-describedby` and `aria-invalid` on it by that id.

**Rules:** body size on a desktop, 1rem on a phone so it does not zoom. Short values get a width (`sm:w-44` for codes, `sm:w-28` for 3-digit codes); names take the row. Don't use `type="date"`, `"month"` or `"time"`: they speak the browser's language.
