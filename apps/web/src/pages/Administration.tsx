import { useTranslation } from 'react-i18next';
import { TabbedPage } from '@/components/tab-page';
import { ADMIN_ONLY } from '@/app/nav';
import Settings from './Settings';
import Portal from './Portal';
import DataExport from './DataExport';

/**
 * Administration gathers what used to be four sidebar entries. The data export and the
 * audit log are admin-only in the API, so those tabs are not rendered for a project
 * manager — they would answer 403.
 */
export default function Administration() {
  const { t } = useTranslation();
  return (
    <TabbedPage
      title={t('nav.admin')}
      tabs={[
        { value: 'company', label: t('admin.tabs.company'), render: () => <Settings embedded /> },
        { value: 'portal', label: t('nav.portal'), render: () => <Portal embedded /> },
        {
          value: 'data',
          label: t('admin.tabs.data'),
          roles: ADMIN_ONLY,
          render: () => <DataExport embedded />,
        },
      ]}
    />
  );
}
