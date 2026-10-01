import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader, PageBody } from '@/components/page-header';
import { useCurrentUser, type Role } from '@/lib/current-user';

export interface PageTab {
  /** Also the ?tab= value, so a tab can be linked to and bookmarked. */
  value: string;
  label: string;
  /** Omit to show the tab to everyone who can open the page. */
  roles?: Role[];
  render: () => React.ReactNode;
}

/**
 * A page made of tabs, with the open tab in the URL (?tab=suppliers). Tabs the role may not
 * use are not rendered at all — several of these call endpoints that would answer 403.
 */
export function TabbedPage({
  title,
  kicker,
  meta,
  actions,
  tabs,
}: {
  title: React.ReactNode;
  kicker?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  tabs: PageTab[];
}) {
  const { role } = useCurrentUser();
  const [params, setParams] = useSearchParams();

  const visible = tabs.filter((tab) => !tab.roles || tab.roles.includes(role));
  const requested = params.get('tab');
  const active = visible.some((tab) => tab.value === requested) ? requested! : visible[0]?.value;

  if (visible.length === 0) return null;

  return (
    <PageBody>
      <PageHeader title={title} kicker={kicker} meta={meta} actions={actions} />
      <Tabs
        value={active}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          next.set('tab', value);
          setParams(next, { replace: true });
        }}
        className="grid gap-5"
      >
        {visible.length > 1 ? (
          <TabsList>
            {visible.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        ) : null}
        {visible.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {tab.render()}
          </TabsContent>
        ))}
      </Tabs>
    </PageBody>
  );
}
