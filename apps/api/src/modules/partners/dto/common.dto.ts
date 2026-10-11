import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** "true"/"false" query strings as booleans (other values fail @IsBoolean). */
export const queryBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export const CODE = /^[0-9]{1,20}$/;
export const COORDINATE = /^-?\d{1,3}(\.\d{1,6})?$/;
export const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

@ApiSchema({ name: 'NextCode' })
export class NextCodeDto {
  @ApiProperty({ example: '1024' }) code: string;
}

@ApiSchema({ name: 'ContactRequest' })
export class ContactRequestDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  name?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 60 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(60)
  position?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Mongolian mobile number in any common form; stored as +976XXXXXXXX',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

@ApiSchema({ name: 'Contact' })
export class ContactDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: String, nullable: true }) position: string | null;
  @ApiProperty({ type: String, nullable: true, example: '+97699112233' }) phone: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
}
