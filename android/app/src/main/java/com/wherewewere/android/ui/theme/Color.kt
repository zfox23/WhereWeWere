package com.wherewewere.android.ui.theme

import androidx.compose.ui.graphics.Color

// Primary palette — earthy/muted green matching the web app
val Green80 = Color(0xFF5B8A6E)
val Green40 = Color(0xFF3D6B52)
val GreenContainer = Color(0xFFCCE8D9)

val Amber80 = Color(0xFFB97A56)
val Amber40 = Color(0xFF8C5A38)
val AmberContainer = Color(0xFFFFDCC8)

val Background = Color(0xFFF8F5F0)
val SurfaceLight = Color(0xFFFFFFFF)
val SurfaceVariantLight = Color(0xFFF0EDE8)

val BackgroundDark = Color(0xFF1A1A17)
val SurfaceDark = Color(0xFF242420)
val SurfaceVariantDark = Color(0xFF2E2E2A)

// Mood colors (1=awful → 5=great)
val MoodColor1 = Color(0xFFE57373) // red
val MoodColor2 = Color(0xFFFFB74D) // orange
val MoodColor3 = Color(0xFFFFD54F) // yellow
val MoodColor4 = Color(0xFF81C784) // light green
val MoodColor5 = Color(0xFF4CAF50) // green

fun moodColor(mood: Int): Color = when (mood) {
    1 -> MoodColor1
    2 -> MoodColor2
    3 -> MoodColor3
    4 -> MoodColor4
    5 -> MoodColor5
    else -> Color.Gray
}
