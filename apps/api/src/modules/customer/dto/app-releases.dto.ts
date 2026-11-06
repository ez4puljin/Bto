import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/** An app's newest published APK (ADR-0166). */
@ApiSchema({ name: 'AppRelease' })
export class AppReleaseDto {
  @ApiProperty({ example: '0.4.0' })
  version!: string;

  /** Grows with every build; the phone compares it with its own. */
  @ApiProperty({ example: 445441 })
  versionCode!: number;

  @ApiProperty({ example: 78_500_000 })
  sizeBytes!: number;
}

@ApiSchema({ name: 'AppReleaseLookup' })
export class AppReleaseLookupDto {
  @ApiProperty({ type: AppReleaseDto, nullable: true })
  release!: AppReleaseDto | null;
}
