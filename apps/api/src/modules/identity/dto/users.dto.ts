import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;

@ApiSchema({ name: 'UserScopes' })
export class UserScopesDto {
  @ApiProperty({ type: [Number], description: 'Warehouses the user may write documents for' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  warehouseIds: number[];

  @ApiProperty({ type: [Number], description: 'Branches whose warehouses the user may write for' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  branchIds: number[];
}

/** A staff registration (ADR-0128): name and phone; the internal login name is generated. */
@ApiSchema({ name: 'UserCreateRequest' })
export class CreateUserDto {
  @ApiProperty({ example: 'Батын Эрдэнэ', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  @ApiProperty({
    example: '99112233',
    maxLength: 32,
    description: 'The sign-in phone, 8 Mongolian digits in any local form; unique among staff',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone: string;

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  roleIds: number[];

  @ApiPropertyOptional({ type: UserScopesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserScopesDto)
  scopes?: UserScopesDto;
}

@ApiSchema({ name: 'UserUpdateRequest' })
export class UpdateUserDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'A new sign-in phone; null is refused once a phone is set (ADR-0128 #3)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  roleIds?: number[];

  @ApiPropertyOptional({ type: UserScopesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserScopesDto)
  scopes?: UserScopesDto;
}

export class UserListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Part of the full name, phone or login name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];
}

@ApiSchema({ name: 'UserSummary' })
export class UserSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty({ description: 'Internal login name (ADR-0128 #2); not shown to staff' })
  username: string;
  @ApiProperty() fullName: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The sign-in phone, E.164; null on a record registered before ADR-0128',
  })
  phone: string | null;
  @ApiProperty({ enum: USER_STATUSES }) status: (typeof USER_STATUSES)[number];
  @ApiProperty({ type: [Number] }) roleIds: number[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastLoginAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lockedUntil: string | null;
}

@ApiSchema({ name: 'UserDetail' })
export class UserDetailDto extends UserSummaryDto {
  @ApiProperty({ description: 'False until the user redeems a one-time code' })
  passwordSet: boolean;
  @ApiProperty() failedLoginCount: number;
  @ApiProperty({ type: UserScopesDto }) scopes: UserScopesDto;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'UserPage' })
export class UserPageDto {
  @ApiProperty({ type: [UserSummaryDto] }) data: UserSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'PasswordCode' })
export class PasswordCodeDto {
  @ApiProperty({ example: '7KQ2M-X9D4F', description: 'Shown once; give it to the user' })
  code: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}

@ApiSchema({ name: 'Session' })
export class SessionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) lastUsedAt: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
  @ApiProperty({ type: String, nullable: true }) userAgent: string | null;
  @ApiProperty({ type: String, nullable: true }) ip: string | null;
}

@ApiSchema({ name: 'SessionList' })
export class SessionListDto {
  @ApiProperty({ type: [SessionDto] }) data: SessionDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Always null: live sessions only' })
  nextCursor: null;
}

@ApiSchema({ name: 'UserLookup' })
export class UserLookupDto {
  @ApiProperty() id: number;
  @ApiProperty() fullName: string;
}

export class UserLookupQueryDto {
  @ApiPropertyOptional({ description: 'Name or login' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
