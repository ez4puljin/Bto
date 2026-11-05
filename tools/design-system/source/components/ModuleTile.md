An icon tile that opens a module or a page, on the home page and the module pages.

**Rules:** `link` icon on a `secondary` square, the label in `body-medium`. Under the pointer it lifts 2 px to `shadow-popover` and presses to 0.98. The icon is the one fixed in `app/nav-items.ts`.

**Props:** `to`, `icon`, `label`, `variant` (`page`, `action` a larger icon for a shortcut, `home` the home page's flatter tile with a tint under the pointer), `className`.

The code has no such component: this is a thin wrapper in the bundle carrying the exact classes of those two files.
