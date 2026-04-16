package com.wherewewere.android.data.preferences

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "app_prefs")

@Singleton
class PreferencesRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private object Keys {
        val SERVER_URL = stringPreferencesKey("server_url")
        val API_TOKEN = stringPreferencesKey("api_token")
    }

    val preferences: Flow<AppPreferences> = context.dataStore.data.map { prefs ->
        AppPreferences(
            serverUrl = prefs[Keys.SERVER_URL] ?: "",
            apiToken = prefs[Keys.API_TOKEN] ?: "",
        )
    }

    suspend fun saveServerUrl(url: String) {
        context.dataStore.edit { it[Keys.SERVER_URL] = url.trimEnd('/') }
    }

    suspend fun saveApiToken(token: String) {
        context.dataStore.edit { it[Keys.API_TOKEN] = token }
    }

    /** Synchronous read for use in OkHttp interceptors (after first collection). */
    fun currentToken(): String = runBlocking {
        context.dataStore.data.first()[Keys.API_TOKEN] ?: ""
    }

    /** Synchronous read for use in OkHttp interceptors (after first collection). */
    fun currentServerUrl(): String = runBlocking {
        context.dataStore.data.first()[Keys.SERVER_URL] ?: ""
    }
}
