import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AccessTokenDto, LoginResponseDto } from './auth.dto';

/** A native client's login (ADR-0061 #4): the refresh token comes in the body, never a cookie. */
@ApiSchema({ name: 'MobileLoginResponse' })
export class MobileLoginResponseDto extends LoginResponseDto {
  @ApiProperty({
    description:
      'The refresh token: kept in the device secure storage and sent to /auth/mobile/refresh',
  })
  refreshToken: string;
}

@ApiSchema({ name: 'MobileTokens' })
export class MobileTokensDto extends AccessTokenDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The rotated refresh token; null within the 20-second grace window: keep the stored one',
  })
  refreshToken: string | null;
}

@ApiSchema({ name: 'MobileTokenRequest' })
export class MobileTokenRequestDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  refreshToken: string;
}
