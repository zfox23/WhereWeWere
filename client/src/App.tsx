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
        <Route path="/venues/:id" element={<VenueDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
    </LocationProvider>
    </ThemeProvider>
  );
}
