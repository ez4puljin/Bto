An on/off value that takes effect or saves with its form; `toggle` green when on, and nothing else in the app is that green.

**When:** every yes/no setting. In a `FormRow` use `align="center"`, which keeps it on its label's line.

**Consumer provides:** an `id` tied to a `Label`, `checked`, `onCheckedChange`. Tests find it by `getByRole('switch', { name })`.
