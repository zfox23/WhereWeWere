package com.wherewewere.android.ui.mood

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.wherewewere.android.data.model.MoodActivityGroup
import com.wherewewere.android.data.repository.MoodRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject

sealed interface MoodUiState {
    object Idle : MoodUiState
    object Loading : MoodUiState
    object Submitting : MoodUiState
    object Success : MoodUiState
    data class Error(val message: String) : MoodUiState
}

@HiltViewModel
class MoodCheckInViewModel @Inject constructor(
    private val repo: MoodRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<MoodUiState>(MoodUiState.Idle)
    val uiState: StateFlow<MoodUiState> = _uiState.asStateFlow()

    private val _activityGroups = MutableStateFlow<List<MoodActivityGroup>>(emptyList())
    val activityGroups: StateFlow<List<MoodActivityGroup>> = _activityGroups.asStateFlow()

    private val _mood = MutableStateFlow(3)
    val mood: StateFlow<Int> = _mood.asStateFlow()

    private val _note = MutableStateFlow("")
    val note: StateFlow<String> = _note.asStateFlow()

    private val _selectedActivityIds = MutableStateFlow<Set<String>>(emptySet())
    val selectedActivityIds: StateFlow<Set<String>> = _selectedActivityIds.asStateFlow()

    private val _checkedInAt = MutableStateFlow(ZonedDateTime.now())
    val checkedInAt: StateFlow<ZonedDateTime> = _checkedInAt.asStateFlow()

    private var editId: String? = null

    fun init(editMoodId: String?) {
        viewModelScope.launch {
            _uiState.value = MoodUiState.Loading
            // Load activity groups
            repo.getMoodActivityGroups()
                .onSuccess { _activityGroups.value = it }

            if (editMoodId != null) {
                editId = editMoodId
                repo.getMoodCheckin(editMoodId)
                    .onSuccess { existing ->
                        _mood.value = existing.mood
                        _note.value = existing.note ?: ""
                        _selectedActivityIds.value = existing.activities.map { it.id }.toSet()
                    }
            }
            _uiState.value = MoodUiState.Idle
        }
    }

    fun setMood(mood: Int) { _mood.value = mood }
    fun setNote(note: String) { _note.value = note }

    fun toggleActivity(id: String) {
        _selectedActivityIds.value = _selectedActivityIds.value.let {
            if (it.contains(id)) it - id else it + id
        }
    }

    fun setCheckedInAt(dt: ZonedDateTime) { _checkedInAt.value = dt }

    fun submit() {
        viewModelScope.launch {
            _uiState.value = MoodUiState.Submitting
            val timestamp = _checkedInAt.value.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            val timezone = ZoneId.systemDefault().id

            val result = if (editId != null) {
                repo.updateMoodCheckin(
                    id = editId!!,
                    mood = _mood.value,
                    note = _note.value.ifBlank { null },
                    checkedInAt = timestamp,
                    moodTimezone = timezone,
                    activityIds = _selectedActivityIds.value.toList(),
                )
            } else {
                repo.createMoodCheckin(
                    mood = _mood.value,
                    note = _note.value.ifBlank { null },
                    checkedInAt = timestamp,
                    moodTimezone = timezone,
                    activityIds = _selectedActivityIds.value.toList(),
                )
            }

            result
                .onSuccess { _uiState.value = MoodUiState.Success }
                .onFailure { _uiState.value = MoodUiState.Error(it.message ?: "Submit failed") }
        }
    }

    fun delete() {
        val id = editId ?: return
        viewModelScope.launch {
            _uiState.value = MoodUiState.Submitting
            repo.deleteMoodCheckin(id)
                .onSuccess { _uiState.value = MoodUiState.Success }
                .onFailure { _uiState.value = MoodUiState.Error(it.message ?: "Delete failed") }
        }
    }

    fun clearError() {
        if (_uiState.value is MoodUiState.Error) _uiState.value = MoodUiState.Idle
    }
}
