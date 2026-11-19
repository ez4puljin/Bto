import { useCallback, useEffect, useRef, useState } from 'react';
import { readJson, writeJson } from '../device/storage';

/**
 * A value kept on the phone under `key`: read once (`ready` is false until then), written 300 ms
 * after each change; an `empty` value removes the key.
 */
export function useStored<T>(
  key: string,
  initial: T,
  parse: (stored: unknown) => T,
  isEmpty: (value: T) => boolean,
) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const parseRef = useRef(parse);
  parseRef.current = parse;

  useEffect(() => {
    let live = true;
    setReady(false);
    void readJson(key).then((stored) => {
      if (!live) return;
      setValue(parseRef.current(stored));
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [key]);

  const emptyRef = useRef(isEmpty);
  emptyRef.current = isEmpty;
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(
      () => void writeJson(key, emptyRef.current(value) ? null : value),
      300,
    );
    return () => clearTimeout(timer);
  }, [value, key, ready]);

  const set = useCallback((next: T | ((current: T) => T)) => setValue(next), []);
  return { value, set, ready };
}
