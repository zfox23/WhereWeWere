package com.wherewewere.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Mood
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.wherewewere.android.data.model.TimelineItem
import com.wherewewere.android.ui.theme.moodColor
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val timeFormatter = DateTimeFormatter.ofPattern("h:mm a")

private fun TimelineItem.formattedTime(): String {
    val tz = when (type) {
        "location" -> venueTimezone
        "mood" -> moodTimezone
        "sleep" -> sleepTimezone
        else -> null
    }
    return try {
        val instant = Instant.parse(checkedInAt)
        val zone = if (!tz.isNullOrBlank()) ZoneId.of(tz) else ZoneId.systemDefault()
        instant.atZone(zone).format(timeFormatter)
    } catch (_: Exception) {
        ""
    }
}

private fun formatDuration(startedAt: String?, endedAt: String?): String {
    if (startedAt == null || endedAt == null) return ""
    return try {
        val start = Instant.parse(startedAt)
        val end = Instant.parse(endedAt)
        val totalMinutes = (end.epochSecond - start.epochSecond) / 60
        val hours = totalMinutes / 60
        val minutes = totalMinutes % 60
        if (hours > 0) "${hours}h ${minutes}m" else "${minutes}m"
    } catch (_: Exception) {
        ""
    }
}

val MOOD_EMOJI = mapOf(1 to "😞", 2 to "😕", 3 to "😐", 4 to "🙂", 5 to "😄")
val MOOD_LABELS = mapOf(1 to "Awful", 2 to "Bad", 3 to "Meh", 4 to "Good", 5 to "Great")

@Composable
fun TimelineItemCard(
    item: TimelineItem,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .clickable { onClick() },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        when (item.type) {
            "location" -> LocationCard(item)
            "mood" -> MoodCard(item)
            "sleep" -> SleepCard(item)
        }
    }
}

@Composable
private fun LocationCard(item: TimelineItem) {
    Row(
        modifier = Modifier.padding(12.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            Icons.Default.LocationOn,
            contentDescription = "Location",
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(20.dp).padding(top = 2.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = item.venueName ?: "Unknown venue",
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (item.parentVenueName != null) {
                Text(
                    text = item.parentVenueName,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!item.venueCategory.isNullOrBlank()) {
                Text(
                    text = item.venueCategory,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!item.notes.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = item.notes,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
        Text(
            text = item.formattedTime(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun MoodCard(item: TimelineItem) {
    val mood = item.mood ?: 3
    Row(
        modifier = Modifier.padding(12.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(moodColor(mood).copy(alpha = 0.2f)),
            contentAlignment = Alignment.Center,
        ) {
            Text(MOOD_EMOJI[mood] ?: "😐", style = MaterialTheme.typography.titleMedium)
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = MOOD_LABELS[mood] ?: "Mood",
                style = MaterialTheme.typography.titleMedium,
            )
            if (!item.activities.isNullOrEmpty()) {
                Text(
                    text = item.activities.take(4).joinToString(", ") { it.name },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (!item.notes.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = item.notes,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Text(
            text = item.formattedTime(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun SleepCard(item: TimelineItem) {
    val duration = formatDuration(item.sleepStartedAt, item.sleepEndedAt)
    val rating = item.sleepRating?.toInt() ?: 0

    Row(
        modifier = Modifier.padding(12.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            Icons.Default.Bedtime,
            contentDescription = "Sleep",
            tint = MaterialTheme.colorScheme.secondary,
            modifier = Modifier.size(20.dp).padding(top = 2.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = if (duration.isNotBlank()) "Sleep · $duration" else "Sleep",
                style = MaterialTheme.typography.titleMedium,
            )
            if (rating > 0) {
                Text(
                    text = "★".repeat(rating) + "☆".repeat(maxOf(0, 5 - rating)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!item.sleepComment.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = item.sleepComment,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Text(
            text = item.formattedTime(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
