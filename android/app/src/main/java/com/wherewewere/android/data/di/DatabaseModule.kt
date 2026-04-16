package com.wherewewere.android.data.di

import android.content.Context
import androidx.room.Room
import com.wherewewere.android.data.db.AppDatabase
import com.wherewewere.android.data.db.CacheDao
import com.wherewewere.android.data.db.PendingOperationDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideAppDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "wherewewere.db")
            // Cache tables are re-downloadable; destructive migration is acceptable.
            .fallbackToDestructiveMigration(dropAllTables = false)
            .build()

    @Provides
    @Singleton
    fun providePendingOperationDao(db: AppDatabase): PendingOperationDao =
        db.pendingOperationDao()

    @Provides
    @Singleton
    fun provideCacheDao(db: AppDatabase): CacheDao =
        db.cacheDao()
}
