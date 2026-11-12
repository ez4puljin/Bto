import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { APP } from '../config/app';
import { userAgentOf } from './client';
import { readJson, writeJson } from './storage';

/** A random id made at the first start of an install: it tells two phones of one model apart. */
export const INSTALL_KEY = 'bto.install.v1';

async function installId(): Promise<string> {
  const stored = await readJson(INSTALL_KEY);
  if (typeof stored === 'string' && stored !== '') return stored;
  const fresh = Crypto.randomUUID();
  await writeJson(INSTALL_KEY, fresh);
  return fresh;
}

let header: Promise<string> | null = null;

/**
 * The `User-Agent` of this app on this phone, worked out once per start. Storage that cannot be
 * read gives an id of zeros: the call still goes out.
 */
export function clientUserAgent(): Promise<string> {
  header ??= installId()
    .catch(() => '')
    .then((id) =>
      userAgentOf({
        variant: APP.variant,
        version: Constants.expoConfig?.version ?? '0',
        platform: Platform,
        installId: id,
      }),
    );
  return header;
}
