import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../../identity';
import { HrDirectoryEntryDto, HrDirectoryQueryDto } from '../dto/directory.dto';
import { DirectoryService } from '../services/directory.service';

/**
 * The company's people for every signed-in staff member (the staff app's «Байгууллага» →
 * «Манайхан»): the employed ones, with what reaches them. A customer token is refused by the
 * global guard (ADR-0082).
 */
@ApiTags('hr')
@Controller('hr')
export class DirectoryController {
  constructor(private readonly directory: DirectoryService) {}

  @Get('directory')
  @Authenticated()
  @ApiOkResponse({ type: [HrDirectoryEntryDto] })
  list(@Query() query: HrDirectoryQueryDto): Promise<HrDirectoryEntryDto[]> {
    return this.directory.list(query.q ?? '');
  }
}
