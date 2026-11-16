import { useState } from 'react';
import type { RecordPeek } from './book-links';
import { RecordPeekPanel } from './record-peek';

/** A record to open over a page that is not a book report: the opener and its panel. */
export function usePeek() {
  const [peek, setPeek] = useState<RecordPeek | null>(null);
  return {
    open: setPeek,
    panel: <RecordPeekPanel peek={peek} onClose={() => setPeek(null)} />,
  };
}
