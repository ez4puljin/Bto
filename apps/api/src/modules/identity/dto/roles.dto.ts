import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { PERMISSIONS } from '@tugeel/shared/auth';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

@ApiSchema({ name: 'Role' })
export class RoleDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true, description: 'System roles only' }) code:
    string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Custom roles only' }) name:
    string | null;
  @ApiProperty() isSystem: boolean;
  @ApiProperty({ enum: PERMISSIONS, enumName: 'Permission', isArray: true }) permissions: string[];
  @ApiProperty() userCount: number;
}

@ApiSchema({ name: 'RoleCreateRequest' })
export class CreateRoleDto {
  @ApiProperty({ example: 'Агуулахын ахлах', maxLength: 60 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @ApiProperty({ enum: PERMISSIONS, enumName: 'Permission', isArray: true })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissions: string[];
}

@ApiSchema({ name: 'RoleUpdateRequest' })
export class UpdateRoleDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ enum: PERMISSIONS, enumName: 'Permission', isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissions?: string[];
}

@ApiSchema({ name: 'PermissionInfo' })
export class PermissionInfoDto {
  @ApiProperty({ enum: PERMISSIONS, enumName: 'Permission' }) code: string;
  @ApiProperty({ description: 'False for codes reserved for the ADMIN role' }) assignable: boolean;
}
