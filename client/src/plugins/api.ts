/**
 * Client API helpers for check-in type plugins.
 *
 * Generic-storage plugins use the framework's /plugins/:id/checkins CRUD.
 * Custom-storage plugins typically expose their own endpoints (declared via
 * server.api) and use their own client helpers, like the mood plugin's
 * existing `moodCheckins` API.
 */

import { request } from '../api/client';
import type { PluginField, CheckinTypeStrings } from 'wwp-shared';

export interface PluginManifest {
  id: string;
  version: string;
  fields: PluginField[];
  strings: CheckinTypeStrings;
  filterParams: string[];
}

export interface GenericCheckin {
  id: string;
  plugin_id: string;
  user_id: string;
  checked_in_at: string;
  checkin_timezone: string | null;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const plugins = {
  list: () => request<PluginManifest[]>('/plugins'),
  get: (pluginId: string) => request<PluginManifest>(`/plugins/${pluginId}`),

  checkins: {
    list: (pluginId: string, params?: Record<string, string>) =>
      request<GenericCheckin[]>(
        `/plugins/${pluginId}/checkins?${params ? new URLSearchParams(params) : ''}`,
      ),
    get: (pluginId: string, id: string) => request<GenericCheckin>(`/plugins/${pluginId}/checkins/${id}`),
    create: (pluginId: string, data: { checked_in_at?: string | null; checkin_timezone?: string | null; data?: Record<string, unknown> }) =>
      request<GenericCheckin>(`/plugins/${pluginId}/checkins`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (pluginId: string, id: string, data: { checked_in_at?: string | null; checkin_timezone?: string | null; data?: Record<string, unknown> }) =>
      request<GenericCheckin>(`/plugins/${pluginId}/checkins/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    remove: (pluginId: string, id: string) =>
      request<{ message: string; id: string }>(`/plugins/${pluginId}/checkins/${id}`, {
        method: 'DELETE',
      }),
  },

  settings: {
    get: (pluginId: string) => request<Record<string, unknown>>(`/plugins/${pluginId}/settings`),
    set: (pluginId: string, updates: Record<string, unknown>) =>
      request<Record<string, unknown>>(`/plugins/${pluginId}/settings`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),
  },
};
