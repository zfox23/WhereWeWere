package com.wherewewere.android.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.*

data class MapMarker(
    val lat: Double,
    val lng: Double,
    val label: String = "",
)

@Composable
fun MapView(
    center: MapMarker,
    modifier: Modifier = Modifier,
    zoom: Double = 15.0,
    markers: List<MapMarker> = listOf(center),
    userLocation: MapMarker? = null,
    searchRadiusMeters: Int? = null,
    onMarkerClick: ((MapMarker) -> Unit)? = null,
    onMapTap: ((lat: Double, lon: Double) -> Unit)? = null,
) {
    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(LatLng(center.lat, center.lng), zoom.toFloat())
    }

    // Animate the camera whenever the center changes (e.g. user taps to move search area)
    LaunchedEffect(center) {
        cameraPositionState.animate(
            CameraUpdateFactory.newLatLng(LatLng(center.lat, center.lng))
        )
    }

    Box(modifier = modifier) {
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = cameraPositionState,
            uiSettings = MapUiSettings(
                zoomControlsEnabled = true,
                myLocationButtonEnabled = false,
                compassEnabled = false,
                mapToolbarEnabled = false,
            ),
            onMapClick = { latLng -> onMapTap?.invoke(latLng.latitude, latLng.longitude) },
        ) {
            // Search radius circle — native Circle composable, no polygon approximation needed
            if (searchRadiusMeters != null) {
                Circle(
                    center = LatLng(center.lat, center.lng),
                    radius = searchRadiusMeters.toDouble(),
                    fillColor = Color(0x1E2196F3),
                    strokeColor = Color(0xA02196F3.toInt()),
                    strokeWidth = 3f,
                )
            }

            // Venue / general markers
            markers.forEach { m ->
                Marker(
                    state = MarkerState(LatLng(m.lat, m.lng)),
                    title = m.label,
                    onClick = {
                        onMarkerClick?.invoke(m)
                        false
                    },
                )
            }

            // User location — distinct blue pin
            if (userLocation != null) {
                Marker(
                    state = MarkerState(LatLng(userLocation.lat, userLocation.lng)),
                    title = userLocation.label,
                    icon = BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_AZURE),
                )
            }
        }
    }
}
