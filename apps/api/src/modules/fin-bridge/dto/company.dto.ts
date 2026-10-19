import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

const STATUSES = ['ACTIVE', 'INACTIVE'] as const;
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ApiSchema({ name: 'CompanyTaxRegistration' })
export class CompanyTaxRegistrationDto {
  @ApiProperty({ example: 'VAT' }) taxKind: string;
  @ApiProperty({ format: 'date' }) effectiveFrom: string;
  @ApiProperty() registered: boolean;
  @ApiProperty({ type: String, nullable: true }) activityCode: string | null;
}

@ApiSchema({ name: 'CompanyBranchRef' })
export class CompanyBranchRefDto {
  @ApiProperty({ example: 'BTO', description: 'The source system that knows the branch' })
  system: string;
  @ApiProperty({ description: "The branch's id in that system" }) externalId: string;
}

@ApiSchema({ name: 'CompanyBranch' })
export class CompanyBranchDto {
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: STATUSES }) status: (typeof STATUSES)[number];
  @ApiProperty({ type: [CompanyBranchRefDto] }) refs: CompanyBranchRefDto[];
}

@ApiSchema({ name: 'Company' })
export class CompanyDto {
  @ApiProperty({ example: 'BO', description: 'The Finance Core company code (bto.company_code)' })
  code: string;
  @ApiProperty() legalName: string;
  @ApiProperty({ type: String, nullable: true, description: 'State register number' })
  registerNo: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Taxpayer number (ТТД)' })
  tin: string | null;
  @ApiProperty({ example: 'MNT' }) functionalCurrency: string;
  @ApiProperty({ example: 'Asia/Ulaanbaatar' }) timezone: string;
  @ApiProperty({ minimum: 1, maximum: 12 }) fiscalYearStartMonth: number;
  @ApiProperty({ enum: STATUSES }) status: (typeof STATUSES)[number];
  @ApiProperty({ type: [CompanyTaxRegistrationDto] }) taxRegistrations: CompanyTaxRegistrationDto[];
  @ApiProperty({ type: [CompanyBranchDto], description: 'Branches mapped from source systems' })
  branches: CompanyBranchDto[];
}

@ApiSchema({ name: 'CompanyUpdateRequest' })
export class UpdateCompanyDto {
  @ApiProperty({ maxLength: 200 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  legalName: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'State register number: 7 digits for a company; null or blank clears it',
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(32)
  registerNo: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Taxpayer number: 11 digits for a company; null or blank clears it',
  })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(32)
  tin: string | null;
}
