import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import CheckIn from './pages/CheckIn';
import History from './pages/History';
import VenueDetail from './pages/VenueDetail';
import StatsPage from './pages/StatsPage';
import Search from './pages/Search';
import DocsLayout from './pages/docs/DocsLayout';
import Overview from './pages/docs/Overview';
import GettingStarted from './pages/docs/GettingStarted';
import ApiCheckins from './pages/docs/ApiCheckins';
import ApiVenues from './pages/docs/ApiVenues';
import ApiStats from './pages/docs/ApiStats';
import ApiSearch from './pages/docs/ApiSearch';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/check-in" element={<CheckIn />} />
        <Route path="/history" element={<History />} />
        <Route path="/venues/:id" element={<VenueDetail />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/search" element={<Search />} />
        <Route path="/docs" element={<DocsLayout><Overview /></DocsLayout>} />
        <Route path="/docs/getting-started" element={<DocsLayout><GettingStarted /></DocsLayout>} />
        <Route path="/docs/api/checkins" element={<DocsLayout><ApiCheckins /></DocsLayout>} />
        <Route path="/docs/api/venues" element={<DocsLayout><ApiVenues /></DocsLayout>} />
        <Route path="/docs/api/stats" element={<DocsLayout><ApiStats /></DocsLayout>} />
        <Route path="/docs/api/search" element={<DocsLayout><ApiSearch /></DocsLayout>} />
      </Routes>
    </Layout>
  );
}
