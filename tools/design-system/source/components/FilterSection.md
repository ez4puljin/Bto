A list's filters as a panel on its left: sections that fold, each a filter with its choices.

**Parts:** `FilterSection` (the filter's name; a dot while it filters), `FilterOption` (one choice, ticked while it filters, with an optional `hint` such as a count), `FilterChoices` (a fixed set of options, each lifting itself when picked again), `FilterTree` (a tree of rows with their codes and counts; with `searchLabel`, a box that narrows it to the rows found, each with the way to it below).

**Consumer provides:** the values and their setters, read from and written to the URL like every filter; a tree's rows as a flat list of `{ id, parentId, title, name, code?, count }` with each count including what is below.

**Rules:** the panel is a `w-64` `ListCard scroll beside` in an `aside` with an `aria-label`, shown from `lg`; below `lg` the `FilterBar` holds the same filters. The first section starts open (`defaultOpen`), a section in use opens by itself. Picking the chosen row again lifts the filter. A row chosen from a link shows its branch open. One filter per section; a filter with more than a dozen choices gets a tree or a search box, not a longer list.
