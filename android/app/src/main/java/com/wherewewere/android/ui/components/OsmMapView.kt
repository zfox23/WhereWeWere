package com.wherewewere.android.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import org.osmdroid.events.MapEventsReceiver
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.MapEventsOverlay
import org.osmdroid.views.overlay.Marker

data class MapMarker(
    val lat: Double,
    val lng: Double,
    val label: String = "",
)

@Composable
fun OsmMapView(
    center: MapMarker,
    modifier: Modifier = Modifier,
    zoom: Double = 15.0,
    markers: List<MapMarker> = listOf(center),
    onMarkerClick: ((MapMarker) -> Unit)? = null,
    onMapTap: ((lat: Double, lon: Double) -> Unit)? = null,
) {
    val context = LocalContext.current
    val mapView = remember { MapView(context) }

    AndroidView(
        factory = {
            mapView.apply {
                setTileSource(TileSourceFactory.MAPNIK)
                setMultiTouchControls(true)
                isHorizontalMapRepetitionEnabled = false
                isVerticalMapRepetitionEnabled = false
                controller.setZoom(zoom)
                controller.setCenter(GeoPoint(center.lat, center.lng))
            }
        },
        update = { mv ->
            mv.overlays.clear()

            // Tap-to-move support — add as the first overlay so markers still receive events
            if (onMapTap != null) {
                val eventsOverlay = MapEventsOverlay(object : MapEventsReceiver {
                    override fun singleTapConfirmedHelper(p: GeoPoint): Boolean {
                        onMapTap(p.latitude, p.longitude)
                        return true
                    }
                    override fun longPressHelper(p: GeoPoint): Boolean = false
                })
                mv.overlays.add(eventsOverlay)
            }

            markers.forEach { markerData ->
                val marker = Marker(mv).apply {
                    position = GeoPoint(markerData.lat, markerData.lng)
                    title = markerData.label
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                    if (onMarkerClick != null) {
                        setOnMarkerClickListener { _, _ ->
                            onMarkerClick(markerData)
                            true
                        }
                    }
                }
                mv.overlays.add(marker)
            }
            mv.controller.animateTo(GeoPoint(center.lat, center.lng))
            mv.invalidate()
        },
        modifier = modifier,
    )

    DisposableEffect(Unit) {
        onDispose {
            mapView.onDetach()
        }
    }
}
