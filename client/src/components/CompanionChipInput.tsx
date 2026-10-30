import { companions } from '../api/client';
import ChipInput from './ChipInput';
import { CompanionPhoto } from './CompanionName';

interface CompanionChipInputProps {
  /** Currently selected companion names. */
  value: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}

const loadCompanionNames = (q: string) => companions.names(q || undefined, 50);
const companionPhoto = (name: string) => <CompanionPhoto name={name} size={14} />;

/**
 * "Here With…" chip input, shared by every check-in type that implements
 * companions. Autocompletes from previously-entered companion names (via the
 * core's /companions/names endpoint — the name pool is shared across all
 * companion-aware check-in types).
 */
export default function CompanionChipInput({ value, onChange, disabled = false }: CompanionChipInputProps) {
  return (
    <ChipInput
      value={value}
      onChange={onChange}
      disabled={disabled}
      loadSuggestions={loadCompanionNames}
      renderIcon={companionPhoto}
      placeholder="Who were you with?"
      ariaLabel="Here with (companion names)"
    />
  );
}
