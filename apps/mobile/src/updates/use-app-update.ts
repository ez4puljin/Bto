import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { useCallback, useEffect, useRef, useState } from 'react';
import { unwrap } from '../api/problem';
import { APP } from '../config/app';
import { useSession } from '../state/session';
import {
  apkUrlOf,
  type AppRelease,
  type CheckOutcome,
  checkOutcomeOf,
  percentOf,
  updateOf,
} from './update';

// An app updating itself (ADR-0166, the staff app too since ADR-0174): the server's newest APK is asked for every two minutes, so a
// phone that comes back onto the server's Wi-Fi sees it soon after; a press downloads it to the
// phone's cache and hands it to Android's installer. Android asks to allow this app once, then
// installs it over the old one only if the same key signed it.

const FOLDER = 'updates';
/** Android's type of an APK; its installer opens for this alone. */
const APK_TYPE = 'application/vnd.android.package-archive';
/** FLAG_GRANT_READ_URI_PERMISSION: lets the installer read the file from this app's cache. */
const READ_GRANT = 1;

let cleared = false;

/** The APK an installed update came from has no more use: it goes once per start of the app. */
function clearDownloads() {
  if (cleared) return;
  cleared = true;
  try {
    const folder = new Directory(Paths.cache, FOLDER);
    if (folder.exists) folder.delete();
  } catch {
    // Android empties the cache by itself when it needs the room.
  }
}

/** Whichever session this variant has: the release's routes are public. */
function useAppSession() {
  const { session, server } = useSession();
  if (!session || !server) throw new Error('an update asked for without a session');
  return { session, server };
}

/** The build installed on this phone; unknown in a development run. */
function installedCode(): number | undefined {
  return Constants.expoConfig?.android?.versionCode;
}

/** The server's newest release of this app, asked every two minutes. */
function useReleaseQuery() {
  const { session } = useAppSession();
  return useQuery({
    queryKey: ['app-release', APP.variant],
    enabled: APP.selfUpdate,
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/app-releases/{variant}', {
          params: { path: { variant: APP.variant } },
        }),
      ),
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: false,
  });
}

/** The server's newer release of this app, or null; a server that does not answer offers nothing. */
export function useAppUpdate(): AppRelease | null {
  const query = useReleaseQuery();
  const update = updateOf(query.data?.release, installedCode());
  const nothingNew = query.isSuccess && update === null;
  useEffect(() => {
    if (nothingNew) clearDownloads();
  }, [nothingNew]);
  return update;
}

export type CheckState = { kind: 'idle' } | { kind: 'checking' } | { kind: CheckOutcome };

/**
 * «Шинэчлэл шалгах» (ADR-0174 #10): asks the server at once instead of waiting for the next two
 * minutes. `found` counts up on every press that found a newer release, so the update card starts
 * its download on that press, from the server over the shop's own network.
 */
export function useUpdateCheck(): {
  state: CheckState;
  found: number;
  check: () => Promise<void>;
} {
  const { refetch } = useReleaseQuery();
  const [state, setState] = useState<CheckState>({ kind: 'idle' });
  const [found, setFound] = useState(0);
  const check = useCallback(async () => {
    setState({ kind: 'checking' });
    const result = await refetch();
    const outcome = checkOutcomeOf(result.isSuccess, result.data?.release, installedCode());
    setState({ kind: outcome });
    if (outcome === 'found') setFound((count) => count + 1);
  }, [refetch]);
  return { state, found, check };
}

export type UpdateStep =
  | { kind: 'idle' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready' }
  | { kind: 'failed'; reason: 'download' | 'install' };

/** A release's download and install; leaving the screen stops a running download. */
export function useUpdateInstaller(release: AppRelease) {
  const { server } = useAppSession();
  const [step, setStep] = useState<UpdateStep>({ kind: 'idle' });
  const running = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      running.current?.abort();
    },
    [],
  );

  const fileOf = useCallback(() => {
    const folder = new Directory(Paths.cache, FOLDER);
    return { folder, file: new File(folder, `${APP.variant}-${release.versionCode}.apk`) };
  }, [release.versionCode]);

  const install = useCallback(async () => {
    try {
      const uri = await getContentUriAsync(fileOf().file.uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: uri,
        type: APK_TYPE,
        flags: READ_GRANT,
      });
      // The store came back without installing (a cancel): the file stays, «Суулгах» tries again.
      setStep({ kind: 'ready' });
    } catch {
      setStep({ kind: 'failed', reason: 'install' });
    }
  }, [fileOf]);

  const start = useCallback(async () => {
    if (running.current) return;
    const { folder, file } = fileOf();
    const controller = new AbortController();
    running.current = controller;
    try {
      if (file.exists && file.size === release.sizeBytes) {
        await install();
        return;
      }
      // Only the newest APK stays on the phone: an older one or a broken download goes.
      if (folder.exists) folder.delete();
      folder.create({ intermediates: true, idempotent: true });
      setStep({ kind: 'downloading', percent: 0 });
      const downloaded = await File.downloadFileAsync(apkUrlOf(server, APP.variant), file, {
        idempotent: true,
        signal: controller.signal,
        onProgress: ({ bytesWritten }) =>
          setStep({ kind: 'downloading', percent: percentOf(bytesWritten, release.sizeBytes) }),
      });
      if (downloaded.size !== release.sizeBytes) {
        downloaded.delete();
        setStep({ kind: 'failed', reason: 'download' });
        return;
      }
      await install();
    } catch {
      if (!controller.signal.aborted) setStep({ kind: 'failed', reason: 'download' });
    } finally {
      running.current = null;
    }
  }, [fileOf, install, release.sizeBytes, server]);

  return { step, start };
}
