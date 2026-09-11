import { SwarmImportSection } from './SwarmImportSection';
import { DaylioImportSection } from './DaylioImportSection';
import { YamtrackImportSection } from './YamtrackImportSection';
import { SleepAsAndroidImportSection } from './SleepAsAndroidImportSection';
import { JobsSection } from './JobsSection';
import { TimestampReconciliationSection } from './TimestampReconciliationSection';
import { BackupRestoreSection } from './BackupRestoreSection';
import { StartOverSection } from './StartOverSection';

interface DataTabProps {
  jobRefreshKey: number;
  onImportComplete: () => void;
}

export function DataTab({ jobRefreshKey, onImportComplete }: DataTabProps) {
  return (
    <>
      <SwarmImportSection onImportComplete={onImportComplete} />
      <DaylioImportSection />
      <SleepAsAndroidImportSection />
      <YamtrackImportSection onImportComplete={onImportComplete} />
      <JobsSection refreshKey={jobRefreshKey} />
      <TimestampReconciliationSection />
      <BackupRestoreSection />
      <StartOverSection />
    </>
  );
}
