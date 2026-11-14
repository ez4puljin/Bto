import { Injectable, Logger } from '@nestjs/common';
import { categoryTree } from '@tugeel/shared/catalog';
import { AppError } from '../../../common/errors/app-error';
import {
  composedPicture,
  normalisedPhoto,
  thumbnailOf,
  UnreadablePictureError,
} from '../../../common/images/product-picture';
import { type LlmContentPart, LlmError, LlmGateway } from '../../../integrations/llm';
import { PictureError, PictureGateway } from '../../../integrations/picture';
import { BarcodeService, CatalogService, CategoriesService, UomsService } from '../../catalog';
import { actorUserId, type AuthContext, StorageService } from '../../identity';
import { SuppliersService } from '../../partners';
import {
  MAX_AI_PHOTOS,
  type PhotoBox,
  PRODUCT_READ_INSTRUCTIONS,
  PRODUCT_READ_SCHEMA,
  type ProductProposalValues,
  productReadData,
  type ProductReadLists,
  ProductReadAnswer,
  proposalOf,
} from './product-ai';

/** The file kind of a photo given to «AI ашиглах» (ADR-0198), private and never attached. */
export const AI_PHOTO = 'catalog.ai_photo';
/** The file kind of the company's logo, saved by the ai module's settings. */
const PICTURE_STAMP = 'ai.picture_stamp';
const PRODUCT_IMAGE = 'catalog.product_image';
const PRODUCT_THUMB = 'catalog.product_thumb';

const ANSWER_TOKENS = 2_000;
/** Product names shown to the model as the catalogue's style. */
const NAME_EXAMPLES = 40;

/** What «AI ашиглах» can do now: read photos (a model is set), cut a picture out (a key is set). */
export interface ProductAiStatus {
  read: boolean;
  picture: boolean;
}

export interface ProductProposal extends ProductProposalValues {
  /** The uploaded photo the catalogue picture is made of. */
  frontPhotoFileId: number;
  /** Barcodes read from the photos that a product already carries. */
  existing: { code: string; productId: number; sku: string; name: string }[];
}

export interface ProductPicture {
  /** The product on a transparent background, a PNG in base64. */
  image: string;
  /** The company's logo to draw on it, or null while none is uploaded. */
  stamp: { data: string; mediaType: string } | null;
}

/** Why a product image is the photo as taken: the service's code and status, never its words. */
export interface PictureFailureFacts {
  /** A PictureError reason, or EMPTY when the service found nothing to keep. */
  reason: string;
  status: number | null;
  providerCode: string | null;
}

/** A finished product image, uploaded and ready for a registration's `images` (ADR-0199). */
export interface ProductImage {
  imageFileId: number;
  thumbFileId: number;
  /** `made`: cut out, on white, with the logo; `original`: the photo as taken, scaled. */
  picture: 'made' | 'original';
  /** The image itself (a JPEG in base64), for the phone to show before the product exists. */
  image: string;
  /** Why it is `original` although a background service is set; null otherwise. */
  failure: PictureFailureFacts | null;
}

/**
 * «AI ашиглах» on the registration form (owner 2026-11-14, ADR-0198). The registrar gives photos
 * of one product; the vision model reads them and proposes the form's values, chosen from the
 * catalogue's own categories, units and suppliers; the background service cuts the product out
 * for its catalogue picture. Nothing is saved here: the form shows the proposal and the registrar
 * saves. The photos are private uploads nobody attaches; the calls run outside any transaction;
 * the prompt, the photos and the answers are never stored or logged.
 */
@Injectable()
export class ProductAiFlowService {
  private readonly logger = new Logger(ProductAiFlowService.name);

  constructor(
    private readonly llm: LlmGateway,
    private readonly pictures: PictureGateway,
    private readonly storage: StorageService,
    private readonly categories: CategoriesService,
    private readonly uoms: UomsService,
    private readonly suppliers: SuppliersService,
    private readonly catalog: CatalogService,
    private readonly barcodes: BarcodeService,
  ) {}

  async status(): Promise<ProductAiStatus> {
    return {
      read: (await this.llm.current()) !== null,
      picture: (await this.pictures.remover()) !== null,
    };
  }

