A dark pill that confirms a step and leaves by itself: the theme's text colour as its ground, white as its text.

**When:** after a save that stays on the page, or after each step of a document. Call `toast.success(text)` or `toast.info(text)`; `AppProviders` mounts `Toaster` once.

**Behaviour:** at the bottom of the screen, at the top on phones so the keyboard never covers it; above `StickyActions` while one shows; pauses under the pointer; one polite `status` each.

**Don't** report an error with it: errors go in `ProblemAlert` beside what failed. Don't write green "saved" text next to buttons.
