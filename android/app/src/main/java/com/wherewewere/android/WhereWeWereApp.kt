package com.wherewewere.android

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import androidx.work.WorkManager
import com.wherewewere.android.data.api.NetworkModule
import com.wherewewere.android.data.db.OfflineQueue
import com.wherewewere.android.data.preferences.PreferencesRepository
import com.wherewewere.android.data.sync.ConnectivityMonitor
import com.wherewewere.android.data.sync.SyncWorker
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class WhereWeWereApp : Application(), Configuration.Provider {

    @Inject
    lateinit var preferencesRepository: PreferencesRepository

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    @Inject
    lateinit var connectivityMonitor: ConnectivityMonitor

    @Inject
    lateinit var offlineQueue: OfflineQueue

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()

    override fun onCreate() {
        super.onCreate()

        // Keep the base URL holder in sync with user's saved server URL
        appScope.launch {
            preferencesRepository.preferences.collect { prefs ->
                val base = prefs.serverUrl
                NetworkModule.baseUrlHolder.set(
                    if (base.isNotBlank()) "$base/api/v1/" else "http://localhost/api/v1/"
                )
            }
        }

        // Schedule a sync whenever the device comes online and there are pending operations
        appScope.launch {
            combine(connectivityMonitor.isOnline, offlineQueue.pendingCount) { online, pending ->
                online to pending
            }.collect { (online, pending) ->
                if (online && pending > 0) {
                    SyncWorker.schedule(WorkManager.getInstance(this@WhereWeWereApp))
                }
            }
        }
    }
}
