package com.wherewewere.android.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.wherewewere.android.data.api.NetworkModule
import com.wherewewere.android.data.api.WhereWeWereService
import com.wherewewere.android.data.preferences.AppPreferences
import com.wherewewere.android.data.preferences.PreferencesRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface SettingsUiState {
    object Idle : SettingsUiState
    object Testing : SettingsUiState
    data class TestSuccess(val username: String) : SettingsUiState
    data class TestError(val message: String) : SettingsUiState
    object Saved : SettingsUiState
}

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val prefsRepo: PreferencesRepository,
    private val service: WhereWeWereService,
) : ViewModel() {

    val prefs: StateFlow<AppPreferences> = prefsRepo.preferences
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AppPreferences())

    private val _uiState = MutableStateFlow<SettingsUiState>(SettingsUiState.Idle)
    val uiState: StateFlow<SettingsUiState> = _uiState

    fun save(serverUrl: String, apiToken: String) {
        viewModelScope.launch {
            prefsRepo.saveServerUrl(serverUrl)
            prefsRepo.saveApiToken(apiToken)
            // Update the OkHttp base URL holder immediately
            val base = serverUrl.trimEnd('/')
            NetworkModule.baseUrlHolder.set(
                if (base.isNotBlank()) "$base/api/v1/" else "http://localhost/api/v1/"
            )
            _uiState.value = SettingsUiState.Saved
        }
    }

    fun testConnection(serverUrl: String, apiToken: String) {
        viewModelScope.launch {
            _uiState.value = SettingsUiState.Testing
            // Temporarily apply settings for the test call
            val base = serverUrl.trimEnd('/')
            NetworkModule.baseUrlHolder.set(
                if (base.isNotBlank()) "$base/api/v1/" else "http://localhost/api/v1/"
            )
            prefsRepo.saveApiToken(apiToken)

            runCatching { service.getSettings() }
                .onSuccess { settings ->
                    _uiState.value = SettingsUiState.TestSuccess(settings.username)
                }
                .onFailure { error ->
                    _uiState.value = SettingsUiState.TestError(error.message ?: "Connection failed")
                }
        }
    }

    fun clearState() {
        _uiState.value = SettingsUiState.Idle
    }
}
