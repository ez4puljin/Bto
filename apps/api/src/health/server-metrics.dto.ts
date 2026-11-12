import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'ServerHost' })
export class ServerHostDto {
  @ApiProperty({ example: 'Linux 7.0.0-43-generic' })
  system: string;

  @ApiProperty({ example: 'x64' })
  arch: string;

  @ApiProperty({ example: 'Intel(R) Xeon(R) CPU E5-4657L v2 @ 2.40GHz' })
  cpuModel: string;

  @ApiProperty({ description: 'logical processors' })
  cpuThreads: number;

  @ApiProperty({ description: 'since the machine started' })
  uptimeSeconds: number;
}

@ApiSchema({ name: 'ServerCpu' })
export class ServerCpuDto {
  @ApiProperty({ description: 'busy share of every processor together, 0–100, one decimal' })
  percent: number;

  @ApiProperty({ type: [Number], description: 'the same per logical processor' })
  perCore: number[];

  @ApiProperty({ description: 'load average of 1 minute (0 on Windows)' })
  load1: number;

  @ApiProperty()
  load5: number;

  @ApiProperty()
  load15: number;
}

@ApiSchema({ name: 'ServerMemory' })
export class ServerMemoryDto {
  @ApiProperty()
  totalBytes: number;

  @ApiProperty({ description: 'total minus what programs can still be given' })
  usedBytes: number;

  @ApiProperty()
  availableBytes: number;

  @ApiProperty({ description: 'buffers and file cache; given back on demand' })
  cachedBytes: number;

  @ApiProperty()
  swapTotalBytes: number;

  @ApiProperty()
  swapUsedBytes: number;

  @ApiProperty({ description: 'usedBytes of totalBytes, 0–100, one decimal' })
  percent: number;
}

@ApiSchema({ name: 'ServerDisk' })
export class ServerDiskDto {
  @ApiProperty()
  totalBytes: number;

  @ApiProperty()
  usedBytes: number;

  @ApiProperty({ description: 'what a program may still write' })
  freeBytes: number;

  @ApiProperty({ description: 'used of used plus free, as df counts it' })
  percent: number;
}

@ApiSchema({ name: 'ServerDatabase' })
export class ServerDatabaseDto {
  @ApiProperty()
  sizeBytes: number;

  @ApiProperty({ description: 'open connections to this database' })
  connections: number;

  @ApiProperty()
  maxConnections: number;
}

@ApiSchema({ name: 'ServerProcess' })
export class ServerProcessDto {
  @ApiProperty({ example: 'v26.7.0' })
  nodeVersion: string;

  @ApiProperty({ description: 'since the api started' })
  uptimeSeconds: number;

  @ApiProperty({ description: 'of one processor; may pass 100' })
  cpuPercent: number;

  @ApiProperty()
  rssBytes: number;

  @ApiProperty()
  heapUsedBytes: number;

  @ApiProperty({ type: Number, nullable: true, description: "the container's memory limit" })
  limitBytes: number | null;
}

@ApiSchema({ name: 'ServerSample' })
export class ServerSampleDto {
  @ApiProperty({ description: 'epoch milliseconds' })
  t: number;

  @ApiProperty({ description: 'processor percent' })
  cpu: number;

  @ApiProperty({ description: 'memory percent' })
  mem: number;
}

/** GET /api/v1/system/server: the machine the api runs on (the panel of «Системийн төлөв»). */
@ApiSchema({ name: 'ServerMetrics' })
export class ServerMetricsDto {
  @ApiProperty({ format: 'date-time' })
  sampledAt: string;

  @ApiProperty({ description: 'seconds between two points of the history' })
  intervalSeconds: number;

  @ApiProperty({ type: ServerHostDto })
  host: ServerHostDto;

  @ApiProperty({ type: ServerCpuDto })
  cpu: ServerCpuDto;

  @ApiProperty({ type: ServerMemoryDto })
  memory: ServerMemoryDto;

  @ApiProperty({ type: ServerDiskDto, nullable: true })
  disk: ServerDiskDto | null;

  @ApiProperty({ type: ServerDatabaseDto, nullable: true })
  database: ServerDatabaseDto | null;

  @ApiProperty({ type: ServerProcessDto })
  process: ServerProcessDto;

  @ApiProperty({
    type: [ServerSampleDto],
    description: 'up to one hour, oldest first; only the points after `since` when it is given',
  })
  history: ServerSampleDto[];
}
