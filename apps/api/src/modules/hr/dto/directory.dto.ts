import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** One colleague on the staff app's «Манайхан»: how to find and reach them, nothing private. */
@ApiSchema({ name: 'HrDirectoryEntry' })
export class HrDirectoryEntryDto {
  @ApiProperty() userId: number;
  @ApiProperty({ description: '«Г. Энхтуяа»: the family name initial and the given name' })
  displayName: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) position: string | null;
  @ApiProperty({ type: String, nullable: true }) divisionName: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'E.164' }) phone: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Not kept yet: always null' })
  email: string | null;
  @ApiProperty({ type: String, nullable: true }) photoUrl: string | null;
}

@ApiSchema({ name: 'HrDirectoryQuery' })
export class HrDirectoryQueryDto {
  @ApiPropertyOptional({ description: 'Name, position, division, phone or email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
