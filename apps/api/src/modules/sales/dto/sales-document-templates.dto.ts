import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  DOCUMENT_TEMPLATE_KINDS,
  DOCUMENT_TEMPLATE_LIMITS,
  type DocumentTemplateKind,
} from '@tugeel/shared/sales';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ApiSchema({ name: 'SalesDocumentTemplatePipeline' })
export class DocumentTemplatePipelineDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'SalesDocumentTemplate' })
export class DocumentTemplateDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: DOCUMENT_TEMPLATE_KINDS, enumName: 'DocumentTemplateKind' })
  kind: DocumentTemplateKind;
  @ApiProperty() name: string;
  @ApiProperty() isDefault: boolean;
  @ApiProperty({ description: 'The published version in force' }) version: number;
  @ApiProperty({ type: String, format: 'date-time' }) publishedAt: string;
  @ApiProperty({ description: 'Unpublished edits are waiting' }) hasDraft: boolean;
  @ApiProperty({ type: [DocumentTemplatePipelineDto], description: 'The pipelines that chose it' })
  pipelines: DocumentTemplatePipelineDto[];
}

@ApiSchema({ name: 'SalesDocumentTemplateVersion' })
export class DocumentTemplateVersionDto {
  @ApiProperty() version: number;
  @ApiProperty({ type: String, format: 'date-time' }) publishedAt: string;
  @ApiProperty({ type: String, nullable: true }) publishedBy: string | null;
}

@ApiSchema({ name: 'SalesDocumentTemplateDetail' })
export class DocumentTemplateDetailDto extends DocumentTemplateDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The published DocumentLayout (@tugeel/shared/sales): size, blocks',
  })
  layout: Record<string, unknown>;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  draft: Record<string, unknown> | null;
  @ApiProperty({ type: [DocumentTemplateVersionDto] }) versions: DocumentTemplateVersionDto[];
}

@ApiSchema({ name: 'SalesDocumentTemplateCreate' })
export class DocumentTemplateCreateDto {
  @ApiProperty({ enum: DOCUMENT_TEMPLATE_KINDS, enumName: 'DocumentTemplateKind' })
  @IsIn(DOCUMENT_TEMPLATE_KINDS)
  kind: DocumentTemplateKind;
  @ApiProperty({ maxLength: DOCUMENT_TEMPLATE_LIMITS.maxName })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(DOCUMENT_TEMPLATE_LIMITS.maxName)
  name: string;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Copy its published layout' })
  @IsOptional()
  @IsInt()
  @Min(1)
  copyFromId?: number | null;
}

@ApiSchema({ name: 'SalesDocumentTemplateDraft' })
export class DocumentTemplateDraftDto {
  @ApiProperty({ maxLength: DOCUMENT_TEMPLATE_LIMITS.maxName })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(DOCUMENT_TEMPLATE_LIMITS.maxName)
  name: string;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'A DocumentLayout' })
  @IsObject()
  layout: Record<string, unknown>;
}

@ApiSchema({ name: 'SalesDocumentPrintLayoutsQuery' })
export class DocumentPrintLayoutsQueryDto {
  @ApiPropertyOptional({ description: 'Pipeline ids, comma-separated (up to 100)' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9,]{0,1000}$/)
  pipelineIds?: string;
}

@ApiSchema({ name: 'SalesPublishedDocumentTemplate' })
export class PublishedDocumentTemplateDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: DOCUMENT_TEMPLATE_KINDS, enumName: 'DocumentTemplateKind' })
  kind: DocumentTemplateKind;
  @ApiProperty() isDefault: boolean;
  @ApiProperty({ type: 'object', additionalProperties: true }) layout: Record<string, unknown>;
}

@ApiSchema({ name: 'SalesDocumentPipelineChoice' })
export class DocumentPipelineChoiceDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: Number, nullable: true }) pickListTemplateId: number | null;
  @ApiProperty({ type: Number, nullable: true }) deliveryNoteTemplateId: number | null;
}

@ApiSchema({ name: 'SalesDocumentPrintLayouts' })
export class DocumentPrintLayoutsDto {
  @ApiProperty({ type: [PublishedDocumentTemplateDto] }) templates: PublishedDocumentTemplateDto[];
  @ApiProperty({ type: [DocumentPipelineChoiceDto] }) pipelines: DocumentPipelineChoiceDto[];
}
