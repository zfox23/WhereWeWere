package com.wherewewere.android.ui.venuedetail

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wherewewere.android.data.model.CheckIn
import com.wherewewere.android.ui.components.MapMarker
import com.wherewewere.android.ui.components.MapView
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val dateFormatter = DateTimeFormatter.ofPattern("MMM d, yyyy")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VenueDetailScreen(
    id: String,
    onBack: () -> Unit,
    onCheckinHere: (venueId: String, venueName: String) -> Unit,
    onNavigateToCheckin: (String) -> Unit,
    viewModel: VenueDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    LaunchedEffect(id) { viewModel.load(id) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    val name = (uiState as? VenueDetailUiState.Success)?.venue?.name ?: "Venue"
                    Text(name, maxLines = 1)
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
        floatingActionButton = {
            if (uiState is VenueDetailUiState.Success) {
                val venue = (uiState as VenueDetailUiState.Success).venue
                FloatingActionButton(
                    onClick = { onCheckinHere(venue.id, venue.name) }
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Check in here")
                }
            }
        },
    ) { innerPadding ->
        when (val state = uiState) {
            is VenueDetailUiState.Loading -> {
                Box(Modifier.fillMaxSize().padding(innerPadding), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            is VenueDetailUiState.Error -> {
                Box(Modifier.fillMaxSize().padding(innerPadding), contentAlignment = Alignment.Center) {
                    Text(state.message, color = MaterialTheme.colorScheme.error)
                }
            }
            is VenueDetailUiState.Success -> {
                val venue = state.venue
                val checkins = state.checkins

                // Build markers: venue center + unique checkin locations
                val markers = remember(venue, checkins) {
                    val allCoords = checkins
                        .mapNotNull { c ->
                            if (c.venueLatitude != null && c.venueLongitude != null)
                                MapMarker(c.venueLatitude, c.venueLongitude, c.venueName ?: "")
                            else null
                        }
                        .distinctBy { "${it.lat}_${it.lng}" }
                    if (allCoords.isEmpty()) listOf(MapMarker(venue.latitude, venue.longitude, venue.name))
                    else allCoords
                }

                LazyColumn(
                    modifier = Modifier.padding(innerPadding),
                    contentPadding = PaddingValues(bottom = 80.dp),
                ) {
                    // Map header
                    item {
                        MapView(
                            center = MapMarker(venue.latitude, venue.longitude, venue.name),
                            markers = markers,
                            zoom = 15.0,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(220.dp),
                        )
                    }

                    // Venue info
                    item {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(venue.name, style = MaterialTheme.typography.titleLarge)
                            if (!venue.categoryName.isNullOrBlank()) {
                                SuggestionChip(onClick = {}, label = { Text(venue.categoryName) })
                            }
                            val addressParts = listOfNotNull(
                                venue.address, venue.city, venue.state, venue.country
                            )
                            if (addressParts.isNotEmpty()) {
                                Text(
                                    addressParts.joinToString(", "),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if ((venue.checkinCount ?: 0) > 0) {
                                Text(
                                    "${venue.checkinCount} check-in${if ((venue.checkinCount ?: 0) != 1) "s" else ""}",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                            // Child venues
                            if (!venue.childVenues.isNullOrEmpty()) {
                                Text("Locations", style = MaterialTheme.typography.titleMedium)
                                venue.childVenues.forEach { child ->
                                    Text(
                                        "• ${child.name}",
                                        style = MaterialTheme.typography.bodyMedium,
                                        modifier = Modifier.padding(start = 8.dp),
                                    )
                                }
                            }
                            HorizontalDivider()
                            Text("Check-In History", style = MaterialTheme.typography.titleMedium)
                        }
                    }

                    if (checkins.isEmpty()) {
                        item {
                            Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                                Text(
                                    "No check-ins yet.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    } else {
                        items(checkins, key = { it.id }) { checkin ->
                            CheckinHistoryRow(checkin = checkin, onClick = { onNavigateToCheckin(checkin.id) })
                            HorizontalDivider(Modifier.padding(horizontal = 16.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CheckinHistoryRow(checkin: CheckIn, onClick: () -> Unit) {
    val formattedDate = remember(checkin.checkedInAt, checkin.venueTimezone) {
        try {
            val instant = Instant.parse(checkin.checkedInAt)
            val zone = if (!checkin.venueTimezone.isNullOrBlank())
                ZoneId.of(checkin.venueTimezone) else ZoneId.systemDefault()
            instant.atZone(zone).format(dateFormatter)
        } catch (_: Exception) {
            checkin.checkedInAt.substring(0, 10)
        }
    }
    ListItem(
        headlineContent = { Text(formattedDate) },
        supportingContent = {
            if (!checkin.notes.isNullOrBlank()) {
                Text(checkin.notes, maxLines = 1)
            }
        },
        leadingContent = { Icon(Icons.Default.LocationOn, null) },
        modifier = Modifier.clickable { onClick() },
    )
}
