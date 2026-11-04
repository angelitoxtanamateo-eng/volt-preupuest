import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { envCheck } from './lib/supabase';
import { App } from './app/App';
import { AuthProvider } from './app/AuthProvider';
import { ToastProvider, VoltMark } from './components/ui';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

function ConfigError({ reason }: { reason: string }) {
  return (
    <div className="mx-auto mt-16 max-w-lg p-6">
      <div className="card p-6">
        <VoltMark size={40} />
        <h1 className="mt-3 text-xl font-bold">Falta configurar la aplicación</h1>
        <p className="mt-2 text-slate-600">{reason}</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {envCheck.ok ? (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    ) : (
      <ConfigError reason={envCheck.reason} />
    )}
  </StrictMode>,
);
