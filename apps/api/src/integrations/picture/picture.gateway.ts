import { Inject, Injectable } from '@nestjs/common';
import { PICTURE_FETCH } from './picture.tokens';
import {
  type BackgroundRemover,
  PictureError,
  type PictureErrorReason,
  type PictureFetch,
} from './picture.types';
import { RemoveBgClient } from './remove-bg.client';

/** What the settings screen saved for product pictures (ADR-0198). */
export interface PictureSaved {
  /** The background service's key, opened; null while none is saved or it cannot be opened. */
  apiKey: string | null;
  /** The company's logo drawn on a picture; null while none is uploaded. */
  stampFileId: number | null;
}

/** The ai module's side of the gateway, attached at start: the module sits above integrations. */
export interface PictureSettingsStore {
  saved(): Promise<PictureSaved>;
}

/** The last call that failed, kept until one succeeds: the service's code, never its text. */
export interface PictureFailure {
  reason: PictureErrorReason;
  status?: number;
  providerCode?: string;
  at: Date;
}

/**
 * The background service in force (ADR-0198): the key saved on the settings screen, read at every
 * call, so a saved key works at once and no process keeps an old one. Without a key there is no
 * service and the registration form keeps the photo as it was taken.
 */
@Injectable()
export class PictureGateway {
  private store: PictureSettingsStore | null = null;
  private failure: PictureFailure | null = null;

  constructor(@Inject(PICTURE_FETCH) private readonly fetchFn: PictureFetch) {}

  attach(store: PictureSettingsStore): void {
    this.store = store;
  }

  /** The service for one cut-out, or null while no key is saved. */
  async remover(): Promise<BackgroundRemover | null> {
    const saved = await this.store?.saved();
    return saved?.apiKey ? this.watched(this.removerFor(saved.apiKey)) : null;
  }

  /** The logo's file, or null. */
  async stampFileId(): Promise<number | null> {
    return (await this.store?.saved())?.stampFileId ?? null;
  }

  /** The service behind a key that may not be saved yet: the settings screen's check. */
  removerFor(apiKey: string): BackgroundRemover {
    return new RemoveBgClient(apiKey, this.fetchFn);
  }

  /** The last failed cut-out, until a later one succeeds. */
  get lastFailure(): PictureFailure | null {
    return this.failure;
  }

  private watched(remover: BackgroundRemover): BackgroundRemover {
    return {
      provider: remover.provider,
      account: () => remover.account(),
      cutOut: async (photo) => {
        try {
          const result = await remover.cutOut(photo);
          this.failure = null;
          return result;
        } catch (error: unknown) {
          if (error instanceof PictureError) {
            this.failure = {
              reason: error.reason,
              status: error.status,
              providerCode: error.providerCode,
              at: new Date(),
            };
          }
          throw error;
        }
      },
    };
  }
}
