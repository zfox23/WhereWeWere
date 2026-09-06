import { useEffect, useMemo, useState } from 'react';
import { findExactOption } from './filterUtils';

export interface LocationFilterProps {
  included: boolean;
  filtersDisabled: boolean;
  sectionDisabled: boolean;
  typeToggleDisabled: boolean;
  category: string;
  country: string;
  categoryOptions: string[];
  countryOptions: string[];
  onToggleIncluded: () => void;
  onSetCategory: (value: string) => void;
  onSetCountry: (value: string) => void;
}

export default function LocationFilter({
  included,
  filtersDisabled,
  sectionDisabled,
  typeToggleDisabled,
  category,
  country,
  categoryOptions,
  countryOptions,
  onToggleIncluded,
  onSetCategory,
  onSetCountry,
}: LocationFilterProps) {
  const [categoryInput, setCategoryInput] = useState(category);
  const [countryInput, setCountryInput] = useState(country);

  useEffect(() => {
    setCategoryInput(category);
  }, [category]);

  useEffect(() => {
    setCountryInput(country);
  }, [country]);

  const filteredCategoryOptions = useMemo(() => {
    const needle = categoryInput.trim().toLowerCase();
    if (!needle) return categoryOptions.slice(0, 30);
    return categoryOptions.filter((opt) => opt.toLowerCase().includes(needle)).slice(0, 30);
  }, [categoryInput, categoryOptions]);

  const filteredCountryOptions = useMemo(() => {
    const needle = countryInput.trim().toLowerCase();
    if (!needle) return countryOptions.slice(0, 30);
    return countryOptions.filter((opt) => opt.toLowerCase().includes(needle)).slice(0, 30);
  }, [countryInput, countryOptions]);

  return (
    <div className={`rounded-xl border p-3 space-y-3 ${filtersDisabled ? 'border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 opacity-60' : 'border-sky-200 dark:border-sky-800/60 bg-sky-50/50 dark:bg-sky-950/20'}`}>
      <div>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={included}
            disabled={typeToggleDisabled}
            onChange={onToggleIncluded}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:cursor-not-allowed"
          />
          <span>Location</span>
        </label>
      </div>
      {filtersDisabled && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Clear mood/sleep filters to enable location filtering.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Category</label>
          <input
            type="text"
            list="category-options"
            value={categoryInput}
            disabled={sectionDisabled}
            onChange={(e) => {
              const next = e.target.value;
              setCategoryInput(next);
              const match = findExactOption(next, categoryOptions);
              if (match && category !== match) onSetCategory(match);
              if (!match && category) onSetCategory('');
            }}
            onBlur={() => {
              if (!categoryInput.trim()) return;
              const match = findExactOption(categoryInput, categoryOptions);
              if (match) {
                setCategoryInput(match);
                if (category !== match) onSetCategory(match);
              } else {
                setCategoryInput('');
                if (category) onSetCategory('');
              }
            }}
            className="input disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Restaurant, Home..."
          />
          <datalist id="category-options">
            {filteredCategoryOptions.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Country</label>
          <input
            type="text"
            list="country-options"
            value={countryInput}
            disabled={sectionDisabled}
            onChange={(e) => {
              const next = e.target.value;
              setCountryInput(next);
              const match = findExactOption(next, countryOptions);
              if (match && country !== match) onSetCountry(match);
              if (!match && country) onSetCountry('');
            }}
            onBlur={() => {
              if (!countryInput.trim()) return;
              const match = findExactOption(countryInput, countryOptions);
              if (match) {
                setCountryInput(match);
                if (country !== match) onSetCountry(match);
              } else {
                setCountryInput('');
                if (country) onSetCountry('');
              }
            }}
            className="input disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="United States, Espana..."
          />
          <datalist id="country-options">
            {filteredCountryOptions.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
        </div>
      </div>
    </div>
  );
}
