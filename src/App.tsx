import { HashRouter, Routes, Route } from 'react-router-dom';
import { DataProvider } from './data/useData';
import { LiveDataProvider } from './data/useLiveData';
import ScrollPage from './pages/ScrollPage';
import ExplorePage from './pages/ExplorePage';
import LandingPage from './pages/LandingPage';
import LiveFrontPage from './pages/LiveFrontPage';
import LiveSimulatorPage from './pages/LiveSimulatorPage';
import SiteTopStrip from './components/site/SiteTopStrip';

export default function App() {
  return (
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
  );
}
