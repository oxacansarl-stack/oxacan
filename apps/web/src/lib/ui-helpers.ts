import React from 'react';

/* ------------------------------------------------------------------ */
/*  Reusable UI state helpers — Loading, Empty, Error                  */
/*  Inline-styled to match the OXACAN design system.                   */
/* ------------------------------------------------------------------ */

export function LoadingState({ message = 'Loading...' }: { message?: string }) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 60,
        color: '#6b7280',
      },
    },
    React.createElement(
      'div',
      {
        style: {
          width: 32,
          height: 32,
          border: '3px solid #e5e7eb',
          borderTopColor: '#2563eb',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          marginBottom: 16,
        },
      },
    ),
    React.createElement('span', { style: { fontSize: 14 } }, message),
    // Inject the keyframes once
    React.createElement('style', null, '@keyframes spin { to { transform: rotate(360deg); } }'),
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 60,
        color: '#9ca3af',
      },
    },
    // Simple empty-box illustration via CSS
    React.createElement(
      'div',
      {
        style: {
          width: 64,
          height: 64,
          borderRadius: 12,
          border: '2px dashed #d1d5db',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
          fontSize: 28,
          color: '#d1d5db',
        },
      },
      '?',
    ),
    React.createElement(
      'div',
      { style: { fontSize: 16, fontWeight: 600, color: '#6b7280', marginBottom: 4 } },
      title,
    ),
    description
      ? React.createElement(
          'div',
          { style: { fontSize: 13, color: '#9ca3af', maxWidth: 320, textAlign: 'center' as const } },
          description,
        )
      : null,
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 60,
      },
    },
    React.createElement(
      'div',
      {
        style: {
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: '#fef2f2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
          fontSize: 22,
          color: '#dc2626',
          fontWeight: 700,
        },
      },
      '!',
    ),
    React.createElement(
      'div',
      { style: { fontSize: 14, color: '#dc2626', marginBottom: onRetry ? 12 : 0, textAlign: 'center' as const, maxWidth: 400 } },
      message,
    ),
    onRetry
      ? React.createElement(
          'button',
          {
            onClick: onRetry,
            style: {
              padding: '8px 16px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            },
          },
          'Retry',
        )
      : null,
  );
}
