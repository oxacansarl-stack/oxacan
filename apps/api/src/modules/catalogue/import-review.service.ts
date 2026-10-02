import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { BusinessRuleError, NotFoundError, ValidationError } from '@oxacan/shared-types';
import { CanonicalArticle } from './entities/canonical-article.entity';
import { ImportDraft } from './entities/import-draft.entity';
import { ImportDraftRow } from './entities/import-draft-row.entity';
import { CatalogueService } from './catalogue.service';
import { parseSoumission, PdfImportRow } from './pdf-soumission.parser';
import { extractPdfText } from './pdf-text.extractor';
import { ConfirmDraftDto, UpdateDraftRowDto } from './dto/import-review.dto';

/**
 * Why a line wants a human eye before it is believed. These are the ways a reading goes wrong that
 * the document itself can show us, so the reviewer looks at the handful of lines that matter
 * instead of all two thousand.
 */
export const ROW_FLAGS = {
  /** quantity x unit price does not come to the printed total: a figure landed in the wrong column. */
  TOTAL_MISMATCH: 'TOTAL_MISMATCH',
  /** No code at all: it cannot join the catalogue by itself. */
  NO_CODE: 'NO_CODE',
  /** A code the catalogue has never seen. */
  UNKNOWN_CODE: 'UNKNOWN_CODE',
  /** A 000000xx number means something only inside its own soumission (R003). */
  INTERNAL_CODE: 'INTERNAL_CODE',
  /** Same code as a known article, different unit: one of the two is wrong (§6.1). */
  UNIT_MISMATCH: 'UNIT_MISMATCH',
  MISSING_QUANTITY: 'MISSING_QUANTITY',
  MISSING_UNIT: 'MISSING_UNIT',
  MISSING_PRICE: 'MISSING_PRICE',
  /** No description: nothing for a person or a semantic match to recognise it by. */
  MISSING_DESCRIPTION: 'MISSING_DESCRIPTION',
} as const;

/**
 * The flags that stop a confirmation going through unchallenged: the ones where the document
 * contradicts itself or the catalogue, which is as close as we get to proof that a line was read
 * wrong. The rest are advisory — a code the catalogue has never seen is the normal state of a
 * first import, and a tender with no prices yet is exactly what a tender is. Blocking on those
 * would mean every confirmation needs an override, and an override everyone always clicks is not
 * a check.
 */
export const BLOCKING_FLAGS: ReadonlySet<string> = new Set([
  ROW_FLAGS.TOTAL_MISMATCH,
  ROW_FLAGS.UNIT_MISMATCH,
]);

/** Beyond a rounding step the printed total disagrees with quantity x unit price. */
const TOTAL_TOLERANCE_CENTS = 5;
const isProjectInternalCode = (code: string) => /^0{3,}\d*$/.test(code.trim());
const sameUnit = (a?: string | null, b?: string | null) =>
  !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase();
const num = (v: string | number | null | undefined) => (v == null ? undefined : Number(v));

