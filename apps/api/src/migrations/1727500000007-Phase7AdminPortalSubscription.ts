import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase7AdminPortalSubscription1727500000007
  implements MigrationInterface
{
  name = 'Phase7AdminPortalSubscription1727500000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ========== subscription ==========
    await queryRunner.query(`
      CREATE TABLE subscription (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id) UNIQUE,
        stripe_customer_id TEXT NOT NULL,
        stripe_subscription_id TEXT,
        tier TEXT NOT NULL CHECK (tier IN ('solo', 'equipe', 'entreprise')),
        status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'paused')),
        saas_seat_count INTEGER DEFAULT 1,
        application_seat_count INTEGER DEFAULT 0,
        trial_ends_at TIMESTAMPTZ,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE subscription ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE subscription FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON subscription
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== billing_event ==========
    await queryRunner.query(`
      CREATE TABLE billing_event (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id),
        subscription_id UUID NOT NULL REFERENCES subscription(id),
        type TEXT NOT NULL CHECK (type IN ('payment_succeeded', 'payment_failed', 'tier_changed', 'seat_added', 'seat_removed', 'trial_ended', 'subscription_cancelled')),
        stripe_event_id TEXT UNIQUE,
        amount_cents INTEGER,
        currency TEXT DEFAULT 'CHF',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE billing_event ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE billing_event FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON billing_event
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== portal_token ==========
    await queryRunner.query(`
      CREATE TABLE portal_token (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        project_id UUID NOT NULL REFERENCES project(id),
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT TRUE,
        created_by UUID REFERENCES app_user(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE portal_token ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE portal_token FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON portal_token
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== notification ==========
    await queryRunner.query(`
      CREATE TABLE notification (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        user_id UUID NOT NULL REFERENCES app_user(id),
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        reference_type TEXT,
        reference_id UUID,
        is_read BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMPTZ,
        push_sent BOOLEAN DEFAULT FALSE,
        push_sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE notification ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE notification FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON notification
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== push_device ==========
    await queryRunner.query(`
      CREATE TABLE push_device (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        user_id UUID NOT NULL REFERENCES app_user(id),
        platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
        device_token TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        last_used_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, device_token)
      );
    `);

    await queryRunner.query(
      `ALTER TABLE push_device ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE push_device FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON push_device
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== Indexes ==========
    await queryRunner.query(`
      CREATE INDEX idx_subscription_company ON subscription(company_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_billing_event_subscription ON billing_event(subscription_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_billing_event_company ON billing_event(company_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_portal_token_project ON portal_token(company_id, project_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_portal_token_token ON portal_token(token);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notification_user ON notification(company_id, user_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_notification_unread ON notification(company_id, user_id, is_read);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_push_device_user ON push_device(user_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_push_device_user;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_notification_unread;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_notification_user;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_portal_token_token;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_portal_token_project;`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_billing_event_company;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_billing_event_subscription;`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_subscription_company;`,
    );

    // Drop tables in reverse dependency order
    await queryRunner.query(`DROP TABLE IF EXISTS push_device;`);
    await queryRunner.query(`DROP TABLE IF EXISTS notification;`);
    await queryRunner.query(`DROP TABLE IF EXISTS portal_token;`);
    await queryRunner.query(`DROP TABLE IF EXISTS billing_event;`);
    await queryRunner.query(`DROP TABLE IF EXISTS subscription;`);
  }
}
