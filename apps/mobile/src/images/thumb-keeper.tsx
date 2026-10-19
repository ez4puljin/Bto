import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { unwrap } from '../api/problem';
import { readJson, writeJson } from '../device/storage';
import { useSignedIn } from '../state/session';
import {
  checkedAtFrom,
  chunksOf,
  THUMBS_AT_ONCE,
  thumbsDue,
  thumbsKept,
  thumbsKey,
} from './thumbs';

/** The rep's shop thumbnails (`GET /sales-rep/thumbs`). */
export function ThumbKeeper() {
  const { session, server } = useSignedIn();
  return (
    <ThumbKeeperFor
      server={server}
      urlsOf={async () => unwrap(await session.client.GET('/api/v1/sales-rep/thumbs')).urls}
    />
  );
}

/**
 * Keeps every shop product's primary thumbnail on the phone (the owner, 2026-10-17): after
 * sign-in, and whenever the app comes back to the foreground at least six hours after the last
 * run, the shop's thumbnail list is read and each picture is fetched into expo-image's disk cache,
 * a few at a time. A picture already kept costs no download, so reopening the app downloads
 * nothing; one the phone has dropped comes back on the next run. Two runs never overlap. Either
 * app passes how to read its shop's list (`urlsOf`, which throws without an answer).
 */
export function ThumbKeeperFor({
  server,
  urlsOf,
}: {
  server: string;
  urlsOf: () => Promise<string[]>;
}) {
  const reader = useRef(urlsOf);
  useEffect(() => {
    reader.current = urlsOf;
  });
  useEffect(() => {
    let stopped = false;
    let running = false;

    const run = async () => {
      if (running) return;
      running = true;
      try {
        const key = thumbsKey(server);
        if (!thumbsDue(checkedAtFrom(await readJson(key)), Date.now())) return;
        let urls: string[];
        try {
          urls = await reader.current();
        } catch {
          return;
        }
        let failed = 0;
        for (const chunk of chunksOf(urls, THUMBS_AT_ONCE)) {
          if (stopped) return;
          const kept = await Promise.all(
            chunk.map((url) => Image.prefetch(`${server}${url}`, 'disk').catch(() => false)),
          );
          failed += kept.filter((ok) => !ok).length;
        }
        if (!stopped && thumbsKept(urls.length, failed)) await writeJson(key, Date.now());
      } finally {
        running = false;
      }
    };

    void run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run();
    });
    return () => {
      stopped = true;
      subscription.remove();
    };
  }, [server]);
  return null;
}
