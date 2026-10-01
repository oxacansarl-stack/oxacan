import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Defaults to "Supprimer" for the danger tone, otherwise "Confirmer". */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = React.createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

/**
 * Replaces window.confirm, which the browser renders unstyled, blocks the page with, and
 * which some embedded views suppress entirely. Usage mirrors the old call:
 *
 *   if (!(await confirm({ title: '…' }))) return;
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = React.useState<Pending | null>(null);

  const confirm = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  const settle = React.useCallback(
    (ok: boolean) => {
      setPending((current) => {
        current?.resolve(ok);
        return null;
      });
    },
    [],
  );

  const danger = pending?.tone !== 'default';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && settle(false)}>
        {pending ? (
          <DialogContent className="w-[min(480px,calc(100vw-32px))]" hideClose>
            <DialogHeader>
              <DialogTitle>{pending.title}</DialogTitle>
              {pending.description ? <DialogDescription>{pending.description}</DialogDescription> : null}
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => settle(false)}>
                {pending.cancelLabel ?? t('actions.cancel')}
              </Button>
              <Button
                variant={danger ? 'danger' : 'primary'}
                onClick={() => settle(true)}
                autoFocus
              >
                {pending.confirmLabel ?? t(danger ? 'actions.delete' : 'actions.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
