export class OxacanError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OxacanError';
  }
}

export class ValidationError extends OxacanError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends OxacanError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} with id ${id} not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class TenantIsolationError extends OxacanError {
  constructor() {
    super('TENANT_VIOLATION', 'Access denied', 403);
    this.name = 'TenantIsolationError';
  }
}

export class BusinessRuleError extends OxacanError {
  constructor(rule: string, message: string) {
    super('BUSINESS_RULE', message, 422, { rule });
    this.name = 'BusinessRuleError';
  }
}
