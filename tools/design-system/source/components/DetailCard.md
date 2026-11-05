A record's card, read first and edited in place: «Засах» switches it to its form, Cancel or a successful save returns to reading.

**Parts:** `DetailCard({ title, canEdit, view, edit: (close) => form, actions })` and `FieldList({ items, title, description, columns })`, whose rows match `FormRow`, so the card does not jump. While editing, the card shows an «Засаж байна» badge.

**Rules:** entering the form focuses its first field; leaving gives the focus back to «Засах». Without the right, people only read. An empty value shows «—». From 80rem wide a `FieldList` runs two pairs a line; `columns={1}` keeps one for long values.
