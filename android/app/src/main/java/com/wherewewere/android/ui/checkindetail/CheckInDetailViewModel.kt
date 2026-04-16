package com.wherewewere.android.ui.checkindetail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.wherewewere.android.data.model.CheckIn
import com.wherewewere.android.data.repository.CheckInRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface CheckInDetailUiState {
    object Loading : CheckInDetailUiState
    data class Success(val checkin: CheckIn) : CheckInDetailUiState
    data class Error(val message: String) : CheckInDetailUiState
    object Deleted : CheckInDetailUiState
}

@HiltViewModel
class CheckInDetailViewModel @Inject constructor(
    private val repo: CheckInRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<CheckInDetailUiState>(CheckInDetailUiState.Loading)
    val uiState: StateFlow<CheckInDetailUiState> = _uiState.asStateFlow()

    private val _showDeleteDialog = MutableStateFlow(false)
    val showDeleteDialog: StateFlow<Boolean> = _showDeleteDialog.asStateFlow()

    fun load(id: String) {
        viewModelScope.launch {
            _uiState.value = CheckInDetailUiState.Loading
            repo.getCheckin(id)
                .onSuccess { _uiState.value = CheckInDetailUiState.Success(it) }
                .onFailure { _uiState.value = CheckInDetailUiState.Error(it.message ?: "Load failed") }
        }
    }

    fun showDeleteDialog() { _showDeleteDialog.value = true }
    fun dismissDeleteDialog() { _showDeleteDialog.value = false }

    fun delete(id: String) {
        viewModelScope.launch {
            repo.deleteCheckin(id)
                .onSuccess { _uiState.value = CheckInDetailUiState.Deleted }
                .onFailure { _uiState.value = CheckInDetailUiState.Error(it.message ?: "Delete failed") }
        }
        _showDeleteDialog.value = false
    }
}