@Injectable()
export class ImportReviewService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ImportDraft) private readonly draftRepo: Repository<ImportDraft>,
    @InjectRepository(ImportDraftRow) private readonly rowRepo: Repository<ImportDraftRow>,
    @InjectRepository(CanonicalArticle) private readonly articleRepo: Repository<CanonicalArticle>,
    private readonly catalogue: CatalogueService,
  ) {}

  /* ───────────── Creating a draft ───────────── */

  /**
   * Reads a soumission PDF and parks the result for review. Nothing reaches the catalogue here:
   * that only happens on confirm, which is the point — a reading that was never checked should not
   * be able to move a price.
   */
  async draftFromPdf(
    companyId: string,
    userId: string,
    file: { buffer: Buffer; originalname: string } | undefined,
    meta: { projectName?: string; projectYear?: number; entrepreneurName?: string; documentDate?: string },
  ) {
    if (!file?.buffer?.length) throw new ValidationError('A PDF file is required (multipart field "file").');
    const parsed = parseSoumission(await extractPdfText(file.buffer));
    if (!parsed.rows.length) {
      throw new BusinessRuleError(
        'PDF_NO_POSITIONS',
        'No soumission positions were found in this PDF (scanned document or unsupported layout).',
      );
    }
    if (parsed.rows.length > 20000) {
      throw new ValidationError('The PDF holds more than 20 000 positions; split it before importing.');
    }
    const documentDate = meta.documentDate ?? parsed.documentDate ?? null;
    return this.createDraft(companyId, userId, {
      source: 'pdf',
      filename: file.originalname,
      contentSha256: createHash('sha256').update(file.buffer).digest('hex'),
      projectName: meta.projectName ?? parsed.projectName ?? null,
      projectYear: meta.projectYear ?? (documentDate ? Number(documentDate.slice(0, 4)) : null),
      entrepreneurName: meta.entrepreneurName ?? null,
      documentDate,
      documentReference: parsed.reference,
      pageCount: parsed.pageCount,
      rows: parsed.rows,
    });
  }

  private async createDraft(
    companyId: string,
    userId: string,
    input: {
      source: 'pdf' | 'csv';
      filename: string;
      contentSha256: string;
      projectName: string | null;
      projectYear: number | null;
      entrepreneurName: string | null;
      documentDate: string | null;
      documentReference: string | null;
      pageCount: number | null;
      rows: PdfImportRow[];
    },
  ) {
    const existing = await this.draftRepo.findOne({
      where: { companyId, contentSha256: input.contentSha256 },
      select: { id: true, status: true },
    });
    if (existing) {
      throw new BusinessRuleError(
        'DUPLICATE_IMPORT',
        existing.status === 'pending'
          ? 'This file is already waiting to be reviewed.'
          : 'This file has already been imported.',
        { draftId: existing.id, status: existing.status },
      );
    }

    const flagged = await this.flagRows(companyId, input.rows);
    return this.dataSource.transaction(async (m) => {
      const draft = await m.save(
        m.create(ImportDraft, {
          companyId,
          status: 'pending',
          source: input.source,
          filename: input.filename.slice(0, 255),
          projectName: input.projectName,
          projectYear: input.projectYear,
          entrepreneurName: input.entrepreneurName,
          documentDate: input.documentDate,
          documentReference: input.documentReference,
          pageCount: input.pageCount,
          contentSha256: input.contentSha256,
          rowCount: input.rows.length,
          flaggedCount: flagged.filter((r) => r.flags.length > 0).length,
          createdBy: userId,
        }),
      );
      await m.save(
        flagged.map((r) =>
          m.create(ImportDraftRow, { ...r.row, companyId, draftId: draft.id, flags: r.flags, reviewStatus: 'pending' }),
        ),
      );
      return this.load(companyId, draft.id, m.getRepository(ImportDraft), m.getRepository(ImportDraftRow));
    });
  }

  /** Works out, for every line, what a reviewer should be told about it. */
  private async flagRows(companyId: string, rows: PdfImportRow[]) {
    const codes = [...new Set(rows.map((r) => r.npkNumber).filter((c): c is string => !!c))];
    const known = codes.length
      ? await this.articleRepo.find({
          where: { companyId, npkNumber: In(codes), isActive: true },
          select: { npkNumber: true, unit: true },
        })
      : [];
    const byCode = new Map(known.map((a) => [a.npkNumber, a]));

    return rows.map((row) => {
      const flags: string[] = [];
      if (!row.npkNumber) flags.push(ROW_FLAGS.NO_CODE);
      else if (isProjectInternalCode(row.npkNumber)) flags.push(ROW_FLAGS.INTERNAL_CODE);
      else {
        const article = byCode.get(row.npkNumber);
        if (!article) flags.push(ROW_FLAGS.UNKNOWN_CODE);
        else if (!sameUnit(article.unit, row.unit)) flags.push(ROW_FLAGS.UNIT_MISMATCH);
      }
      if (!row.description?.trim()) flags.push(ROW_FLAGS.MISSING_DESCRIPTION);
      if (row.quantity == null) flags.push(ROW_FLAGS.MISSING_QUANTITY);
      if (!row.unit) flags.push(ROW_FLAGS.MISSING_UNIT);
      if (row.unitPriceCents == null) flags.push(ROW_FLAGS.MISSING_PRICE);
      // The document's own arithmetic is the strongest check we have that the figures were read
      // out of the right columns.
      if (row.quantity != null && row.unitPriceCents != null && row.totalPriceCents != null) {
        const expected = Math.round(row.quantity * row.unitPriceCents);
        if (Math.abs(Math.abs(expected) - Math.abs(row.totalPriceCents)) > TOTAL_TOLERANCE_CENTS) {
          flags.push(ROW_FLAGS.TOTAL_MISMATCH);
        }
      }
      return { row, flags };
    });
  }

  /* ───────────── Reviewing ───────────── */

  async list(companyId: string, status?: string) {
    return this.draftRepo.find({
      where: { companyId, ...(status ? { status } : {}) },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async get(companyId: string, id: string) {
    return this.load(companyId, id, this.draftRepo, this.rowRepo);
  }

  private async load(
    companyId: string,
    id: string,
    drafts: Repository<ImportDraft>,
    rows: Repository<ImportDraftRow>,
  ) {
    const draft = await drafts.findOne({ where: { id, companyId } });
    if (!draft) throw new NotFoundError('ImportDraft', id);
    const all = await rows.find({ where: { companyId, draftId: id }, order: { lineNumber: 'ASC' } });
    return {
      ...draft,
      rows: all.map((r) => ({
        ...r,
        quantity: num(r.quantity),
        unitPriceCents: num(r.unitPriceCents),
        totalPriceCents: num(r.totalPriceCents),
      })),
    };
  }

  /** Corrects one line, or drops it. Re-flags it, so a correction visibly clears its warnings. */
  async updateRow(companyId: string, draftId: string, rowId: string, dto: UpdateDraftRowDto) {
    return this.dataSource.transaction(async (m) => {
      const draft = await m.findOne(ImportDraft, { where: { id: draftId, companyId } });
      if (!draft) throw new NotFoundError('ImportDraft', draftId);
      this.assertPending(draft);
      const row = await m.findOne(ImportDraftRow, { where: { id: rowId, companyId, draftId } });
      if (!row) throw new NotFoundError('ImportDraftRow', rowId);

      if (dto.excluded !== undefined) row.reviewStatus = dto.excluded ? 'excluded' : 'pending';
      const corrections = Object.entries(dto).filter(([k, v]) => k !== 'excluded' && v !== undefined);
      Object.assign(row, Object.fromEntries(corrections));
      if (corrections.length > 0) {
        row.reviewStatus = row.reviewStatus === 'excluded' ? 'excluded' : 'edited';
        row.editedAt = new Date();
      }

      const [{ flags }] = await this.flagRows(companyId, [this.toImportRow(row)]);
      row.flags = row.reviewStatus === 'excluded' ? [] : flags;
      await m.save(row);

      const remaining = await m.count(ImportDraftRow, { where: { companyId, draftId } });
      const flaggedRows = await m.find(ImportDraftRow, { where: { companyId, draftId }, select: { flags: true } });
      draft.rowCount = remaining;
      draft.flaggedCount = flaggedRows.filter((r) => r.flags.length > 0).length;
      await m.save(draft);
      return this.load(companyId, draftId, m.getRepository(ImportDraft), m.getRepository(ImportDraftRow));
    });
  }

  /** Corrects the document's own details (project, date) before confirming. */
  async updateDraft(
    companyId: string,
    id: string,
    dto: { projectName?: string; projectYear?: number; entrepreneurName?: string; documentDate?: string },
  ) {
    const draft = await this.draftRepo.findOne({ where: { id, companyId } });
    if (!draft) throw new NotFoundError('ImportDraft', id);
    this.assertPending(draft);
    Object.assign(draft, Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)));
    await this.draftRepo.save(draft);
    return this.get(companyId, id);
  }

  async discard(companyId: string, id: string, userId: string) {
    const draft = await this.draftRepo.findOne({ where: { id, companyId } });
    if (!draft) throw new NotFoundError('ImportDraft', id);
    this.assertPending(draft);
    draft.status = 'discarded';
    draft.decidedBy = userId;
    draft.decidedAt = new Date();
    await this.draftRepo.save(draft);
    return { id: draft.id, status: draft.status };
  }

  /* ───────────── Confirming ───────────── */

  /**
   * The moment the reading becomes fact. Only now are source occurrences written, prices observed
   * and catalogue statistics recomputed — from the corrected lines, excluding the dropped ones.
   *
   * Lines still carrying a flag block the confirmation unless the reviewer says they looked
   * (`acceptFlagged`), so "I did not notice" and "I decided it is fine" stay different things.
   */
  async confirm(companyId: string, userId: string, id: string, dto: ConfirmDraftDto) {
    const draft = await this.draftRepo.findOne({ where: { id, companyId } });
    if (!draft) throw new NotFoundError('ImportDraft', id);
    this.assertPending(draft);

    const rows = await this.rowRepo.find({ where: { companyId, draftId: id }, order: { lineNumber: 'ASC' } });
    const kept = rows.filter((r) => r.reviewStatus !== 'excluded');
    if (kept.length === 0) {
      throw new BusinessRuleError('DRAFT_EMPTY', 'Every line of this import was excluded; there is nothing to import.');
    }
    const contradictory = kept.filter((r) => r.flags.some((f) => BLOCKING_FLAGS.has(f)));
    if (contradictory.length > 0 && !dto.acceptFlagged) {
      throw new BusinessRuleError(
        'DRAFT_HAS_FLAGS',
        `${contradictory.length} line(s) do not add up. Correct them, exclude them, or confirm with acceptFlagged.`,
        { flaggedLines: contradictory.slice(0, 50).map((r) => ({ lineNumber: r.lineNumber, flags: r.flags })) },
      );
    }

    const result = await this.catalogue.importCsv(companyId, userId, {
      filename: draft.filename,
      projectName: draft.projectName ?? undefined,
      projectYear: draft.projectYear ?? undefined,
      entrepreneurName: draft.entrepreneurName ?? undefined,
      documentType: 'soumission',
      documentDate: draft.documentDate ?? undefined,
      rows: kept.map((r) => this.toImportRow(r)),
    });

    draft.status = 'confirmed';
    draft.decidedBy = userId;
    draft.decidedAt = new Date();
    draft.sourceDocumentId = result.document.id;
    await this.draftRepo.save(draft);

    return {
      ...result,
      draftId: draft.id,
      excludedRows: rows.length - kept.length,
      correctedRows: rows.filter((r) => r.reviewStatus === 'edited').length,
      acceptedWithFlags: contradictory.length,
    };
  }

  private assertPending(draft: ImportDraft) {
    if (draft.status !== 'pending') {
      throw new BusinessRuleError('DRAFT_NOT_PENDING', `This import was already ${draft.status}.`);
    }
  }

  private toImportRow(r: ImportDraftRow): PdfImportRow {
    return {
      lineNumber: r.lineNumber,
      rawText: r.rawText || ' ',
      page: r.page ?? undefined,
      npkNumber: r.npkNumber ?? undefined,
      description: r.description ?? undefined,
      unit: r.unit ?? undefined,
      quantity: num(r.quantity),
      unitPriceCents: num(r.unitPriceCents),
      totalPriceCents: num(r.totalPriceCents),
      sectionCode: r.sectionCode ?? undefined,
      roomType: r.roomType ?? undefined,
      floor: r.floor ?? undefined,
      isVariant: r.isVariant,
    } as PdfImportRow;
  }
}
