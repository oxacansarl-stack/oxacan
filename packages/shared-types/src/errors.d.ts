export declare class OxacanError extends Error {
    code: string;
    statusCode: number;
    details?: Record<string, unknown> | undefined;
    constructor(code: string, message: string, statusCode?: number, details?: Record<string, unknown> | undefined);
}
export declare class ValidationError extends OxacanError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare class NotFoundError extends OxacanError {
    constructor(entity: string, id: string);
}
export declare class TenantIsolationError extends OxacanError {
    constructor();
}
export declare class BusinessRuleError extends OxacanError {
    constructor(rule: string, message: string);
}
//# sourceMappingURL=errors.d.ts.map