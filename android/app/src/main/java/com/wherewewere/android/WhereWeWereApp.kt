package com.wherewewere.android

import android.app.Application
import android.preference.PreferenceManager
import com.wherewewere.android.data.api.NetworkModule
import com.wherewewere.android.data.preferences.PreferencesRepository
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.osmdroid.config.Configuration
import java.io.File
import javax.inject.Inject

@HiltAndroidApp
class WhereWeWereApp : Application() {

    @Inject
    lateinit var preferencesRepository: PreferencesRepository

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()

        // Configure OSMDroid tile cache (no external storage permission needed on API 26+)
        Configuration.getInstance().apply {
            load(this@WhereWeWereApp, PreferenceManager.getDefaultSharedPreferences(this@WhereWeWereApp))
            userAgentValue = "WhereWeWere-Android/1.0"
            osmdroidBasePath = File(cacheDir, "osmdroid")
            osmdroidTileCache = File(cacheDir, "osmdroid/tiles")
        }

        // Keep the base URL holder in sync with user's saved server URL
        appScope.launch {
            preferencesRepository.preferences.collect { prefs ->
                val base = prefs.serverUrl
                NetworkModule.baseUrlHolder.set(
                    if (base.isNotBlank()) "$base/api/v1/" else "http://localhost/api/v1/"
                )
            }
        }
    }
}
