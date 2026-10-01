import { useTranslation } from 'react-i18next';
import { TabbedPage } from '@/components/tab-page';
import PurchaseOrders from './PurchaseOrders';
import Suppliers from './Suppliers';

/**
 * Achats: purchase orders with suppliers as a tab rather than a separate sidebar entry
 * (approved navigation, mockup v3). /suppliers redirects here.
 */
export default function Procurement() {
  const { t } = useTranslation();
  return (
    <TabbedPage
      title={t('nav.purchaseOrders')}
      kicker={t('navGroup.procurement')}
      tabs={[
        { value: 'orders', label: t('nav.purchaseOrders'), render: () => <PurchaseOrders embedded /> },
        { value: 'suppliers', label: t('nav.suppliers'), render: () => <Suppliers embedded /> },
      ]}
    />
  );
}
