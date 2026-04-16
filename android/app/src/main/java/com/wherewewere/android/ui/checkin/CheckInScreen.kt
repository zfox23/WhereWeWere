package com.wherewewere.android.ui.checkin

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wherewewere.android.data.model.NearbyVenue
import com.wherewewere.android.ui.components.MapMarker
import com.wherewewere.android.ui.components.MapView

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CheckInScreen(
    editId: String?,
    prefillVenueId: String?,
    prefillVenueName: String?,
    onBack: () -> Unit,
    viewModel: CheckInViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val nearbyVenues by viewModel.nearbyVenues.collectAsStateWithLifecycle()
    val isLoadingVenues by viewModel.isLoadingVenues.collectAsStateWithLifecycle()
    val selectedVenue by viewModel.selectedVenue.collectAsStateWithLifecycle()
    val venueSearchQuery by viewModel.venueSearchQuery.collectAsStateWithLifecycle()
    val notes by viewModel.notes.collectAsStateWithLifecycle()
    val userLocation by viewModel.userLocation.collectAsStateWithLifecycle()
    val searchCenter by viewModel.searchCenter.collectAsStateWithLifecycle()
    val venueLoadError by viewModel.venueLoadError.collectAsStateWithLifecycle()

    val snackbarHostState = remember { SnackbarHostState() }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        if (grants[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            grants[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        ) {
            viewModel.requestLocation()
        }
    }

    LaunchedEffect(editId, prefillVenueId, prefillVenueName) {
        viewModel.init(editId, prefillVenueId, prefillVenueName)
        permissionLauncher.launch(
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            )
        )
    }

    LaunchedEffect(uiState) {
        when (val state = uiState) {
            is CheckInUiState.Success -> onBack()
            is CheckInUiState.Error -> {
                snackbarHostState.showSnackbar(state.message)
                viewModel.clearError()
            }
            else -> {}
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (editId != null) "Edit Check-In" else "Check In") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    TextButton(
                        onClick = viewModel::submit,
                        enabled = selectedVenue != null && uiState !is CheckInUiState.Submitting,
                    ) {
                        if (uiState is CheckInUiState.Submitting) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        } else {
                            Text("Save")
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .padding(innerPadding)
                .fillMaxSize(),
        ) {
            if (selectedVenue == null) {
                // ── Venue selection phase ─────────────────────────────────
                OutlinedTextField(
                    value = venueSearchQuery,
                    onValueChange = viewModel::setVenueSearchQuery,
                    placeholder = { Text("Search for a place…") },
                    leadingIcon = { Icon(Icons.Default.LocationOn, null) },
                    trailingIcon = {
                        Row {
                            if (venueSearchQuery.isNotBlank()) {
                                IconButton(onClick = { viewModel.setVenueSearchQuery("") }) {
                                    Icon(Icons.Default.Close, contentDescription = "Clear")
                                }
                            }
                            IconButton(onClick = {
                                permissionLauncher.launch(
                                    arrayOf(
                                        Manifest.permission.ACCESS_FINE_LOCATION,
                                        Manifest.permission.ACCESS_COARSE_LOCATION,
                                    )
                                )
                                viewModel.goToMyLocation()
                            }) {
                                Icon(Icons.Default.MyLocation, contentDescription = "Use GPS")
                            }
                        }
                    },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                )

                // ── Search-center map ──────────────────────────────────────
                if (searchCenter != null) {
                    MapView(
                        center = MapMarker(searchCenter!!.latitude, searchCenter!!.longitude, "Search area"),
                        zoom = 14.0,
                        markers = nearbyVenues
                            .filter { it.latitude != 0.0 && it.longitude != 0.0 }
                            .map { MapMarker(it.latitude, it.longitude, it.name) },
                        userLocation = userLocation?.let {
                            MapMarker(it.latitude, it.longitude, "My location")
                        },
                        searchRadiusMeters = 5000,
                        onMapTap = { lat, lon -> viewModel.setSearchCenter(lat, lon) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(220.dp),
                    )
                }

                if (isLoadingVenues) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }

                LazyColumn {
                    items(nearbyVenues, key = { "${it.source}_${it.osmId}_${it.id}" }) { venue ->
                        VenueRow(venue = venue, onClick = { viewModel.selectVenue(venue) })
                        HorizontalDivider(Modifier.padding(horizontal = 16.dp))
                    }
                    if (nearbyVenues.isEmpty() && !isLoadingVenues) {
                        item {
                            Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                                Text(
                                    text = when {
                                        venueLoadError != null -> "Could not load venues: $venueLoadError"
                                        userLocation != null -> "No venues found nearby. Try searching by name or tap the map to move the search area."
                                        else -> "Tap the location icon to find nearby places, or search by name."
                                    },
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            } else {
                // ── Form phase ────────────────────────────────────────────
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState()),
                ) {
                    // Selected venue header
                    ListItem(
                        headlineContent = {
                            Text(
                                selectedVenue!!.name,
                                style = MaterialTheme.typography.titleMedium,
                            )
                        },
                        supportingContent = {
                            Text(selectedVenue!!.displayCategory, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        },
                        trailingContent = {
                            IconButton(onClick = viewModel::clearVenue) {
                                Icon(Icons.Default.Close, contentDescription = "Change venue")
                            }
                        },
                    )

                    // Map preview if coordinates available
                    val sv = selectedVenue!!
                    if (sv.latitude != 0.0 && sv.longitude != 0.0) {
                        MapView(
                            center = MapMarker(sv.latitude, sv.longitude, sv.name),
                            zoom = 16.0,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(180.dp),
                        )
                    }

                    Spacer(Modifier.height(12.dp))

                    OutlinedTextField(
                        value = notes,
                        onValueChange = viewModel::setNotes,
                        label = { Text("Notes (optional)") },
                        minLines = 3,
                        maxLines = 8,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp),
                    )

                    Spacer(Modifier.height(32.dp))
                }
            }
        }
    }
}

@Composable
private fun VenueRow(venue: NearbyVenue, onClick: () -> Unit) {
    ListItem(
        headlineContent = {
            Text(venue.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
        supportingContent = {
            val sub = listOfNotNull(
                venue.displayCategory.ifBlank { null },
                venue.address?.ifBlank { null },
                if (venue.distance != null) "%.0fm".format(venue.distance) else null,
            ).joinToString(" · ")
            if (sub.isNotBlank()) Text(sub, maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
        leadingContent = {
            Icon(
                Icons.Default.LocationOn,
                contentDescription = null,
                tint = if (venue.source == "local") MaterialTheme.colorScheme.primary
                       else MaterialTheme.colorScheme.secondary,
            )
        },
        modifier = Modifier.clickable { onClick() },
    )
}
