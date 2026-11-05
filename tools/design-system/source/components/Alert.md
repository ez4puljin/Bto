A box beside what failed: `ProblemAlert` turns an API problem into a red alert in Mongolian, with its amounts formatted and a retry.

**When:** above the list or the footer that failed. A failed load passes its query's `refetch` as `onRetry`, and the alert offers «Дахин оролдох». A system error names its request id so the owner can find it in the log.

**Consumer provides:** `problem` (RFC 9457 with a stable `code` and `params`) and `onRetry`. `Alert` takes `variant`, plus `AlertTitle`, `AlertDescription` and `AlertAction` as children.

**Don't** show an error as a toast, or leave an error with no way out.
