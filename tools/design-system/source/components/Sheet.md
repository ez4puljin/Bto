A record in a wide panel from the right, the shell still in view behind it: the number, a description line, badges and actions in the header, the sections below it scrolling.

**Props:** `RecordSheet({ open, onClose, size, title, description, badges, actions, children })`; `size` is `record` (`sheet-record`: finance and the supermarket) or `panel` (`sheet-panel`: a record people work in).

**Rules:** it opens from a URL parameter (`?invoice=`, `?shift=`), so a row, a ledger line or another record links straight to it. It takes the whole screen on a phone. `SheetFooter` sticks to the foot. Closing with unsaved edits asks first. A long item form uses a plain `Sheet` with `Tabs`.
