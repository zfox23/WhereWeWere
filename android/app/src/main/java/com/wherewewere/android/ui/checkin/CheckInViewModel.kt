package com.wherewewere.android.ui.checkin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.wherewewere.android.data.model.NearbyVenue
import com.wherewewere.android.data.repository.CheckInRepository
import com.wherewewere.android.data.repository.VenueRepository
import com.wherewewere.android.location.LatLng
import com.wherewewere.android.location.LocationManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject

sealed interface CheckInUiState {
    object Idle : CheckInUiState
    object Loading : CheckInUiState
    object Submitting : CheckInUiState
    object Success : CheckInUiState
    data class Error(val message: String) : CheckInUiState
}

@OptIn(FlowPreview::class)
@HiltViewModel
class CheckInViewModel @Inject constructor(
    private val checkInRepo: CheckInRepository,
    private val venueRepo: VenueRepository,
    private val locationManager: LocationManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow<CheckInUiState>(CheckInUiState.Idle)
    val uiState: StateFlow<CheckInUiState> = _uiState.asStateFlow()

    private val _nearbyVenues = MutableStateFlow<List<NearbyVenue>>(emptyList())
    val nearbyVenues: StateFlow<List<NearbyVenue>> = _nearbyVenues.asStateFlow()

    private val _isLoadingVenues = MutableStateFlow(false)
    val isLoadingVenues: StateFlow<Boolean> = _isLoadingVenues.asStateFlow()

    private val _selectedVenue = MutableStateFlow<NearbyVenue?>(null)
    val selectedVenue: StateFlow<NearbyVenue?> = _selectedVenue.asStateFlow()

    private val _venueSearchQuery = MutableStateFlow("")
    val venueSearchQuery: StateFlow<String> = _venueSearchQuery.asStateFlow()

    private val _notes = MutableStateFlow("")
    val notes: StateFlow<String> = _notes.asStateFlow()

    private val _checkedInAt = MutableStateFlow(ZonedDateTime.now())
    val checkedInAt: StateFlow<ZonedDateTime> = _checkedInAt.asStateFlow()

    private val _userLocation = MutableStateFlow<LatLng?>(null)
    val userLocation: StateFlow<LatLng?> = _userLocation.asStateFlow()

    private val _searchCenter = MutableStateFlow<LatLng?>(null)
    val searchCenter: StateFlow<LatLng?> = _searchCenter.asStateFlow()

    private val _venueLoadError = MutableStateFlow<String?>(null)
    val venueLoadError: StateFlow<String?> = _venueLoadError.asStateFlow()

    private val _editCheckinId = MutableStateFlow<String?>(null)

    init {
        // Debounce venue search
        viewModelScope.launch {
            _venueSearchQuery
                .debounce(400)
                .drop(1)
                .collect { query ->
                    if (query.isBlank()) {
                        loadNearbyVenues()
                    } else {
                        searchVenues(query)
                    }
                }
        }
    }

    fun init(editId: String?, prefillVenueId: String?, prefillVenueName: String?) {
        viewModelScope.launch {
            if (editId != null) {
                _uiState.value = CheckInUiState.Loading
                _editCheckinId.value = editId
                checkInRepo.getCheckin(editId)
                    .onSuccess { checkin ->
                        _notes.value = checkin.notes ?: ""
                        // Pre-select the venue as a NearbyVenue-like stub
                        if (checkin.venueLatitude != null && checkin.venueLongitude != null) {
                            _selectedVenue.value = NearbyVenue(
                                name = checkin.venueName ?: "Unknown",
                                category = checkin.venueCategory ?: "",
                                latitude = checkin.venueLatitude,
                                longitude = checkin.venueLongitude,
                                osmId = "",
                                source = "local",
                                id = checkin.venueId,
                            )
                        }
                        _uiState.value = CheckInUiState.Idle
                    }
                    .onFailure { _uiState.value = CheckInUiState.Error(it.message ?: "Load failed") }
            } else if (prefillVenueId != null && prefillVenueName != null) {
                _selectedVenue.value = NearbyVenue(
                    name = prefillVenueName,
                    category = "",
                    latitude = 0.0,
                    longitude = 0.0,
                    osmId = "",
                    source = "local",
                    id = prefillVenueId,
                )
            }
        }
    }

    fun requestLocation() {
        viewModelScope.launch {
            val last = locationManager.getLastLocation()
            if (last != null) {
                _userLocation.value = last
                if (_searchCenter.value == null) _searchCenter.value = last
                loadNearbyVenues(last.latitude, last.longitude)
            }
            val current = locationManager.getCurrentLocation()
            if (current != null && current != last) {
                _userLocation.value = current
                if (_searchCenter.value == null) _searchCenter.value = current
                loadNearbyVenues(current.latitude, current.longitude)
            }
        }
    }

    fun setSearchCenter(lat: Double, lon: Double) {
        val center = LatLng(lat, lon)
        _searchCenter.value = center
        loadNearbyVenues(lat, lon)
    }

    fun resetSearchCenter() {
        val loc = _userLocation.value ?: return
        _searchCenter.value = loc
        loadNearbyVenues(loc.latitude, loc.longitude)
    }

    private fun loadNearbyVenues(lat: Double? = null, lon: Double? = null) {
        val center = _searchCenter.value ?: _userLocation.value
        val useLat = lat ?: center?.latitude ?: return
        val useLon = lon ?: center?.longitude ?: return

        viewModelScope.launch {
            _isLoadingVenues.value = true
            _venueLoadError.value = null
            venueRepo.getNearbyVenues(useLat, useLon)
                .onSuccess { _nearbyVenues.value = it }
                .onFailure { _venueLoadError.value = it.message ?: "Failed to load nearby venues" }
            _isLoadingVenues.value = false
        }
    }

    private fun searchVenues(query: String) {
        val loc = _userLocation.value
        viewModelScope.launch {
            _isLoadingVenues.value = true
            if (loc != null) {
                venueRepo.getNearbyVenues(loc.latitude, loc.longitude, query = query)
                    .onSuccess { _nearbyVenues.value = it }
                    .onFailure {
                        // Fall back to place search
                        venueRepo.searchPlaces(query)
                            .onSuccess { _nearbyVenues.value = it }
                    }
            } else {
                venueRepo.searchPlaces(query)
                    .onSuccess { _nearbyVenues.value = it }
            }
            _isLoadingVenues.value = false
        }
    }

    fun selectVenue(venue: NearbyVenue) {
        _selectedVenue.value = venue
    }

    fun clearVenue() {
        _selectedVenue.value = null
    }

    fun setNotes(notes: String) {
        _notes.value = notes
    }

    fun setCheckedInAt(dt: ZonedDateTime) {
        _checkedInAt.value = dt
    }

    fun setVenueSearchQuery(q: String) {
        _venueSearchQuery.value = q
    }

    fun submit() {
        val venue = _selectedVenue.value ?: run {
            _uiState.value = CheckInUiState.Error("Please select a venue")
            return
        }
        viewModelScope.launch {
            _uiState.value = CheckInUiState.Submitting

            // If OSM source venue, import it first to get a local ID
            val venueId: String = if (venue.source == "osm" && venue.id == null) {
                venueRepo.importOsmVenue(venue)
                    .getOrElse {
                        _uiState.value = CheckInUiState.Error(it.message ?: "Venue import failed")
                        return@launch
                    }.id
            } else {
                venue.id ?: run {
                    _uiState.value = CheckInUiState.Error("Invalid venue")
                    return@launch
                }
            }

            val timestamp = _checkedInAt.value.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            val editId = _editCheckinId.value

            if (editId != null) {
                checkInRepo.updateCheckin(editId, _notes.value.ifBlank { null }, timestamp)
            } else {
                checkInRepo.createCheckin(venueId, _notes.value.ifBlank { null }, timestamp)
            }.onSuccess {
                _uiState.value = CheckInUiState.Success
            }.onFailure {
                _uiState.value = CheckInUiState.Error(it.message ?: "Submit failed")
            }
        }
    }

    fun clearError() {
        if (_uiState.value is CheckInUiState.Error) {
            _uiState.value = CheckInUiState.Idle
        }
    }
}
