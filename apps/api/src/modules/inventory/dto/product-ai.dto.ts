import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_AI_PHOTOS } from '../services/product-ai';

@ApiSchema({ name: 'ProductAiReadRequest' })
export class ProductAiReadDto {
  @ApiProperty({
    type: [Number],
    description: 'Uploaded files of kind catalog.ai_photo: photos of one product',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_AI_PHOTOS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  photoFileIds: number[];
}

@ApiSchema({ name: 'ProductAiPictureRequest' })
export class ProductAiPictureDto {
  @ApiProperty({ description: 'Uploaded file of kind catalog.ai_photo' })
  @IsInt()
  @Min(1)
  photoFileId: number;
}

@ApiSchema({ name: 'ProductAiStatus' })
export class ProductAiStatusDto {
  @ApiProperty({ description: 'A model is configured: photos can be read' }) read: boolean;

  @ApiProperty({ description: 'A background service key is saved: a picture can be cut out' })
  picture: boolean;
}

@ApiSchema({ name: 'ProductAiUnit' })
export class ProductAiUnitDto {
  @ApiProperty() uomId: number;
  @ApiProperty({ example: '10' }) factorToBase: string;
  @ApiProperty({ type: [String] }) barcodes: string[];
}

@ApiSchema({ name: 'ProductAiSupplier' })
export class ProductAiSupplierDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'ProductAiBox' })
export class ProductAiBoxDto {
  @ApiProperty({ description: "Fraction of the photo's width" })
  @IsNumber()
  @Min(0)
  @Max(1)
  left: number;

  @ApiProperty({ description: "Fraction of the photo's height" })
  @IsNumber()
  @Min(0)
  @Max(1)
  top: number;

  @ApiProperty() @IsNumber() @Min(0) @Max(1) width: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(1) height: number;
}

@ApiSchema({ name: 'ProductAiImageRequest' })
export class ProductAiImageDto {
  @ApiProperty({ description: 'Uploaded file of kind catalog.ai_photo' })
  @IsInt()
  @Min(1)
  photoFileId: number;

  @ApiProperty({
    type: ProductAiBoxDto,
    nullable: true,
    required: false,
    description: "Where the product is on the photo: the reading's `productBox`",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductAiBoxDto)
  productBox?: ProductAiBoxDto | null;
}

@ApiSchema({ name: 'ProductAiImageFailure' })
export class ProductAiImageFailureDto {
  @ApiProperty({ description: 'TIMEOUT, NETWORK, HTTP, INVALID_RESPONSE or EMPTY' })
  reason: string;

  @ApiProperty({ type: Number, nullable: true }) status: number | null;
  @ApiProperty({ type: String, nullable: true }) providerCode: string | null;
}

/** A finished product image, stored as pending product photos of the caller (ADR-0199). */
@ApiSchema({ name: 'ProductAiImage' })
export class ProductAiImageResultDto {
  @ApiProperty({ description: 'A pending file of kind catalog.product_image' })
  imageFileId: number;

  @ApiProperty({ description: 'A pending file of kind catalog.product_thumb' })
  thumbFileId: number;

  @ApiProperty({
    enum: ['made', 'original'],
    description: 'made: cut out, on white, with the logo; original: the photo as taken',
  })
  picture: 'made' | 'original';

  @ApiProperty({ description: 'The image: a JPEG in base64' }) image: string;

  @ApiProperty({
    type: ProductAiImageFailureDto,
    nullable: true,
    description: 'Why the image is the photo as taken although a background service is set',
  })
  failure: ProductAiImageFailureDto | null;
}

@ApiSchema({ name: 'ProductAiExisting' })
export class ProductAiExistingDto {
  @ApiProperty() code: string;
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
}

/** Values the registration form may fill in; null and empty lists propose nothing. */
@ApiSchema({ name: 'ProductAiProposal' })
export class ProductAiProposalDto {
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: Number, nullable: true }) categoryId: number | null;
  @ApiProperty({ type: String, nullable: true }) categoryPath: string | null;
  @ApiProperty({ type: Number, nullable: true }) baseUomId: number | null;
  @ApiProperty({ type: String, nullable: true }) boxFactor: string | null;
  @ApiProperty({ type: String, nullable: true }) weightKg: string | null;
  @ApiProperty({ type: [String] }) baseBarcodes: string[];
  @ApiProperty({ type: [String] }) boxBarcodes: string[];
  @ApiProperty({ type: [ProductAiUnitDto] }) units: ProductAiUnitDto[];
  @ApiProperty({ type: ProductAiSupplierDto, nullable: true })
  supplier: ProductAiSupplierDto | null;

  @ApiProperty({ description: 'Index (0 is the first) of the photo for the catalogue picture' })
  frontPhoto: number;

  @ApiProperty({ description: 'The uploaded photo the catalogue picture is made of' })
  frontPhotoFileId: number;

  @ApiProperty({ type: ProductAiBoxDto, nullable: true, description: 'Where the product is' })
  productBox: ProductAiBoxDto | null;

  @ApiProperty({ description: 'Barcodes read without a valid check digit, left out' })
  droppedBarcodes: number;

  @ApiProperty({ type: [ProductAiExistingDto], description: 'Read barcodes already registered' })
  existing: ProductAiExistingDto[];

  @ApiProperty({ description: "The model's remark in Mongolian; may be empty" }) note: string;
}

@ApiSchema({ name: 'ProductAiPicture' })
export class ProductAiPictureResultDto {
  @ApiProperty({ description: 'The product on a transparent background: a PNG in base64' })
  image: string;

  @ApiProperty({
    type: 'object',
    nullable: true,
    properties: { data: { type: 'string' }, mediaType: { type: 'string' } },
    required: ['data', 'mediaType'],
    description: "The company's logo in base64, drawn on the picture by the browser",
  })
  stamp: { data: string; mediaType: string } | null;
}
