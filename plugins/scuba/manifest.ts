/**
 * SCUBA dive check-in type — plugin manifest (pure data; shared by client + server).
 *
 * SCUBA uses GENERIC storage (the shared `plugin_checkins` table): the field
 * schema below drives validation, the auto detail chips, and backup/restore
 * (all automatic for generic storage). The numeric fields use the same units
 * as Diving Log 4.x logbook backups: meters, °C, bar, kg, minutes.
 */

import type { CheckinTypeManifest } from 'wwp-shared';

export const manifest: CheckinTypeManifest = {
  id: 'scuba',
  version: '1.0.0',
  filterParams: ['water_type'],
  fields: [
    // ------------------------------------------------------------- When
    { name: 'entry_time', kind: 'text', label: 'Time', placeholder: 'e.g. 09:10' },
    { name: 'surface_interval', kind: 'text', label: 'Surface interval', placeholder: 'e.g. 54m' },
    { name: 'bottom_time', kind: 'number', label: 'Bottom time', min: 0, unit: 'min' },
    // ------------------------------------------------------------ Where
    { name: 'place', kind: 'text', label: 'Site', placeholder: 'e.g. San Carlos Beach' },
    { name: 'city', kind: 'text', label: 'City' },
    { name: 'country', kind: 'text', label: 'Country' },
    { name: 'latitude', kind: 'number', label: 'Latitude' },
    { name: 'longitude', kind: 'number', label: 'Longitude' },
    // ------------------------------------------------------------ Dive
    { name: 'depth', kind: 'number', label: 'Max depth', min: 0, unit: 'm' },
    { name: 'depth_avg', kind: 'number', label: 'Average depth', min: 0, unit: 'm' },
    { name: 'altitude', kind: 'text', label: 'Altitude' },
    {
      name: 'water_type',
      kind: 'select',
      label: 'Water',
      options: [
        { value: 'salt', label: 'Saltwater' },
        { value: 'fresh', label: 'Freshwater' },
        { value: 'brackish', label: 'Brackish' },
        { value: 'pool', label: 'Pool' },
      ],
    },
    {
      name: 'entry_method',
      kind: 'select',
      label: 'Entry',
      options: [
        { value: 'shore', label: 'From shore' },
        { value: 'boat', label: 'From boat' },
        { value: 'surf', label: 'Surf' },
        { value: 'pool', label: 'Pool' },
        { value: 'other', label: 'Other' },
      ],
    },
    { name: 'divetype', kind: 'text', label: 'Dive types', placeholder: 'e.g. Drift, Night' },
    { name: 'buddy', kind: 'text', label: 'Buddy' },
    { name: 'divemaster', kind: 'text', label: 'Divemaster' },
    { name: 'boat_name', kind: 'text', label: 'Boat' },
    // ----------------------------------------------------- Conditions
    { name: 'weather', kind: 'text', label: 'Weather' },
    { name: 'surface_conditions', kind: 'text', label: 'Surface', placeholder: 'e.g. 6 foot swells' },
    { name: 'uw_current', kind: 'text', label: 'Underwater current' },
    { name: 'visibility', kind: 'integer', label: 'Visibility (0–3)', min: 0, max: 3 },
    { name: 'vis_hor', kind: 'text', label: 'Horizontal visibility', placeholder: 'e.g. 30 ft' },
    { name: 'vis_ver', kind: 'text', label: 'Vertical visibility', placeholder: 'e.g. 30 ft' },
    { name: 'air_temp', kind: 'number', label: 'Air temp', unit: '°C' },
    { name: 'water_temp', kind: 'number', label: 'Water temp', unit: '°C' },
    // --------------------------------------------------- Equipment/gas
    { name: 'weight', kind: 'number', label: 'Weight belt', min: 0, unit: 'kg' },
    {
      name: 'tank_type',
      kind: 'select',
      label: 'Tank type',
      options: [
        { value: 'aluminum', label: 'Aluminum' },
        { value: 'steel', label: 'Steel' },
        { value: 'other', label: 'Other' },
      ],
    },
    { name: 'tank_size', kind: 'number', label: 'Tank size', min: 0 },
    { name: 'gas', kind: 'text', label: 'Gas', placeholder: 'e.g. Air, EAN32' },
    { name: 'o2', kind: 'number', label: 'O₂ %', min: 0, max: 100, unit: '%' },
    { name: 'he', kind: 'number', label: 'He %', min: 0, max: 100, unit: '%' },
    { name: 'start_pressure', kind: 'number', label: 'Start pressure', min: 0, unit: 'bar' },
    { name: 'end_pressure', kind: 'number', label: 'End pressure', min: 0, unit: 'bar' },
    { name: 'weight_pressure', kind: 'number', label: 'Weighted pressure', min: 0, unit: 'bar' },
    { name: 'supply_type', kind: 'text', label: 'Supply type' },
    { name: 'min_ppo2', kind: 'number', label: 'Min pPO₂', min: 0, unit: 'bar' },
    { name: 'max_ppo2', kind: 'number', label: 'Max pPO₂', min: 0, unit: 'bar' },
    { name: 'dbl_tank', kind: 'boolean', label: 'Doubles' },
    { name: 'divesuit', kind: 'text', label: 'Divesuit', placeholder: 'e.g. 8mm Semi-Dry' },
    { name: 'computer', kind: 'text', label: 'Computer' },
    { name: 'used_equip', kind: 'text', label: 'Used equipment' },
    // ---------------------------------------------------- Deco/gas loads
    { name: 'deco', kind: 'boolean', label: 'Decompression dive' },
    { name: 'deco_stops', kind: 'text', label: 'Deco stops' },
    { name: 'repetitive', kind: 'boolean', label: 'Repetitive dive' },
    { name: 'desaturation_time', kind: 'number', label: 'Desaturation time', min: 0, unit: 'min' },
    { name: 'no_fly_time', kind: 'number', label: 'No-fly time', min: 0, unit: 'min' },
    { name: 'scrubber_time', kind: 'number', label: 'Scrubber time', min: 0, unit: 'min' },
    { name: 'cns', kind: 'text', label: 'CNS' },
    { name: 'pg_start', kind: 'text', label: 'Pressure group (start)' },
    { name: 'pg_end', kind: 'text', label: 'Pressure group (end)' },
    // ------------------------------------------------------ Trip context
    { name: 'shop', kind: 'text', label: 'Shop / operator' },
    { name: 'trip', kind: 'text', label: 'Trip' },
    // -------------------------------------------------------------- Rest
    { name: 'rating', kind: 'rating', label: 'Rating', min: 0, max: 5 },
    { name: 'comments', kind: 'textarea', label: 'Comments', placeholder: 'What did you see?' },
  ],
  strings: {
    title: 'SCUBA',
    singular: 'dive',
    plural: 'dives',
    newCheckIn: 'Log a dive',
    profileTab: 'Dives',
    confirmDelete: 'Delete this dive?',
  },
};
