import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  Req,
  StreamableFile,
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';
import { CompanyId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, ALL_ROLES, OFFICE_ROLES } from '../../common/decorators/roles.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { PlansService } from './plans.service';
import {
  CreatePlanDto,
  UpdatePlanDto,
  CreateAnnotationDto,
  PLAN_FILE_MAX_BYTES,
  PLAN_UPLOAD_TYPES,
  PlanUploadType,
  isPlanUploadType,
} from './dto/plan.dto';

/**
 * Reads a raw upload body (no global parser handles these content types), never buffering more
 * than `limit` bytes. Compressed bodies are refused so the limit is on the real file size.
 */
function readRawBody(req: Request, limit: number): Promise<Buffer> {
  const encoding = (req.headers['content-encoding'] ?? 'identity').toLowerCase();
  if (encoding !== 'identity') {
    return Promise.reject(new UnsupportedMediaTypeException('Compressed uploads are not accepted.'));
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    return Promise.reject(new PayloadTooLargeException(`The file exceeds ${limit} bytes.`));
  }
  if (req.readableEnded) return Promise.reject(new BadRequestException('The request body was already read.'));

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      req.removeListener('data', onData);
      req.resume(); // discard the rest so the response can still be sent
      reject(err);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) fail(new PayloadTooLargeException(`The file exceeds ${limit} bytes.`));
      else chunks.push(chunk);
    };
    req.on('data', onData);
    req.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    });
    req.once('aborted', () => fail(new BadRequestException('The upload was interrupted.')));
    req.once('error', (err) => fail(err));
  });
}

/** Quoted-string-safe ASCII filename plus the RFC 5987 UTF-8 form. */
function attachment(name: string, ext: string): string {
  const base = name.trim() || 'plan';
  const ascii = base.replace(/[^A-Za-z0-9 ._-]+/g, '_').slice(0, 150);
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(base).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}.${ext}`;
}

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  /** Site staff read building plans, so reads are open to all roles. */
  @Get()
  @Roles(...ALL_ROLES)
  async findAll(
    @CompanyId() companyId: string,
    @Query('projectId') projectId?: string,
    @Query('offerId') offerId?: string,
    @Query('floor') floor?: string,
  ) {
    return this.plansService.findAll(companyId, {
      projectId,
      offerId,
      floor,
    });
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  async findOne(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.plansService.findById(companyId, id);
  }

  @Post()
  @Roles(...OFFICE_ROLES)
  async create(
    @CompanyId() companyId: string,
    @Body() body: CreatePlanDto,
  ) {
    return this.plansService.create(companyId, body);
  }

  @Patch(':id')
  @Roles(...OFFICE_ROLES)
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePlanDto,
  ) {
    return this.plansService.update(companyId, id, body);
  }

  @Delete(':id')
  @Roles(...OFFICE_ROLES)
  async remove(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.plansService.delete(companyId, id);
    return { deleted: true };
  }

  /**
   * Uploads the plan file as the raw request body (Content-Type application/pdf, image/png or
   * image/jpeg, at most 25 MiB). Replaces any previous file of the plan.
   */
  @Post(':id/file')
  @Roles(...OFFICE_ROLES)
  async uploadFile(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!isPlanUploadType(contentType)) {
      throw new UnsupportedMediaTypeException(
        `Plan files must be sent as ${Object.keys(PLAN_UPLOAD_TYPES).join(', ')}.`,
      );
    }
    await this.plansService.assertExists(companyId, id);
    const data = await readRawBody(req, PLAN_FILE_MAX_BYTES);
    const info = await this.plansService.uploadFile(companyId, id, user.id, contentType, data);
    // The audit log records request.body: give it the file's metadata, not its bytes.
    req.body = { contentType: info.contentType, sizeBytes: info.sizeBytes, sha256: info.sha256 };
    return info;
  }

  @Get(':id/file')
  @Roles(...ALL_ROLES)
  @SkipEnvelope()
  async downloadFile(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { file, planName } = await this.plansService.getFile(companyId, id);
    return new StreamableFile(file.data, {
      type: file.contentType,
      disposition: attachment(planName, PLAN_UPLOAD_TYPES[file.contentType as PlanUploadType] ?? 'bin'),
      length: file.data.length,
    });
  }

  @Post(':id/annotations')
  @Roles(...OFFICE_ROLES)
  async addAnnotation(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAnnotationDto,
  ) {
    return this.plansService.addAnnotation(companyId, id, body);
  }

  @Delete(':id/annotations/:annotationId')
  @Roles(...OFFICE_ROLES)
  async removeAnnotation(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('annotationId', ParseUUIDPipe) annotationId: string,
  ) {
    await this.plansService.removeAnnotation(companyId, id, annotationId);
    return { deleted: true };
  }
}
