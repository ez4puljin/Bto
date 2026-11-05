Asks before an action that cannot be undone from the screen: delete, retire, post.

**Props:** `open`, `title`, `description`, `confirmLabel`, `variant` (`default`, `destructive`, the default), `initialFocus` (`confirm`, `first`), `pending`, `disabled`, `problem`, `onConfirm`, `onClose`, `children`.

**Rules:** a `default` confirmation (posting, approving) gives its main button the focus, so Enter confirms, as the preview shows. A destructive one keeps «Болих» first in line. Use `initialFocus="first"` when it holds a field to type. A step that can be taken back asks nothing. Refusals show inside it through `problem`.
