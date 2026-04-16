package com.wherewewere.android.ui.venuedetail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.wherewewere.android.data.model.CheckIn
import com.wherewewere.android.data.model.Venue
import com.wherewewere.android.data.repository.CheckInRepository
import com.wherewewere.android.data.repository.VenueRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface VenueDetailUiState {
    object Loading : VenueDetailUiState
    data class Success(val venue: Venue, val checkins: List<CheckIn>) : VenueDetailUiState
    data class Error(val message: String) : VenueDetailUiState
}

@HiltViewModel
class VenueDetailViewModel @Inject constructor(
    private val venueRepo: VenueRepository,
    private val checkInRepo: CheckInRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow<VenueDetailUiState>(VenueDetailUiState.Loading)
    val uiState: StateFlow<VenueDetailUiState> = _uiState.asStateFlow()

    fun load(id: String) {
        viewModelScope.launch {
            _uiState.value = VenueDetailUiState.Loading
            val venueResult = venueRepo.getVenue(id)
            venueResult.onFailure {
                _uiState.value = VenueDetailUiState.Error(it.message ?: "Load failed")
                return@launch
            }
            val venue = venueResult.getOrThrow()
            val checkins = checkInRepo.getCheckins(venueId = id, limit = 50).getOrElse { emptyList() }
            _uiState.value = VenueDetailUiState.Success(venue, checkins)
        }
    }
}
