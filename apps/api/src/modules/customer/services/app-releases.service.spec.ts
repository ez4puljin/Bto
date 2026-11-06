import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../../../common/config/app-config';
import { AppReleasesService } from './app-releases.service';

describe('AppReleasesService (ADR-0166)', () => {
  let root: string;
  let service: AppReleasesService;
  const folder = () => join(root, 'releases', 'customer');
  const publish = async (manifest: unknown, bytes = 'apk-bytes') => {
    await mkdir(folder(), { recursive: true });
    await writeFile(join(folder(), 'latest.json'), JSON.stringify(manifest));
    await writeFile(join(folder(), 'bto300-0.4.0-7.apk'), bytes);
  };
  const manifest = {
    version: '0.4.0',
    versionCode: 7,
    fileName: 'bto300-0.4.0-7.apk',
    sizeBytes: 9,
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'app-releases-'));
    service = new AppReleasesService({ get: () => root } as unknown as AppConfig);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('has no release until one is published', async () => {
    await expect(service.latest('customer')).resolves.toBeNull();
    await expect(service.open('customer')).resolves.toBeNull();
  });

  it('answers the published release and opens its bytes', async () => {
    await publish(manifest);
    await expect(service.latest('customer')).resolves.toEqual(manifest);
    const opened = await service.open('customer');
    const chunks: Buffer[] = [];
    for await (const chunk of opened?.body ?? []) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('apk-bytes');
  });

  it('offers nothing when the file is not the size the manifest says', async () => {
    await publish(manifest, 'short');
    await expect(service.latest('customer')).resolves.toBeNull();
  });

  it('never reads a file name that leaves the folder', async () => {
    await publish({ ...manifest, fileName: '../../secret.apk' });
    await expect(service.latest('customer')).resolves.toBeNull();
  });

  it('survives a broken manifest', async () => {
    await mkdir(folder(), { recursive: true });
    await writeFile(join(folder(), 'latest.json'), '{ not json');
    await expect(service.latest('customer')).resolves.toBeNull();
  });

  it('keeps the apps apart', async () => {
    await publish(manifest);
    await expect(service.latest('staff')).resolves.toBeNull();
  });
});
