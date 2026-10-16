import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { PASSWORD_MAX_LENGTH, PERMISSIONS } from '@tugeel/shared/auth';
import { IsString, MaxLength, MinLength } from 'class-validator';

@ApiSchema({ name: 'LoginRequest' })
export class LoginDto {
  @ApiProperty({ example: 'bat.erdene', maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username: string;

  @ApiProperty({ format: 'password', maxLength: 256 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;
}

@ApiSchema({ name: 'PasswordSetupRequest' })
export class PasswordSetupDto {
  @ApiProperty({ example: 'bat.erdene', maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username: string;

  @ApiProperty({ description: 'One-time code issued by an admin, e.g. 7KQ2M-X9D4F', maxLength: 32 })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code: string;

  @ApiProperty({ format: 'password', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

@ApiSchema({ name: 'PasswordChangeRequest' })
export class PasswordChangeDto {
  @ApiProperty({ format: 'password', maxLength: 256 })
  @IsString()
  @MaxLength(256)
  currentPassword: string;

  @ApiProperty({ format: 'password', maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

@ApiSchema({ name: 'RoleRef' })
export class RoleRefDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true, description: 'System roles only' })
  code: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Custom roles only' })
  name: string | null;
  @ApiProperty() isSystem: boolean;
}

@ApiSchema({ name: 'Me' })
export class MeDto {
  @ApiProperty() id: number;
  @ApiProperty() username: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ enum: PERMISSIONS, enumName: 'Permission', isArray: true })
  permissions: string[];
  @ApiProperty({ type: [RoleRefDto] }) roles: RoleRefDto[];
  @ApiProperty({
    type: [Number],
    nullable: true,
    description: 'Warehouses this user may write documents for; null = every warehouse',
  })
  writableWarehouseIds: number[] | null;
  @ApiProperty({ format: 'date-time', description: 'When this session signed in' })
  sessionStartedAt: string;
  @ApiProperty({ format: 'date-time' }) sessionExpiresAt: string;
}

@ApiSchema({ name: 'AccessToken' })
export class AccessTokenDto {
  @ApiProperty() accessToken: string;
  @ApiProperty({ format: 'date-time' }) accessTokenExpiresAt: string;
  @ApiProperty({ format: 'date-time' }) sessionExpiresAt: string;
}

@ApiSchema({ name: 'LoginResponse' })
export class LoginResponseDto extends AccessTokenDto {
  @ApiProperty({ type: MeDto }) me: MeDto;
}
