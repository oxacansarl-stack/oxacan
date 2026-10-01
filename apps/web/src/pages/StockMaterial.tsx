import { useTranslation } from 'react-i18next';
import { TabbedPage } from '@/components/tab-page';
import Stock from './Stock';
import Vehicles from './Vehicles';

/**
 * Stock & matériel: stock and the vehicle fleet under one entry (approved navigation,
 * mockup v3). /vehicles redirects here.
 */
export default function StockMaterial() {
  const { t } = useTranslation();
  return (
    <TabbedPage
      title={t('nav.stock')}
      kicker={t('navGroup.procurement')}
      tabs={[
        { value: 'stock', label: t('tabs.stock'), render: () => <Stock embedded /> },
        { value: 'vehicles', label: t('nav.vehicles'), render: () => <Vehicles embedded /> },
      ]}
    />
  );
}
