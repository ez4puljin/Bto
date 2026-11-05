A pick-one control: `NativeSelect` draws a real `<select>` like the fields, and most of the app uses it because phones and screen readers handle it natively.

**When:** `NativeSelect` for forms and filters, working with react-hook-form's `register()`. `variant="filter"` is a pill of a list's filter bar, tinted `secondary` while its value is not the "all" option or as `active` says. Use the Radix `Select` only where an item needs more than text.

**Consumer provides:** the options; a first plain option such as «Агуулах сонгоно уу» under a visible label, or a self-naming «Бүх агуулах» for a lone pill.

**Don't** write «Хаанаас: …» into a select under a label.
