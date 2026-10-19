import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { PASSWORD_MAX_LENGTH } from '@tugeel/shared/auth';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AccessTokenDto } from './auth.dto';

/** A store's sign-in in «Bto300» (ADR-0079 #3): the linked phone, local form allowed. */
@ApiSchema({ name: 'CustomerLoginRequest' })
export class CustomerLoginDto {
  @ApiProperty({ example: '99112233', maxLength: 32, description: 'The phone the office linked' })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone: string;

  @ApiProperty({ format: 'password', maxLength: 256 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;
}

@ApiSchema({ name: 'CustomerPasswordSetupRequest' })
export class CustomerPasswordSetupDto {
  @ApiProperty({ example: '99112233', maxLength: 32 })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone: string;

  @ApiProperty({
    description: 'The one-time code the office read out, e.g. 7KQ2M-X9D4F',
    maxLength: 32,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code: string;

  @ApiProperty({ format: 'password', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

/** The signed-in account; the store's own data comes from `GET /customer-app/me`. */
@ApiSchema({ name: 'CustomerAccount' })
export class CustomerAccountDto {
  @ApiProperty({ description: 'The account (customer_users) id; the app keys its storage on it' })
  id: number;
  @ApiProperty() customerId: number;
  @ApiProperty({ example: '+97699112233' }) phone: string;
  @ApiProperty({ format: 'date-time', description: 'When this session signed in' })
  sessionStartedAt: string;
  @ApiProperty({ format: 'date-time' }) sessionExpiresAt: string;
}

@ApiSchema({ name: 'CustomerLoginResponse' })
export class CustomerLoginResponseDto extends AccessTokenDto {
  @ApiProperty({ description: 'Kept in the device secure storage; sent to /auth/customer/refresh' })
  refreshToken: string;
  @ApiProperty({ type: CustomerAccountDto }) account: CustomerAccountDto;
}
