/** How `categoryPaths` joins a path («Хүнс / Гурил», `@tugeel/shared/catalog`). */
const PATH_SEPARATOR = ' / ';

/**
 * A category's path in a narrow column: the parents give way first («Туршилтын ба… / Ахуйн бараа»)
 * so the category itself stays whole, and is cut with «…» only when it alone is wider than the
 * column; the whole path shows on hover (the cell's `TruncateCell`).
 */
export function CategoryPath({ path }: { path: string }) {
  const parts = path.split(PATH_SEPARATOR);
  const leaf = parts.pop();
  if (parts.length === 0 || leaf === undefined) return path;
  return (
    <span className="flex min-w-0">
      {/* The parents shrink before the category does: theirs is all of the shrinking. */}
      <span className="min-w-0 shrink-[99999] truncate">{parts.join(PATH_SEPARATOR)}</span>
      {/* The separator stays with the category, after the parents' «…». */}
      <span className="min-w-0 truncate">{`\u00a0/ ${leaf}`}</span>
    </span>
  );
}
