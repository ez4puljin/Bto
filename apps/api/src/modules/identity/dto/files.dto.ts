import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { FILE_KINDS, type FileKind } from '@tugeel/shared/files';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

const KINDS = Object.keys(FILE_KINDS) as FileKind[];
const MAX_UPLOAD_BYTES = Math.max(...Object.values(FILE_KINDS).map((kind) => kind.maxBytes));

@ApiSchema({ name: 'FileUploadRequest' })
export class PresignUploadDto {
  @ApiProperty({ enum: KINDS })
  @IsIn(KINDS)
  kind: FileKind;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @MaxLength(100)
  contentType: string;

  @ApiProperty({ minimum: 1, maximum: MAX_UPLOAD_BYTES })
  @IsInt()
  @Min(1)
  @Max(MAX_UPLOAD_BYTES)
  sizeBytes: number;
}

@ApiSchema({ name: 'FileUploadHeaders' })
export class UploadHeadersDto {
  @ApiProperty({ name: 'Content-Type', example: 'image/jpeg' }) 'Content-Type': string;
}

@ApiSchema({ name: 'FileUpload' })
export class PresignedUploadDto {
  @ApiProperty() fileId: number;
  @ApiProperty({
    description:
      'PUT the bytes here with exactly these headers and no Authorization header; a path starting with "/" is relative to the API origin',
  })
  uploadUrl: string;
  @ApiProperty({ enum: ['PUT'] }) method: 'PUT';
  @ApiProperty({ type: UploadHeadersDto }) headers: UploadHeadersDto;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}
