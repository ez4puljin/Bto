The white card a list's table sits in; the table runs to its edges, with its loading rows, its empty state and «Цааш үзэх».

**Parts:** `ListCard` (`scroll`: the main list of a menu page fits the window, scrolls inside itself and keeps its header row and sideways scrollbar in view), `SkeletonRows({ columns, rows })`, `EmptyState({ title, icon, action, onClearFilters })`, `LoadMore({ query })` for keyset pages.

**Rules:** one list page reads `PageHeader`, `FilterBar`, `ProblemAlert`, `ListCard scroll`. Below 288 px of room the card does not scroll by itself, so there is never a scroll inside a scroll. An empty state says what is empty and offers the action that fills it.
