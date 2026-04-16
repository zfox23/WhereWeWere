package com.wherewewere.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColors = lightColorScheme(
    primary = Green80,
    onPrimary = androidx.compose.ui.graphics.Color.White,
    primaryContainer = GreenContainer,
    secondary = Amber80,
    onSecondary = androidx.compose.ui.graphics.Color.White,
    secondaryContainer = AmberContainer,
    background = Background,
    surface = SurfaceLight,
    surfaceVariant = SurfaceVariantLight,
)

private val DarkColors = darkColorScheme(
    primary = Green80,
    onPrimary = androidx.compose.ui.graphics.Color.White,
    primaryContainer = Green40,
    secondary = Amber80,
    onSecondary = androidx.compose.ui.graphics.Color.White,
    secondaryContainer = Amber40,
    background = BackgroundDark,
    surface = SurfaceDark,
    surfaceVariant = SurfaceVariantDark,
)

@Composable
fun WhereWeWereTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = Typography,
        content = content,
    )
}
