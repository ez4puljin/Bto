import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

@ApiSchema({ name: 'HrPositionSalary' })
export class HrPositionSalaryDto {
  @ApiProperty() effectiveMonth: string;
  @ApiProperty() baseSalary: string;
}

@ApiSchema({ name: 'HrPositionRole' })
export class HrPositionRoleDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) code: string | null;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ type: [String] }) permissions: string[];
}

@ApiSchema({ name: 'HrPosition' })
export class HrPositionDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ type: [Number] }) roleIds: number[];
  @ApiProperty({ type: [HrPositionRoleDto] }) roles: HrPositionRoleDto[];
  @ApiProperty({ type: String, nullable: true }) baseSalary: string | null;
  @ApiProperty({ type: String, nullable: true }) nextBaseSalary: string | null;
  @ApiProperty({ type: String, nullable: true }) nextEffectiveMonth: string | null;
  @ApiProperty({ type: [HrPositionSalaryDto] }) salaryHistory: HrPositionSalaryDto[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty() employeeCount: number;
  @ApiProperty() grantsAdmin: boolean;
  @ApiProperty() canAssign: boolean;
}

@ApiSchema({ name: 'HrPositionRequest' })
export class HrPositionRequestDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  name: string;
  @ApiProperty({ example: '1500000.00' })
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  baseSalary: string;
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  roleIds: number[];
}
