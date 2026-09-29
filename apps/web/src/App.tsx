import React, { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import Offers from './pages/Offers';
import OfferDetail from './pages/OfferDetail';
import Contracts from './pages/Contracts';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Timekeeping from './pages/Timekeeping';
import Expenses from './pages/Expenses';
import DailyReports from './pages/DailyReports';
import HR from './pages/HR';
import Suppliers from './pages/Suppliers';
import PurchaseOrders from './pages/PurchaseOrders';
import Stock from './pages/Stock';
import Vehicles from './pages/Vehicles';
import Meetings from './pages/Meetings';
import Invoices from './pages/Invoices';
import Accounting from './pages/Accounting';
import Catalogue from './pages/Catalogue';
import Plans from './pages/Plans';
import Settings from './pages/Settings';
import Portal from './pages/Portal';
import PortalView from './pages/PortalView';
import Notifications from './pages/Notifications';
import DataExport from './pages/DataExport';
import { apiGet } from './lib/api';

const SIDEBAR_WIDTH = 240;

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/clients', label: 'Clients' },
  { to: '/offers', label: 'Offers' },
  { to: '/contracts', label: 'Contracts' },
  { to: '/projects', label: 'Projects' },
  { to: '/timekeeping', label: 'Timekeeping' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/daily-reports', label: 'Daily Reports' },
  { to: '/hr', label: 'HR & Teams' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/purchase-orders', label: 'Purchase Orders' },
  { to: '/stock', label: 'Stock' },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/meetings', label: 'Meetings' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/accounting', label: 'Accounting' },
  { to: '/catalogue', label: 'Catalogue' },
  { to: '/plans', label: 'Plans' },
  { to: '/settings', label: 'Settings' },
  { to: '/portal', label: 'Portal' },
  { to: '/notifications', label: 'Notifications' },
  { to: '/data-export', label: 'Data Export' },
] as const;

export default function App() {
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch unread notification count on mount
  useEffect(() => {
    apiGet<any>('/notifications/unread-count')
      .then(res => {
        const count = res?.data?.count ?? res?.count ?? 0;
        setUnreadCount(count);
      })
      .catch(() => { /* ignore */ });
  }, []);

  // Portal view: render without sidebar
  const isPortalView = window.location.pathname.startsWith('/portal/view/');
  if (isPortalView) {
    return (
      <Routes>
        <Route path="/portal/view/:token" element={<PortalView />} />
      </Routes>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          background: '#f8f9fa',
          borderRight: '1px solid #e5e7eb',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Logo */}
        <div
          style={{
            padding: '20px 20px 16px',
            borderBottom: '1px solid #e5e7eb',
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: -0.5 }}>
            OXACAN
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
            Swiss Construction ERP
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ padding: '12px 10px', flex: 1, overflowY: 'auto' }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#2563eb' : '#4b5563',
                background: isActive ? '#eff6ff' : 'transparent',
                textDecoration: 'none',
                marginBottom: 2,
                transition: 'background 0.15s, color 0.15s',
              })}
            >
              <span>{item.label}</span>
              {item.to === '/notifications' && unreadCount > 0 && (
                <span style={{
                  background: '#dc2626',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 9999,
                  minWidth: 18,
                  height: 18,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 5px',
                  lineHeight: 1,
                }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e5e7eb',
            fontSize: 11,
            color: '#9ca3af',
          }}
        >
          v0.1.0
        </div>
      </aside>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          background: '#fff',
          padding: '24px 32px',
          overflow: 'auto',
        }}
      >
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/offers" element={<Offers />} />
          <Route path="/offers/:id" element={<OfferDetail />} />
          <Route path="/contracts" element={<Contracts />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/timekeeping" element={<Timekeeping />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/daily-reports" element={<DailyReports />} />
          <Route path="/hr" element={<HR />} />
          <Route path="/suppliers" element={<Suppliers />} />
          <Route path="/purchase-orders" element={<PurchaseOrders />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/vehicles" element={<Vehicles />} />
          <Route path="/meetings" element={<Meetings />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/accounting" element={<Accounting />} />
          <Route path="/catalogue" element={<Catalogue />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/portal" element={<Portal />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/data-export" element={<DataExport />} />
        </Routes>
      </main>
    </div>
  );
}
