The row above a list: search, filter pills, toggles, and at its end the column chooser.

**Parts:** `SearchField` (still `type="search"`, with a magnifier), `NativeSelect variant="filter"`, `FilterToggle` (a yes/no pill, still a checkbox), `DateFilter`, `Combobox`, `FilterChip` (a chosen record with its clear button).

**Consumer provides:** `children` and `end`. Filters live in the URL.

**Rules:** an active pill is tinted `secondary`. A list with many filters adds an outline «Шүүлтүүр» menu; each field opens a small dialog, active ones show as chips, and «Бүгдийг арилгах» appears from two on. The count they keep goes in the header's `meta`.
