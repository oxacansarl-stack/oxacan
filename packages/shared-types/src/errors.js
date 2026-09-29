"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessRuleError = exports.TenantIsolationError = exports.NotFoundError = exports.ValidationError = exports.OxacanError = void 0;
class OxacanError extends Error {
    code;
    statusCode;
    details;
    constructor(code, message, statusCode = 500, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'OxacanError';
    }
}
exports.OxacanError = OxacanError;
class ValidationError extends OxacanError {
    constructor(message, details) {
        super('VALIDATION_ERROR', message, 400, details);
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
class NotFoundError extends OxacanError {
    constructor(entity, id) {
        super('NOT_FOUND', `${entity} with id ${id} not found`, 404);
        this.name = 'NotFoundError';
    }
}
exports.NotFoundError = NotFoundError;
class TenantIsolationError extends OxacanError {
    constructor() {
        super('TENANT_VIOLATION', 'Access denied', 403);
        this.name = 'TenantIsolationError';
    }
}
exports.TenantIsolationError = TenantIsolationError;
class BusinessRuleError extends OxacanError {
    constructor(rule, message) {
        super('BUSINESS_RULE', message, 422, { rule });
        this.name = 'BusinessRuleError';
    }
}
exports.BusinessRuleError = BusinessRuleError;
//# sourceMappingURL=errors.js.map