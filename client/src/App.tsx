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

export default function App() {
  return (
    <ThemeProvider>
    <LocationProvider>
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/check-in" element={<CheckIn />} />
        <Route path="/mood-check-in" element={<MoodCheckIn />} />
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
