import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { PASSWORD_MAX_LENGTH, PERMISSIONS } from '@tugeel/shared/auth';
import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * Who is signing in (ADR-0128 #1): `login` is the registered phone in any local form, or the
 * login name of a staff record that has no phone yet. `username` is the same field under its
 * pre-ADR-0128 name, kept so an installed staff app keeps working; one of the two is required.
 */
export class StaffLoginFieldsDto {
  @ApiPropertyOptional({
    example: '99112233',
    maxLength: 64,
    description:
      'The registered phone (local form allowed), or the login name while no phone is set',
  })
  @ValidateIf((o: StaffLoginFieldsDto) => o.username === undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  login?: string;

  @ApiPropertyOptional({ maxLength: 64, deprecated: true, description: 'Older name of login' })
  @ValidateIf((o: StaffLoginFieldsDto) => o.login === undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username?: string;
}

/** The typed identifier, whichever field carried it. */
export function loginOf(dto: StaffLoginFieldsDto): string {
  return dto.login ?? dto.username ?? '';
}

@ApiSchema({ name: 'LoginRequest' })
export class LoginDto extends StaffLoginFieldsDto {
  @ApiProperty({ format: 'password', maxLength: 256 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;
}

@ApiSchema({ name: 'PasswordSetupRequest' })
export class PasswordSetupDto extends StaffLoginFieldsDto {
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
  @ApiProperty({ description: 'Internal login name (ADR-0128 #2); not shown to staff' })
  username: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true, description: 'The sign-in phone, E.164' })
  phone: string | null;
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
