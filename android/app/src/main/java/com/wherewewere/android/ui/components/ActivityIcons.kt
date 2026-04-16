package com.wherewewere.android.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.DirectionsBike
import androidx.compose.material.icons.automirrored.filled.DirectionsWalk
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.*
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Maps the icon ID strings stored in the database (matching Lucide icon IDs used on the web)
 * to the closest available Material Icon for display on Android.
 */
fun resolveActivityIcon(iconId: String?): ImageVector? {
    if (iconId.isNullOrBlank()) return null
    return when (iconId.trim().lowercase()) {
        "circle-fill" -> Icons.Filled.Circle
        "person-fill" -> Icons.Filled.Person
        "people-fill" -> Icons.Filled.Group
        "heart" -> Icons.Filled.FavoriteBorder
        "heart-fill" -> Icons.Filled.Favorite
        "heart-break" -> Icons.Filled.HeartBroken
        "chat-bubble" -> Icons.Filled.ChatBubbleOutline
        "chat-dots" -> Icons.Filled.Forum
        "telescope" -> Icons.Filled.Biotech
        "joystick" -> Icons.Filled.SportsEsports
        "dice-1" -> Icons.Filled.Casino
        "film" -> Icons.Filled.Movie
        "book" -> Icons.AutoMirrored.Filled.MenuBook
        "music-note" -> Icons.Filled.MusicNote
        "camera" -> Icons.Filled.PhotoCamera
        "camera-video" -> Icons.Filled.Videocam
        "mountain" -> Icons.Filled.Landscape
        "bicycle" -> Icons.AutoMirrored.Filled.DirectionsBike
        "person-walking" -> Icons.AutoMirrored.Filled.DirectionsWalk
        "water" -> Icons.Filled.WaterDrop
        "water-waves" -> Icons.Filled.Waves
        "disco" -> Icons.Filled.Album
        "tree" -> Icons.Filled.Park
        "sun-glasses" -> Icons.Filled.WbSunny
        "fire" -> Icons.Filled.Whatshot
        "briefcase" -> Icons.Filled.Work
        "code" -> Icons.Filled.Code
        "lightbulb" -> Icons.Filled.EmojiObjects
        "pencil" -> Icons.Filled.Edit
        "person-heart" -> Icons.Filled.VolunteerActivism
        "dumbbell" -> Icons.Filled.FitnessCenter
        "pill" -> Icons.Filled.Medication
        "cup" -> Icons.Filled.LocalCafe
        "leaf" -> Icons.Filled.Eco
        "face-tired" -> Icons.Filled.SentimentVeryDissatisfied
        "star" -> Icons.Filled.StarBorder
        "star-fill" -> Icons.Filled.Star
        "mic" -> Icons.Filled.Mic
        "hourglass-split" -> Icons.Filled.HourglassEmpty
        "eye" -> Icons.Filled.Visibility
        "moon" -> Icons.Filled.NightsStay
        "arrow-down-up" -> Icons.Filled.SwapVert
        "exclamation-triangle" -> Icons.Filled.Warning
        "lightning-fill" -> Icons.Filled.Bolt
        "target" -> Icons.Filled.GpsFixed
        "cloud-sun" -> Icons.Filled.WbCloudy
        "dash" -> Icons.Filled.Remove
        "hand-thumbs-up" -> Icons.Filled.ThumbUp
        "screwdriver" -> Icons.Filled.Build
        "emoji-laughing" -> Icons.Filled.EmojiEmotions
        "confetti" -> Icons.Filled.Celebration
        "broom" -> Icons.Filled.CleaningServices
        "cloud" -> Icons.Filled.Cloud
        "sun" -> Icons.Filled.WbSunny
        "rainbow" -> Icons.Filled.Flare
        "alarm-clock" -> Icons.Filled.Alarm
        "archive" -> Icons.Filled.Archive
        "badge-check" -> Icons.Filled.Verified
        "bandage" -> Icons.Filled.Healing
        "banknote" -> Icons.Filled.Payments
        "bath" -> Icons.Filled.Bathtub
        "bed-single" -> Icons.Filled.Hotel
        "bell" -> Icons.Filled.Notifications
        "bell-ring" -> Icons.Filled.NotificationsActive
        "bird" -> Icons.Filled.Air
        "bookmark" -> Icons.Filled.Bookmark
        "bot" -> Icons.Filled.SmartToy
        "brain" -> Icons.Filled.Psychology
        "building" -> Icons.Filled.Business
        "bus" -> Icons.Filled.DirectionsBus
        "car" -> Icons.Filled.DirectionsCar
        "cat" -> Icons.Filled.Pets
        "chef-hat" -> Icons.Filled.Restaurant
        "clapperboard" -> Icons.Filled.Theaters
        "clipboard-check" -> Icons.Filled.AssignmentTurnedIn
        "compass" -> Icons.Filled.Explore
        "cpu" -> Icons.Filled.Memory
        "dog" -> Icons.Filled.Pets
        "earth" -> Icons.Filled.Public
        "factory" -> Icons.Filled.Factory
        "flag" -> Icons.Filled.Flag
        "flower" -> Icons.Filled.LocalFlorist
        "gift" -> Icons.Filled.CardGiftcard
        "globe" -> Icons.Filled.Language
        else -> null
    }
}
