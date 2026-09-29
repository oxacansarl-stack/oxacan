/**
 * French strings (V1 language). Shared wording (roles, statuses, enum labels,
 * error codes and business rules) is copied verbatim from
 * apps/web/src/i18n/fr/common.json so web and mobile say the same thing.
 * German (V2) will be a sibling file with the same shape.
 *
 * Plurals: a key with `_one` / `_other` variants is picked by the `count` param.
 */
const fr = {
  app: {
    name: 'OXACAN Mobile',
    tagline: 'ERP construction suisse',
    version: 'OXACAN Mobile v{{version}}',
  },
  tabs: {
    home: 'Accueil',
    tasks: 'Tâches',
    time: 'Timbrage',
    profile: 'Profil',
  },
  auth: {
    email: 'E-mail',
    emailPlaceholder: 'nom@entreprise.ch',
    password: 'Mot de passe',
    signIn: 'Se connecter',
    signOut: 'Se déconnecter',
    signInFailed: 'Échec de la connexion',
    invalidCredentials: 'E-mail ou mot de passe incorrect.',
    notConfigured:
      "L'application n'est pas configurée : renseignez EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY.",
    accountNotSetUp:
      "Votre compte n'est pas encore configuré dans OXACAN. Contactez votre administrateur.",
    sessionExpired: 'Votre session a expiré. Veuillez vous reconnecter.',
    serverUnreachable: 'Impossible de joindre le serveur. Réessayez.',
    profileLoadFailed: 'Impossible de charger votre profil',
  },
  actions: {
    cancel: 'Annuler',
    retry: 'Réessayer',
  },
  state: {
    loading: 'Chargement…',
    notAvailable: '—',
    offlineStale: 'Hors ligne : affichage des dernières données connues.',
    waitingToSync: 'En attente de synchronisation',
  },
  day: {
    today: "Aujourd'hui",
    yesterday: 'Hier',
    weekdays: 'dim.|lun.|mar.|mer.|jeu.|ven.|sam.',
  },
  home: {
    greeting: 'Bonjour {{name}}',
    clockStatus: 'Statut du timbrage',
    clockedInSince: 'Timbré depuis {{time}}',
    notClockedIn: 'Pas timbré',
    quickActions: 'Actions rapides',
    newReport: 'Nouveau rapport',
    summary: 'Résumé',
    hoursToday: "Heures aujourd'hui",
    hoursWeek: 'Heures cette semaine',
    waitingToSync: 'En attente de synchronisation',
  },
  clock: {
    in: "Timbrer l'arrivée",
    out: 'Timbrer le départ',
    clockIn: 'Timbrage arrivée',
    clockOut: 'Timbrage départ',
  },
  time: {
    title: 'Timbrage',
    clockedInSince: 'Timbré depuis {{time}} · {{project}}',
    project: 'Chantier',
    noProjects: 'Aucun chantier ne vous est attribué.',
    recentEntries: 'Derniers timbrages',
    submitDrafts_one: 'Soumettre {{count}} brouillon',
    submitDrafts_other: 'Soumettre {{count}} brouillons',
    pendingReports_one: '{{count}} rapport journalier en attente de synchronisation',
    pendingReports_other: '{{count}} rapports journaliers en attente de synchronisation',
    noEntries: 'Aucun timbrage pour le moment.',
  },
  tasks: {
    title: 'Tâches',
    count_one: '{{count}} tâche',
    count_other: '{{count}} tâches',
    assignedCount_one: '{{count}} tâche attribuée',
    assignedCount_other: '{{count}} tâches attribuées',
    status: 'Statut',
    progress: 'Avancement',
    empty: 'Aucune tâche.',
    updateFailed: 'Tâche non mise à jour',
  },
  report: {
    title: 'Rapport journalier',
    project: 'Chantier',
    noProjects: 'Aucun chantier disponible.',
    workDone: 'Travaux effectués',
    workDonePlaceholder: "Travaux réalisés aujourd'hui",
    weather: 'Météo',
    weatherPlaceholder: 'p. ex. Ensoleillé',
    notes: 'Remarques',
    optional: 'Facultatif',
    send: 'Envoyer le rapport',
    sentTitle: 'Rapport envoyé',
    sentMessage: 'Votre rapport journalier a été enregistré.',
    failedTitle: 'Rapport non enregistré',
    kind: 'Rapport journalier',
  },
  profile: {
    title: 'Profil',
    account: 'Compte',
    email: 'E-mail',
    company: 'Entreprise',
    unsyncedTitle: 'Actions non synchronisées',
    unsyncedMessage_one:
      '{{count}} action est en attente de synchronisation. Elle reste sur cet appareil et sera envoyée lors de votre prochaine connexion.',
    unsyncedMessage_other:
      '{{count}} actions sont en attente de synchronisation. Elles restent sur cet appareil et seront envoyées lors de votre prochaine connexion.',
  },
  offline: {
    savedTitle: 'Enregistré hors ligne',
    clockInQueued: "Pas de connexion. Votre timbrage d'arrivée sera envoyé dès que vous serez de nouveau en ligne.",
    clockOutQueued: 'Pas de connexion. Votre timbrage de départ sera envoyé dès que vous serez de nouveau en ligne.',
    reportQueued: 'Pas de connexion. Le rapport sera envoyé dès que vous serez de nouveau en ligne.',
    rejectedTitle: 'Certaines actions hors ligne ont été refusées',
    orphan: "Le timbrage d'arrivée correspondant n'a pas pu être synchronisé.",
    retryOnline: 'Pas de connexion. Réessayez lorsque vous serez en ligne.',
    clockInFailed: "Échec du timbrage d'arrivée",
    clockOutFailed: 'Échec du timbrage de départ',
    submitFailed: "Échec de l'envoi",
  },
  role: {
    ADMIN: 'Administrateur',
    PROJECT_MANAGER: 'Chef de projet',
    TEAM_LEADER: "Chef d'équipe",
    WORKER: 'Ouvrier',
  },
  status: {
    task: {
      todo: 'À faire',
      in_progress: 'En cours',
      done: 'Terminée',
      validated: 'Validée',
      cancelled: 'Annulée',
    },
    timeEntry: {
      draft: 'Brouillon',
      submitted: 'Soumis',
      approved: 'Validé',
      rejected: 'Refusé',
    },
  },
  enum: {
    timeCategory: {
      normal: 'Normal',
      overtime: 'Heures supplémentaires',
      travel: 'Déplacement',
      absence: 'Absence',
    },
  },
  errors: {
    generic: 'Une erreur est survenue. Réessayez.',
    network: 'Impossible de joindre le serveur. Vérifiez votre connexion.',
    code: {
      VALIDATION_ERROR: 'Certaines valeurs saisies sont invalides.',
      UNAUTHORIZED: 'Votre session a expiré. Veuillez vous reconnecter.',
      FORBIDDEN: "Vous n'avez pas l'autorisation d'effectuer cette action.",
      NOT_FOUND: 'Élément introuvable.',
      CONFLICT: 'Un élément avec ces valeurs existe déjà.',
      RATE_LIMITED: 'Trop de requêtes. Réessayez dans un instant.',
      INTERNAL_ERROR: 'Erreur inattendue du serveur. Réessayez plus tard.',
    },
    rule: {
      ALREADY_CLOCKED_OUT: 'Ce timbrage est déjà terminé.',
      ALREADY_COMPLETED: 'Cet élément est déjà terminé.',
      DUPLICATE_REPORT: 'Un rapport journalier existe déjà pour ce chantier à cette date.',
      ENTRY_APPROVED: 'Un timbrage validé ne peut plus être modifié.',
      ENTRY_SUBMITTED: 'Ce timbrage est en attente de validation et ne peut plus être modifié.',
      INVALID_STATUS: "Cette action n'est pas possible dans le statut actuel.",
      INVALID_STATUS_TRANSITION: "Ce changement de statut n'est pas autorisé.",
      NOT_DRAFT: 'Seuls les brouillons peuvent être modifiés.',
      NO_DRAFT_ENTRIES: 'Aucun timbrage à soumettre.',
      OPEN_ENTRIES_EXIST: 'Des timbrages sont encore ouverts.',
      OPEN_ENTRY_EXISTS: "Vous êtes déjà timbré aujourd'hui. Terminez d'abord le timbrage en cours.",
      STATUS_CHANGED: 'Le statut a été modifié entre-temps. Actualisez la page et réessayez.',
    },
  },
};

export type Dictionary = typeof fr;
export default fr;
