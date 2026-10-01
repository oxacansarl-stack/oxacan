/**
 * Props every page accepts. A page rendered as a tab of another page (Fournisseurs inside
 * Achats, Véhicules inside Stock & matériel, the Administration tabs) receives `embedded`
 * and must not render its own PageHeader — the host page already did.
 */
export interface PageProps {
  embedded?: boolean;
}
