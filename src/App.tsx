import { useState } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { DataProvider } from './data/useData';
import { LiveDataProvider } from './data/useLiveData';
import ScrollPage from './pages/ScrollPage';
import ExplorePage from './pages/ExplorePage';
import LandingPage from './pages/LandingPage';
import LiveFrontPage from './pages/LiveFrontPage';
import LiveSimulatorPage from './pages/LiveSimulatorPage';
import SiteTopStrip from './components/site/SiteTopStrip';

const PASS_HASH = '5d2d3ceb7abe552344276d47d36a8175b7aeb250a9bf0bf00e850cd23ecf2e43';

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function PasswordGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('authed') === '1');
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  if (authed) return <>{children}</>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hash = await sha256(input.trim());
    if (hash === PASS_HASH) {
      sessionStorage.setItem('authed', '1');
      setAuthed(true);
    } else {
      setError(true);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-surface rounded-xl border border-border p-8 w-full max-w-sm">
        <h1 className="text-lg font-bold text-text-primary mb-4">Password required</h1>
        <input
          type="password"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(false); }}
          placeholder="Enter password"
          autoFocus
          className={`w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors ${
            error ? 'border-decrease-600 bg-decrease-50' : 'border-border focus:border-accent-600'
          }`}
        />
        {error && <p className="text-xs text-decrease-600 mt-1">Incorrect password</p>}
        <button
          type="submit"
          className="mt-4 w-full py-2 rounded-lg bg-accent-600 text-white text-sm font-medium hover:bg-accent-700 transition-colors"
        >
          Enter
        </button>
      </form>
    </div>
  );
}

export default function App() {
  return (
    <PasswordGate>
      <HashRouter>
        <DataProvider>
          <LiveDataProvider>
            <div className="min-h-screen bg-bg">
              <SiteTopStrip />
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/tour" element={<ScrollPage />} />
                <Route path="/explore" element={<ExplorePage />} />
                <Route path="/live" element={<LiveFrontPage />} />
                <Route
                  path="/monitor"
                  element={
                    <main className="max-w-[1280px] mx-auto px-6 md:px-12 py-9">
                      <LiveSimulatorPage />
                    </main>
                  }
                />
              </Routes>
            </div>
          </LiveDataProvider>
        </DataProvider>
      </HashRouter>
    </PasswordGate>
  );
}
