import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { useAuth } from './AuthProvider';
import { Layout } from './Layout';
import { ForgotPage, LoginPage, RegisterPage, ResetPage } from '../pages/AuthPages';
import { NewCompanyPage } from '../pages/NewCompanyPage';
import { DashboardPage } from '../pages/DashboardPage';
import { ClientDetailPage, ClientsPage } from '../pages/ClientsPages';
import { CatalogPage } from '../pages/CatalogPage';
import { QuotesPage } from '../pages/QuotesPage';
import { QuoteEditorPage } from '../pages/QuoteEditorPage';
import { QuoteDetailPage } from '../pages/QuoteDetailPage';
import { SettingsPage } from '../pages/SettingsPage';
import { CalculatorPage } from '../pages/CalculatorPage';

function Private() {
  const { session, loading, company } = useAuth();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (!company) return <NewCompanyPage />;
  return <Layout />;
}

export function App() {
  const { session, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={!loading && session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/registro" element={<RegisterPage />} />
      <Route path="/recuperar" element={<ForgotPage />} />
      <Route path="/restablecer" element={<ResetPage />} />
      <Route element={<Private />}>
        <Route index element={<DashboardPage />} />
        <Route path="presupuestos" element={<QuotesPage />} />
        <Route path="presupuestos/nuevo" element={<QuoteEditorPage />} />
        <Route path="presupuestos/:id" element={<QuoteDetailPage />} />
        <Route path="presupuestos/:id/editar" element={<QuoteEditorPage />} />
        <Route path="clientes" element={<ClientsPage />} />
        <Route path="clientes/:id" element={<ClientDetailPage />} />
        <Route path="catalogo" element={<CatalogPage />} />
        <Route path="calculadora" element={<CalculatorPage />} />
        <Route path="ajustes" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
