import { SwarmImportSection } from './SwarmImportSection';
import { allClientPlugins } from '../../plugins/registry';
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
      <SleepAsAndroidImportSection />
      <YamtrackImportSection onImportComplete={onImportComplete} />
      <JobsSection refreshKey={jobRefreshKey} />
      <TimestampReconciliationSection />
      <BackupRestoreSection />
      <StartOverSection />

      {/* Data sections contributed by check-in plugins (e.g. Daylio import). */}
      {allClientPlugins().map((plugin) => {
        const Data = plugin.client.dataSettings;
        return Data ? (
          <Data
            key={plugin.id}
            jobRefreshKey={jobRefreshKey}
            onImportComplete={onImportComplete}
          />
        ) : null;
      })}
    </>
  );
}
