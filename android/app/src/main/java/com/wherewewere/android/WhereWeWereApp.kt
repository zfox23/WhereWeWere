package com.wherewewere.android

import android.app.Application
import com.wherewewere.android.data.api.NetworkModule
import com.wherewewere.android.data.preferences.PreferencesRepository
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class WhereWeWereApp : Application() {

    @Inject
    lateinit var preferencesRepository: PreferencesRepository

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

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
    }
}
