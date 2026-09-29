import { UserRole, LicenceTier, SubscriptionTier } from './enums';
export interface ICompany {
    id: string;
    name: string;
    legalName: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    canton: string | null;
    country: string;
    vatNumber: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    logoUrl: string | null;
    defaultVatRate: number;
    defaultMarginFactor: number;
    defaultRetentionRate: number;
    geolocationEnabled: boolean;
    subscriptionTier: SubscriptionTier | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface IAppUser {
    id: string;
    companyId: string;
    supabaseAuthId: string | null;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    role: UserRole;
    licenceTier: LicenceTier;
    hourlyRateCents: number | null;
    cctCode: string | null;
    overtimeBalanceMinutes: number;
    hireDate: Date | null;
    qualifications: Record<string, unknown>[];
    isActive: boolean;
    deactivatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface IAuditLog {
    id: string;
    companyId: string;
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    oldValues: Record<string, unknown> | null;
    newValues: Record<string, unknown> | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
}
//# sourceMappingURL=entities.d.ts.map