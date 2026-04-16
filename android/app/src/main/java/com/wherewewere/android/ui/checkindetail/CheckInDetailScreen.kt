package com.wherewewere.android.ui.checkindetail

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.wherewewere.android.ui.components.MapMarker
import com.wherewewere.android.ui.components.OsmMapView
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val displayFormatter = DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy 'at' h:mm a")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CheckInDetailScreen(
    id: String,
    onBack: () -> Unit,
    onNavigateToVenue: (String) -> Unit,
    onEdit: (String) -> Unit,
    viewModel: CheckInDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val showDeleteDialog by viewModel.showDeleteDialog.collectAsStateWithLifecycle()

    LaunchedEffect(id) { viewModel.load(id) }

    LaunchedEffect(uiState) {
        if (uiState is CheckInDetailUiState.Deleted) onBack()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    val name = (uiState as? CheckInDetailUiState.Success)?.checkin?.venueName ?: "Check-In"
                    Text(name, maxLines = 1)
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (uiState is CheckInDetailUiState.Success) {
                        IconButton(onClick = { onEdit(id) }) {
                            Icon(Icons.Default.Edit, contentDescription = "Edit")
                        }
                        IconButton(onClick = viewModel::showDeleteDialog) {
                            Icon(Icons.Default.Delete, contentDescription = "Delete")
                        }
                    }
                },
            )
        },
    ) { innerPadding ->
        when (val state = uiState) {
            is CheckInDetailUiState.Loading -> {
                Box(Modifier.fillMaxSize().padding(innerPadding), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            is CheckInDetailUiState.Error -> {
                Box(Modifier.fillMaxSize().padding(innerPadding), contentAlignment = Alignment.Center) {
                    Text(state.message, color = MaterialTheme.colorScheme.error)
                }
            }
            is CheckInDetailUiState.Success -> {
                val checkin = state.checkin
                Column(
                    modifier = Modifier
                        .padding(innerPadding)
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState()),
                ) {
                    // Map
                    if (checkin.venueLatitude != null && checkin.venueLongitude != null) {
                        OsmMapView(
                            center = MapMarker(checkin.venueLatitude, checkin.venueLongitude, checkin.venueName ?: ""),
                            zoom = 16.0,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(220.dp),
                        )
                    }

                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        // Venue name + category
                        Text(checkin.venueName ?: "Unknown venue", style = MaterialTheme.typography.titleLarge)
                        if (!checkin.venueCategory.isNullOrBlank()) {
                            SuggestionChip(
                                onClick = {},
                                label = { Text(checkin.venueCategory) },
                            )
                        }

                        // Parent venue
                        if (checkin.parentVenueName != null && checkin.parentVenueId != null) {
                            TextButton(onClick = { onNavigateToVenue(checkin.parentVenueId) }) {
                                Text("Part of ${checkin.parentVenueName}")
                            }
                        }

                        // Address
                        val addressParts = listOfNotNull(
                            checkin.venueAddress,
                            checkin.venueCity,
                            checkin.venueState,
                            checkin.venueCountry,
                        )
                        if (addressParts.isNotEmpty()) {
                            Text(
                                addressParts.joinToString(", "),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }

                        HorizontalDivider()

                        // Timestamp
                        val formattedTime = remember(checkin.checkedInAt, checkin.venueTimezone) {
                            try {
                                val instant = Instant.parse(checkin.checkedInAt)
                                val zone = if (!checkin.venueTimezone.isNullOrBlank())
                                    ZoneId.of(checkin.venueTimezone) else ZoneId.systemDefault()
                                instant.atZone(zone).format(displayFormatter)
                            } catch (_: Exception) {
                                checkin.checkedInAt
                            }
                        }
                        Text(formattedTime, style = MaterialTheme.typography.bodyMedium)

                        // Notes
                        if (!checkin.notes.isNullOrBlank()) {
                            HorizontalDivider()
                            Text(checkin.notes, style = MaterialTheme.typography.bodyLarge)
                        }

                        // Navigate to venue button
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = { onNavigateToVenue(checkin.venueId) },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("View Venue")
                        }
                    }
                }
            }
            else -> {}
        }
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = viewModel::dismissDeleteDialog,
            title = { Text("Delete Check-In") },
            text = { Text("Are you sure you want to delete this check-in?") },
            confirmButton = {
                TextButton(onClick = { viewModel.delete(id) }) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = viewModel::dismissDeleteDialog) { Text("Cancel") }
            },
        )
    }
}
