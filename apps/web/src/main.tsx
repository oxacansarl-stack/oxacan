import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import './styles.css';
import { session } from './lib/api';
import Login from './pages/Login';
import Offers from './pages/Offers';
import OfferDetail from './pages/OfferDetail';
import Catalogue from './pages/Catalogue';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Invoices from './pages/Invoices';

function Shell({ children }: { children: React.ReactNode }) {
  const s = session.get(); const nav = useNavigate();
  if (!s) return <Navigate to="/login" replace />;
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">OXACAN</div>
        <NavLink to="/offers">Offres et pipeline</NavLink>
        <NavLink to="/catalogue">Catalogue et articles</NavLink>
        <NavLink to="/projects">Chantiers</NavLink>
        <NavLink to="/invoices">Facturation</NavLink>
        <div className="who"><b>{s.fullName}</b>{s.role} · <a href="#" onClick={(e) => { e.preventDefault(); session.clear(); nav('/login'); }}>déconnexion</a></div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/offers" element={<Shell><Offers /></Shell>} />
        <Route path="/offers/:id" element={<Shell><OfferDetail /></Shell>} />
        <Route path="/catalogue" element={<Shell><Catalogue /></Shell>} />
        <Route path="/projects" element={<Shell><Projects /></Shell>} />
        <Route path="/projects/:id" element={<Shell><ProjectDetail /></Shell>} />
        <Route path="/invoices" element={<Shell><Invoices /></Shell>} />
        <Route path="*" element={<Navigate to="/offers" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
