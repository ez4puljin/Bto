The top of every page: the menu's breadcrumb, a large title with ☆, a meta row and the actions on the title's line.

**Props:** `title`, `meta` (codes, status, dates), `description` (one muted line saying what the page is for), `actions`, `media` (a picture beside the title), `crumbs` (pages two levels deep), `compact` (the reports' paper pages: one row of breadcrumb and actions, the title only naming the tab). It also names the browser tab «Title · Bto».

**Rules:** the breadcrumb comes from the menu, and a crumb that repeats the title is dropped. It brings its own `space-4` below: wrap the page in `space-y-4`, never a flex column with a gap.

**Don't** put paragraphs in `meta`, loose lines under the title, or a «Буцах» button.

The ☆ shows on a menu page only (the first header), and stars it in this browser.
