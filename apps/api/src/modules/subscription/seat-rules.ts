/**
 * Seat rules of the licence model (PRD §4.1, §18.2, §25.1). Pure, so they are unit-tested.
 *
 * - Billing is per named user, in two licence tiers: "saas" (workers, team leaders) and
 *   "application" (project managers, management, estimators). Every active app_user takes one
 *   seat of its own tier (app_user.licence_tier); a deactivated user frees it immediately.
 * - The subscription buys saas_seat_count saas seats and application_seat_count application
 *   seats. A seat of one tier cannot be used by a user of the other.
 * - Only a subscription in force grants seats: active, trialing (until trial_ends_at) and
 *   past_due (Stripe keeps the subscription in force while it retries the payment). A cancelled
 *   or paused subscription grants none, nor one whose trial or billing period is over (with a
 *   grace period for renewals that are recorded late: webhook lag, payment by bank transfer).
 *   Users already active stay active; only adding or reactivating users needs a free seat.
 */

export type LicenceTierName = 'saas' | 'application';
export const LICENCE_TIERS: readonly LicenceTierName[] = ['saas', 'application'];

export const SEAT_GRANTING_STATUSES = new Set(['active', 'trialing', 'past_due']);
/** How long after current_period_end a not-yet-renewed subscription still grants seats. */
export const PERIOD_END_GRACE_DAYS = 7;

export interface SubscriptionSeats {
  status: string;
  saasSeatCount: number | null;
  applicationSeatCount: number | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

export interface TierSeats {
  used: number;
  total: number;
  available: number;
}

export interface SeatAvailability extends TierSeats {
  /** The tier `used`, `total` and `available` describe; null: both tiers added up. */
  licenceTier: LicenceTierName | null;
  /** null: the company has no subscription. */
  subscriptionStatus: string | null;
  /** Whether the subscription grants seats right now. */
  subscriptionActive: boolean;
  byTier: Record<LicenceTierName, TierSeats>;
}

export function isLicenceTier(value: unknown): value is LicenceTierName {
  return value === 'saas' || value === 'application';
}

export function grantsSeats(sub: SubscriptionSeats | null, now: Date = new Date()): boolean {
  if (!sub || !SEAT_GRANTING_STATUSES.has(sub.status)) return false;
  if (sub.status === 'trialing' && sub.trialEndsAt && new Date(sub.trialEndsAt) <= now) return false;
  if (sub.currentPeriodEnd) {
    const graceEnd = new Date(sub.currentPeriodEnd).getTime() + PERIOD_END_GRACE_DAYS * 86_400_000;
    if (graceEnd <= now.getTime()) return false;
  }
  return true;
}

/**
 * @param used active users per licence tier
 * @param licenceTier the tier a user is about to take a seat of; omitted: both tiers together
 *   (the overview, and callers that do not know the tier yet).
 */
export function seatAvailability(
  sub: SubscriptionSeats | null,
  used: Partial<Record<LicenceTierName, number>>,
  licenceTier?: LicenceTierName,
  now: Date = new Date(),
): SeatAvailability {
  const active = grantsSeats(sub, now);
  const purchased: Record<LicenceTierName, number> = {
    saas: active ? Math.max(0, sub!.saasSeatCount ?? 0) : 0,
    application: active ? Math.max(0, sub!.applicationSeatCount ?? 0) : 0,
  };
  const byTier = Object.fromEntries(
    LICENCE_TIERS.map((tier) => {
      const u = used[tier] ?? 0;
      return [tier, { used: u, total: purchased[tier], available: purchased[tier] - u }];
    }),
  ) as Record<LicenceTierName, TierSeats>;

  const summary: TierSeats = licenceTier
    ? byTier[licenceTier]
    : {
        used: byTier.saas.used + byTier.application.used,
        total: byTier.saas.total + byTier.application.total,
        available: byTier.saas.available + byTier.application.available,
      };

  return {
    ...summary,
    licenceTier: licenceTier ?? null,
    subscriptionStatus: sub?.status ?? null,
    subscriptionActive: active,
    byTier,
  };
}
