"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditAction = exports.SubscriptionTier = exports.LicenceTier = exports.UserRole = void 0;
var UserRole;
(function (UserRole) {
    UserRole["ADMIN"] = "ADMIN";
    UserRole["PROJECT_MANAGER"] = "PROJECT_MANAGER";
    UserRole["TEAM_LEADER"] = "TEAM_LEADER";
    UserRole["WORKER"] = "WORKER";
})(UserRole || (exports.UserRole = UserRole = {}));
var LicenceTier;
(function (LicenceTier) {
    LicenceTier["SAAS"] = "saas";
    LicenceTier["APPLICATION"] = "application";
})(LicenceTier || (exports.LicenceTier = LicenceTier = {}));
var SubscriptionTier;
(function (SubscriptionTier) {
    SubscriptionTier["SOLO"] = "solo";
    SubscriptionTier["EQUIPE"] = "equipe";
    SubscriptionTier["ENTREPRISE"] = "entreprise";
})(SubscriptionTier || (exports.SubscriptionTier = SubscriptionTier = {}));
var AuditAction;
(function (AuditAction) {
    AuditAction["CREATE"] = "CREATE";
    AuditAction["UPDATE"] = "UPDATE";
    AuditAction["DELETE"] = "DELETE";
    AuditAction["LOGIN"] = "LOGIN";
    AuditAction["LOGOUT"] = "LOGOUT";
    AuditAction["EXPORT"] = "EXPORT";
})(AuditAction || (exports.AuditAction = AuditAction = {}));
//# sourceMappingURL=enums.js.map