  /** Reads the photos and proposes the form's values. */
  async read(ctx: AuthContext, photoFileIds: readonly number[]): Promise<ProductProposal> {
    const llm = await this.llm.forWork({ purpose: 'PRODUCT_READ', userId: actorUserId(ctx) });
    if (llm === null) {
      throw new AppError('AI_NOT_CONFIGURED', 'no model is configured to read product photos');
    }
    const ids = [...new Set(photoFileIds)].slice(0, MAX_AI_PHOTOS);
    const photos: LlmContentPart[] = [];
    for (const [index, id] of ids.entries()) {
      const photo = await this.photo(ctx, id);
      photos.push(
        { type: 'text', text: `Photo ${index + 1}:` },
        { type: 'image', mediaType: photo.mediaType, data: photo.data.toString('base64') },
      );
    }
    const lists = await this.lists();
    const examples = await this.catalog.search({ status: 'ACTIVE', limit: NAME_EXAMPLES });

    let values: ProductProposalValues;
    try {
      const answer = await llm.complete({
        instructions: PRODUCT_READ_INSTRUCTIONS,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: productReadData(
                  lists,
                  examples.data.map((product) => product.name),
                ),
              },
              ...photos,
            ],
          },
        ],
        output: PRODUCT_READ_SCHEMA,
        maxOutputTokens: ANSWER_TOKENS,
      });
      const parsed = ProductReadAnswer.safeParse(parseJson(answer.text));
      if (!parsed.success) {
        throw new LlmError('INVALID_RESPONSE', 'the answer does not match the schema');
      }
      values = proposalOf(parsed.data, lists, ids.length);
    } catch (error: unknown) {
      if (!(error instanceof LlmError)) throw error;
      this.logger.warn(
        { reason: error.reason, status: error.status, providerCode: error.providerCode },
        'product reading failed at the provider',
      );
      throw new AppError('AI_PROVIDER_FAILED', error.message, {
        reason: error.reason,
        ...(error.status === undefined ? {} : { status: error.status }),
        ...(error.providerCode === undefined ? {} : { providerCode: error.providerCode }),
      });
    }

    const frontPhotoFileId = ids[values.frontPhoto] ?? ids[0];
    if (frontPhotoFileId === undefined) throw new Error('a reading has at least one photo');
    return {
      ...values,
      frontPhotoFileId,
      existing: await this.existing([
        ...values.baseBarcodes,
        ...values.boxBarcodes,
        ...values.units.flatMap((unit) => unit.barcodes),
      ]),
    };
  }

  /** Cuts the product of one photo out of its background, and hands the logo with it. */
  async picture(ctx: AuthContext, photoFileId: number): Promise<ProductPicture> {
    const remover = await this.pictures.remover();
    if (remover === null) {
      throw new AppError('PICTURE_NOT_CONFIGURED', 'no background service key is saved');
    }
    const photo = await this.photo(ctx, photoFileId);
    let png: Buffer;
    try {
      png = (await remover.cutOut(photo)).png;
    } catch (error: unknown) {
      if (!(error instanceof PictureError)) throw error;
      this.logger.warn(
        { reason: error.reason, status: error.status, providerCode: error.providerCode },
        'background removal failed at the service',
      );
      throw new AppError('PICTURE_PROVIDER_FAILED', error.message, {
        reason: error.reason,
        ...(error.status === undefined ? {} : { status: error.status }),
        ...(error.providerCode === undefined ? {} : { providerCode: error.providerCode }),
      });
    }
    return { image: png.toString('base64'), stamp: await this.stamp() };
  }

  /**
   * The product image of a photo, finished on the server for a client without a canvas (the staff
   * app, ADR-0199): cut out by the background service, only the product kept, on a white square
   * with the logo, as the office's browser draws it. Without a service, or when it refuses, the
   * photo as taken (upright, scaled) is the image, so a product can always be registered. The
   * picture and its thumbnail are stored as pending product photos of the caller, to be attached
   * by the registration.
   */
  async productImage(
    ctx: AuthContext,
    photoFileId: number,
    box: PhotoBox | null,
  ): Promise<ProductImage> {
    const photo = await this.photo(ctx, photoFileId);
    const remover = await this.pictures.remover();
    let made: Buffer | null = null;
    let failure: PictureFailureFacts | null = null;
    if (remover !== null) {
      try {
        const cut = await remover.cutOut(photo);
        const stamp = await this.stampBytes();
        made = await composedPicture(cut.png, box, stamp?.data ?? null);
        if (made === null) failure = { reason: 'EMPTY', status: null, providerCode: null };
      } catch (error: unknown) {
        if (error instanceof PictureError) {
          failure = {
            reason: error.reason,
            status: error.status ?? null,
            providerCode: error.providerCode ?? null,
          };
        } else if (error instanceof UnreadablePictureError) {
          failure = { reason: 'INVALID_RESPONSE', status: null, providerCode: null };
        } else {
          throw error;
        }
        this.logger.warn(failure, 'the product image is kept as taken');
      }
    }
    const image = made ?? photo.data;
    const ownerId = actorUserId(ctx);
    const [stored, thumb] = [
      await this.storage.ingest({
        kind: PRODUCT_IMAGE,
        contentType: 'image/jpeg',
        bytes: image,
        ownerId,
      }),
      await this.storage.ingest({
        kind: PRODUCT_THUMB,
        contentType: 'image/jpeg',
        bytes: await thumbnailOf(image),
        ownerId,
      }),
    ];
    return {
      imageFileId: stored.id,
      thumbFileId: thumb.id,
      picture: made ? 'made' : 'original',
      image: image.toString('base64'),
      failure,
    };
  }

  /** The logo's bytes, or null: a picture is still made without it. */
  private async stamp(): Promise<ProductPicture['stamp']> {
    const stamp = await this.stampBytes();
    return stamp ? { data: stamp.data.toString('base64'), mediaType: stamp.mediaType } : null;
  }

  private async stampBytes(): Promise<{ data: Buffer; mediaType: string } | null> {
    const fileId = await this.pictures.stampFileId();
    if (fileId === null) return null;
    const file = await this.storage.get(fileId);
    if (!file || file.kind !== PICTURE_STAMP) return null;
    const opened = await this.storage.openPublic(file.key);
    if (!opened) return null;
    return { data: await bytesOf(opened.body), mediaType: opened.file.contentType };
  }

  /**
   * A photo the caller uploaded for a reading; another person's is not found. It goes on upright,
   * within 1280 px and as a JPEG: the web's uploads already are and pass untouched, a phone's
   * camera photo is turned and scaled here (ADR-0199).
   */
  private async photo(
    ctx: AuthContext,
    fileId: number,
  ): Promise<{ data: Buffer; mediaType: 'image/jpeg' }> {
    const { file, body } = await this.storage.openUploaded(fileId, AI_PHOTO);
    if (file.ownerId !== actorUserId(ctx)) {
      throw new AppError('NOT_FOUND', `file ${fileId} not found`, { id: fileId });
    }
    try {
      return { data: await normalisedPhoto(await bytesOf(body)), mediaType: 'image/jpeg' };
    } catch (error: unknown) {
      if (!(error instanceof UnreadablePictureError)) throw error;
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', `file ${fileId} is not a readable photo`, {
        id: fileId,
      });
    }
  }

  /** The catalogue's own lists the model chooses from. */
  private async lists(): Promise<ProductReadLists> {
    const [categories, uoms, suppliers] = [
      await this.categories.list(),
      await this.uoms.list(),
      await this.suppliers.allBrief(),
    ];
    return {
      categories: categoryTree(categories).map((node) => ({
        id: node.category.id,
        path: node.path,
      })),
      uoms: uoms.map(({ id, code, name, fractional }) => ({ id, code, name, fractional })),
      suppliers: suppliers
        .filter((supplier) => supplier.status === 'ACTIVE')
        .map(({ id, code, name }) => ({ id, code, name })),
    };
  }

  private async existing(codes: readonly string[]): Promise<ProductProposal['existing']> {
    const found: { code: string; productId: number }[] = [];
    for (const code of codes) {
      for (const hit of await this.barcodes.lookup(code)) {
        found.push({ code, productId: hit.productId });
      }
    }
    if (found.length === 0) return [];
    const products = new Map(
      (await this.catalog.getMany([...new Set(found.map((hit) => hit.productId))])).map(
        (product) => [product.id, product],
      ),
    );
    return found.flatMap((hit) => {
      const product = products.get(hit.productId);
      return product ? [{ ...hit, sku: product.sku, name: product.name }] : [];
    });
  }
}

async function bytesOf(body: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
