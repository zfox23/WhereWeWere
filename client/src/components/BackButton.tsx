import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/** Standard back button for detail pages — returns to the previous view. */
export function BackButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
    >
      <ArrowLeft size={14} />
      Back
    </button>
  );
}
