import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import {
  PICTURE_CHECK_REASONS,
  type PictureCheck,
} from '../services/picture-settings-flow.service';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ApiSchema({ name: 'PictureSettingsUpdateRequest' })
export class UpdatePictureSettingsDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    writeOnly: true,
    description: "The background service's key; null removes the saved one. Never returned",
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(8, 200)
  @Matches(/^\S+$/)
  apiKey?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Uploaded file of kind ai.picture_stamp; null takes the logo away',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  stampFileId?: number | null;
}

@ApiSchema({ name: 'PictureSettingsTestRequest' })
export class TestPictureSettingsDto {
  @ApiPropertyOptional({ writeOnly: true, description: 'A typed key; without it the saved one' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(8, 200)
  @Matches(/^\S+$/)
  apiKey?: string;
}

@ApiSchema({ name: 'PictureSettings' })
export class PictureSettingsDto {
  @ApiProperty({ type: String, nullable: true, description: "The saved key's last characters" })
  keyHint: string | null;

  @ApiProperty({ description: 'A saved key AI_KEY_SECRET no longer opens' })
  keyUnreadable: boolean;

  @ApiProperty({ description: 'AI_KEY_SECRET is set, so a key can be saved' })
  secretReady: boolean;

  @ApiProperty({ type: String, nullable: true, description: "The logo's public URL" })
  stampUrl: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) updatedBy: string | null;
}

@ApiSchema({ name: 'PictureSettingsTestResult' })
export class PictureCheckDto {
  @ApiProperty() ok: boolean;

  @ApiProperty({ type: String, enum: PICTURE_CHECK_REASONS, nullable: true })
  reason: PictureCheck['reason'];

  @ApiProperty({ type: Number, nullable: true }) status: number | null;
  @ApiProperty({ type: String, nullable: true }) providerCode: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Credits left on the account' })
  credits: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Free calls left this month' })
  freeCalls: number | null;
}
