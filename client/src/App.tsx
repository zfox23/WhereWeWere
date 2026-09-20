import { Routes, Route, useParams } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import Layout from './components/Layout';
import Home from './pages/Home';
import { allClientPlugins, getClientPlugin } from './plugins/registry';
import { AutoCheckInForm } from './plugins/autoForm';
import PluginCheckInDetail from './pages/PluginCheckInDetail';
import VenueDetail from '../../plugins/location/ui/VenueDetail';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import MediaCheckInLanding from './pages/media/MediaCheckInLanding';
import MediaSearch from './pages/media/MediaSearch';
import MediaCheckInForm from './pages/media/MediaCheckInForm';
import TvEpisodePicker from './pages/media/TvEpisodePicker';
import TvEpisodeCheckInForm from './pages/media/TvEpisodeCheckInForm';
import MediaDetail from './pages/media/MediaDetail';

/** Check-in page for a specific plugin (create + edit via ?edit=<id>). */
function PluginCheckInPage({ pluginId }: { pluginId: string }) {
  const { id } = useParams<{ id?: string }>();
  const searchParams = new URLSearchParams(window.location.search);
  const editId = searchParams.get('edit') ?? id ?? null;
  const plugin = getClientPlugin(pluginId);
  if (!plugin) return <div className="py-16 text-center text-sm text-gray-500">Unknown check-in type.</div>;

  if (plugin.client.checkInForm) {
    return (
      <plugin.client.checkInForm
        editId={editId}
        dateParam={searchParams.get('date')}
        onCreated={() => window.location.assign('/')}
        onUpdated={() => {}}
      />
    );
  }

  return (
    <AutoCheckInForm
      plugin={{ id: plugin.id, fields: plugin.fields, strings: plugin.strings }}
      editId={editId}
      dateParam={searchParams.get('date')}
      onCreated={() => {}}
      onUpdated={() => {}}
    />
  );
}

/** Detail page for a specific plugin: custom detailPage or the generic one. */
function PluginDetailPage({ pluginId }: { pluginId: string }) {
  const { id } = useParams<{ id: string }>();
  const plugin = getClientPlugin(pluginId);
  if (!plugin) return <div className="py-16 text-center text-sm text-gray-500">Unknown check-in type.</div>;
  if (plugin.client.detailPage) {
    return <plugin.client.detailPage id={id ?? ''} />;
  }
  return <PluginCheckInDetail />;
}

/** Routes contributed by check-in plugins. */
const pluginRouteElements = allClientPlugins().flatMap((plugin) => {
  const elements: React.ReactElement[] = [];
  elements.push(
    <Route key={`form-${plugin.id}`} path={plugin.client.checkInPath} element={<PluginCheckInPage pluginId={plugin.id} />} />,
  );
  const detailPath = plugin.client.detailPath;
  if (detailPath) {
    elements.push(
      <Route key={`detail-${plugin.id}`} path={detailPath} element={<PluginDetailPage pluginId={plugin.id} />} />,
    );
  } else {
    elements.push(
      <Route key={`detail-${plugin.id}`} path={`/checkins/${plugin.id}/:id`} element={<PluginCheckInDetail />} />,
    );
  }
  return elements;
});

export default function App() {
  return (
    <ThemeProvider>
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />

        {/* Media check-ins */}
        <Route path="/media-check-in" element={<MediaCheckInLanding />} />
        <Route path="/media-check-in/movie" element={<MediaSearch subtype="movie" />} />
        <Route path="/media-check-in/movie/:id/:slug" element={<MediaCheckInForm subtype="movie" />} />
        <Route path="/media-check-in/tv-episode" element={<MediaSearch subtype="tv_show" />} />
        <Route path="/media-check-in/tv/:id/:slug" element={<TvEpisodePicker />} />
        <Route path="/media-check-in/tv/:id/:slug/:season/:episode" element={<TvEpisodeCheckInForm />} />
        <Route path="/media-check-in/game" element={<MediaSearch subtype="game" />} />
        <Route path="/media-check-in/game/:id/:slug" element={<MediaCheckInForm subtype="game" />} />
        <Route path="/media-check-in/book" element={<MediaSearch subtype="book" />} />
        <Route path="/media-check-in/book/:id/:slug" element={<MediaCheckInForm subtype="book" />} />
        <Route path="/media-check-in/board-game" element={<MediaSearch subtype="board_game" />} />
        <Route path="/media-check-in/board-game/:id/:slug" element={<MediaCheckInForm subtype="board_game" />} />

        {/* Media detail pages */}
        <Route path="/media/movie/:id/:slug" element={<MediaDetail subtype="movie" />} />
        <Route path="/media/tv/:id/:slug" element={<MediaDetail subtype="tv_show" />} />
        <Route path="/media/game/:id/:slug" element={<MediaDetail subtype="game" />} />
        <Route path="/media/book/:id/:slug" element={<MediaDetail subtype="book" />} />
        <Route path="/media/board-game/:id/:slug" element={<MediaDetail subtype="board_game" />} />
        <Route path="/venues/:id" element={<VenueDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />

        {/* Check-in plugin routes (skip paths registered explicitly above) */}
        {pluginRouteElements}
      </Routes>
    </Layout>
    </ThemeProvider>
  );
}
