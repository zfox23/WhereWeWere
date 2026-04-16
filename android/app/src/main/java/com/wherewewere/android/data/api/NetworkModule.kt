package com.wherewewere.android.data.api

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.wherewewere.android.BuildConfig
import com.wherewewere.android.data.preferences.PreferencesRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    /** Updated at app start and whenever the user saves Settings. */
    val baseUrlHolder = AtomicReference("http://localhost/api/v1/")

    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(prefsRepo: PreferencesRepository): OkHttpClient {
        return OkHttpClient.Builder()
            // Rewrite host to current serverUrl
            .addInterceptor { chain ->
                val base = baseUrlHolder.get()
                val original = chain.request()
                val originalUrl = original.url

                val newUrl = if (base.isNotBlank() && base != "http://localhost/api/v1/") {
                    val baseUri = base.toHttpUrlOrNull()
                    if (baseUri != null) {
                        originalUrl.newBuilder()
                            .scheme(baseUri.scheme)
                            .host(baseUri.host)
                            .port(baseUri.port)
                            .build()
                    } else originalUrl
                } else originalUrl

                chain.proceed(original.newBuilder().url(newUrl).build())
            }
            // Auth token header
            .addInterceptor { chain ->
                val token = prefsRepo.currentToken()
                val request = if (token.isNotBlank()) {
                    chain.request().newBuilder()
                        .addHeader("X-WhereWeWere-Token", token)
                        .build()
                } else {
                    chain.request()
                }
                chain.proceed(request)
            }
            .addInterceptor(
                HttpLoggingInterceptor().apply {
                    level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
                    else HttpLoggingInterceptor.Level.NONE
                }
            )
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(okHttpClient: OkHttpClient, json: Json): Retrofit {
        return Retrofit.Builder()
            .baseUrl("http://localhost/api/v1/")
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
    }

    @Provides
    @Singleton
    fun provideService(retrofit: Retrofit): WhereWeWereService {
        return retrofit.create(WhereWeWereService::class.java)
    }
}
