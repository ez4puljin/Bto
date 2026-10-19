import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

const ACCOUNT_STATUSES = ['ACTIVE', 'DISABLED'] as const;

/** A store's customer app account on the office's «Апп» card (ADR-0079 #11). */
@ApiSchema({ name: 'CustomerAppAccount' })
export class CustomerAppAccountDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: '+97699112233', description: 'The sign-in phone' }) phone: string;
  @ApiProperty({ enum: ACCOUNT_STATUSES, enumName: 'CustomerAppAccountStatus' })
  status: (typeof ACCOUNT_STATUSES)[number];
  @ApiProperty({ description: 'False until the store redeemed a code' }) passwordSet: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastSignInAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lockedUntil: string | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the live one-time code runs out; null when none is live',
  })
  codeExpiresAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'CustomerAppAccountState' })
export class CustomerAppAccountStateDto {
  @ApiProperty({ type: CustomerAppAccountDto, nullable: true, description: 'null = not linked' })
  account: CustomerAppAccountDto | null;
}

@ApiSchema({ name: 'CustomerAppLinkRequest' })
export class CustomerAppLinkDto {
  @ApiProperty({
    example: '99112233',
    description: 'A Mongolian mobile number, local form allowed',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone: string;
}

@ApiSchema({ name: 'CustomerAppCode' })
export class CustomerAppCodeDto {
  @ApiProperty({ example: '7KQ2M-X9D4F', description: 'Shown once; read it out to the store' })
  code: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}
