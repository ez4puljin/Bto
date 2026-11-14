import { Global, Module } from '@nestjs/common';
import { PictureGateway } from './picture.gateway';
import { PICTURE_FETCH } from './picture.tokens';
import type { PictureFetch } from './picture.types';

export { PICTURE_FETCH };

/**
 * Imported only by the api's composition root, like LlmModule; `*-flow.service.ts` files inject
 * `PictureGateway` and call the service between transactions. Tests replace PICTURE_FETCH with a
 * scripted fetch.
 */
@Global()
@Module({
  providers: [
    {
      provide: PICTURE_FETCH,
      useValue: ((url, init) => fetch(url, init)) satisfies PictureFetch,
    },
    PictureGateway,
  ],
  exports: [PictureGateway],
})
export class PictureModule {}
