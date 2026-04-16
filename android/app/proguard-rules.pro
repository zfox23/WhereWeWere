# Keep serializable data model classes
-keep class com.wherewewere.android.data.model.** { *; }

# Keep Retrofit service interface methods
-keep interface com.wherewewere.android.data.api.WhereWeWereService { *; }

# Retrofit
-keepattributes Signature
-keepattributes Exceptions
-keepattributes *Annotation*

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Google Maps SDK (most rules are in the SDK's own consumer-proguard file)
-keep class com.google.android.gms.maps.** { *; }

# kotlinx.serialization
-keepattributes *Annotation*
-keep @kotlinx.serialization.Serializable class * { *; }
