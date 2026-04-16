package com.wherewewere.android.ui.sleep

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.wherewewere.android.data.repository.SleepRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject

sealed interface SleepUiState {
    object Idle : SleepUiState
    object Loading : SleepUiState
    object Submitting : SleepUiState
    object Success : SleepUiState
    data class Error(val message: String) : SleepUiState
}

@HiltViewModel
class SleepEntryViewModel @Inject constructor(
    private val repo: SleepRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<SleepUiState>(SleepUiState.Idle)
    val uiState: StateFlow<SleepUiState> = _uiState.asStateFlow()

    // Default: started yesterday 10pm, ended today 6am
    private val defaultStart = LocalDateTime.of(LocalDate.now().minusDays(1), LocalTime.of(22, 0))
    private val defaultEnd = LocalDateTime.of(LocalDate.now(), LocalTime.of(6, 0))

    private val _startedAt = MutableStateFlow(defaultStart)
    val startedAt: StateFlow<LocalDateTime> = _startedAt.asStateFlow()

    private val _endedAt = MutableStateFlow(defaultEnd)
    val endedAt: StateFlow<LocalDateTime> = _endedAt.asStateFlow()

    private val _rating = MutableStateFlow(0)
    val rating: StateFlow<Int> = _rating.asStateFlow()

    private val _comment = MutableStateFlow("")
    val comment: StateFlow<String> = _comment.asStateFlow()

    private var editId: String? = null

    val durationLabel: String
        get() {
            val duration = Duration.between(_startedAt.value, _endedAt.value)
            if (duration.isNegative) return "—"
            val hours = duration.toHours()
            val minutes = duration.toMinutesPart()
            return if (hours > 0) "${hours}h ${minutes}m" else "${minutes}m"
        }

    fun init(editSleepId: String?) {
        if (editSleepId == null) return
        viewModelScope.launch {
            _uiState.value = SleepUiState.Loading
            editId = editSleepId
            repo.getSleepEntry(editSleepId)
                .onSuccess { entry ->
                    val zone = ZoneId.of(entry.sleepTimezone)
                    _startedAt.value = ZonedDateTime.parse(entry.startedAt).withZoneSameInstant(zone).toLocalDateTime()
                    _endedAt.value = ZonedDateTime.parse(entry.endedAt).withZoneSameInstant(zone).toLocalDateTime()
                    _rating.value = entry.rating.toInt()
                    _comment.value = entry.comment ?: ""
                    _uiState.value = SleepUiState.Idle
                }
                .onFailure {
                    _uiState.value = SleepUiState.Error(it.message ?: "Load failed")
                }
        }
    }

    fun setStartedAt(dt: LocalDateTime) { _startedAt.value = dt }
    fun setEndedAt(dt: LocalDateTime) { _endedAt.value = dt }
    fun setRating(r: Int) { _rating.value = r }
    fun setComment(c: String) { _comment.value = c }

    fun submit() {
        viewModelScope.launch {
            _uiState.value = SleepUiState.Submitting
            val zone = ZoneId.systemDefault()
            val fmt = DateTimeFormatter.ISO_OFFSET_DATE_TIME
            val startZ = ZonedDateTime.of(_startedAt.value, zone)
            val endZ = ZonedDateTime.of(_endedAt.value, zone)

            val result = if (editId != null) {
                repo.updateSleepEntry(
                    id = editId!!,
                    startedAt = startZ.format(fmt),
                    endedAt = endZ.format(fmt),
                    rating = _rating.value.toDouble(),
                    comment = _comment.value.ifBlank { null },
                )
            } else {
                repo.createSleepEntry(
                    startedAt = startZ.format(fmt),
                    endedAt = endZ.format(fmt),
                    rating = _rating.value.toDouble(),
                    comment = _comment.value.ifBlank { null },
                    sleepTimezone = zone.id,
                )
            }

            result
                .onSuccess { _uiState.value = SleepUiState.Success }
                .onFailure { _uiState.value = SleepUiState.Error(it.message ?: "Submit failed") }
        }
    }

    fun delete() {
        val id = editId ?: return
        viewModelScope.launch {
            _uiState.value = SleepUiState.Submitting
            repo.deleteSleepEntry(id)
                .onSuccess { _uiState.value = SleepUiState.Success }
                .onFailure { _uiState.value = SleepUiState.Error(it.message ?: "Delete failed") }
        }
    }

    fun clearError() {
        if (_uiState.value is SleepUiState.Error) _uiState.value = SleepUiState.Idle
    }
}
