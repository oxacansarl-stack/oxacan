import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// One namespace per file: fr/common.json → 'common', fr/offers.json → 'offers'.
// V1 ships French only (PRD §4.5); German is added later as de/*.json.
const files = import.meta.glob<{ default: Record<string, unknown> }>('./fr/*.json', { eager: true });
const fr = Object.fromEntries(
  Object.entries(files).map(([path, mod]) => [path.replace(/^.*\/(.+)\.json$/, '$1'), mod.default]),
);

i18n.use(initReactI18next).init({
  lng: 'fr',
  fallbackLng: 'fr',
  resources: { fr },
  ns: Object.keys(fr),
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: (_lngs, ns, key) => {
    // Surfaced as a console error so UI checks catch untranslated keys.
    console.error(`[i18n] missing key ${ns}:${key}`);
  },
});

export default i18n;
