import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class CreatePortalTokenDto {
  @IsUUID()
  projectId!: string;

  /** timestamptz — ISO 8601 date-time after which the link stops working (max one year). Omit for 90 days. */
  @IsOptional()
  @IsISO8601({ strict: true })
  expiresAt?: string;
}
