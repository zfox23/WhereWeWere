import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

/** Standard back button for detail pages — returns to the previous view. */
export function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  // A page opened in a new tab (window.open) or via a deep link is the first
  // entry of its history: React Router tags it with key 'default', and
  // navigate(-1) would do nothing useful there, so go home instead.
  const hasInAppHistory = location.key !== 'default';
  return (
    <button
      type="button"
      onClick={() => (hasInAppHistory ? navigate(-1) : navigate('/'))}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
    >
      <ArrowLeft size={14} />
      Back
    </button>
  );
}
