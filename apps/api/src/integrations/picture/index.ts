// The background service of product pictures (ADR-0198, docs/modules/ai.md §13).
export {
  type PictureFailure,
  PictureGateway,
  type PictureSaved,
  type PictureSettingsStore,
} from './picture.gateway';
export { PICTURE_FETCH, PictureModule } from './picture.module';
export {
  type BackgroundRemover,
  type CutOut,
  PICTURE_ERROR_REASONS,
  type PictureAccount,
  PictureError,
  type PictureErrorReason,
  type PictureFetch,
  type PicturePhoto,
} from './picture.types';
export { PICTURE_TIMEOUT_MS, REMOVE_BG_BASE_URL, RemoveBgClient } from './remove-bg.client';
