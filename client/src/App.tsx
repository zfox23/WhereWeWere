import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { LocationProvider } from './contexts/LocationContext';
import Layout from './components/Layout';
import Home from './pages/Home';
import CheckIn from './pages/CheckIn';
import VenueDetail from './pages/VenueDetail';
import Profile from './pages/Profile';
import CheckInDetail from './pages/CheckInDetail';
import Settings from './pages/Settings';
import MoodCheckIn from './pages/MoodCheckIn';
import MoodCheckInDetail from './pages/MoodCheckInDetail';
import SleepCheckIn from './pages/SleepCheckIn';
import SleepDetail from './pages/SleepDetail';
import TrackCheckIn from './pages/TrackCheckIn';
import TrackDetail from './pages/TrackDetail';
import MediaCheckInLanding from './pages/media/MediaCheckInLanding';
import MediaSearch from './pages/media/MediaSearch';
import MediaCheckInForm from './pages/media/MediaCheckInForm';
import TvEpisodePicker from './pages/media/TvEpisodePicker';
import TvEpisodeCheckInForm from './pages/media/TvEpisodeCheckInForm';
import MediaDetail from './pages/media/MediaDetail';

export default function App() {
  return (
    <ThemeProvider>
    <LocationProvider>
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/check-in" element={<CheckIn />} />
        <Route path="/mood-check-in" element={<MoodCheckIn />} />
        <Route path="/sleep-check-in" element={<SleepCheckIn />} />
        <Route path="/sleep-entries/:id" element={<SleepDetail />} />
        <Route path="/track-check-in" element={<TrackCheckIn />} />
        <Route path="/tracks/:id" element={<TrackDetail />} />
        <Route path="/mood-checkins/:id" element={<MoodCheckInDetail />} />
        <Route path="/checkins/:id" element={<CheckInDetail />} />

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
      </Routes>
    </Layout>
    </LocationProvider>
    </ThemeProvider>
  );
}
