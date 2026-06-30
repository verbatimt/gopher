// Idempotent seed of the six system-default measurement types (EP-0043). System defaults
// carry household_id = NULL and are read-only (households cannot edit/delete them). Each type
// is upserted by key (within the system-default scope) so re-running produces no duplicates.

import { and, eq, isNull } from 'drizzle-orm';
import { type Database, db as defaultDb } from '../index.ts';
import { measurementTypes } from '../schema/index.ts';

interface DefaultType {
  key: string;
  displayName: string;
  valueShape: 'single' | 'dual';
  unitDefault: string;
  precision: number;
  minNormal: string | null;
  maxNormal: string | null;
}

// min_normal/max_normal are display banding only (not validation). Ranges below are typical
// adult resting bands; they inform charting/adherence, not acceptance.
export const DEFAULT_MEASUREMENT_TYPES: DefaultType[] = [
  {
    key: 'weight',
    displayName: 'Weight',
    valueShape: 'single',
    unitDefault: 'kg',
    precision: 1,
    minNormal: null,
    maxNormal: null,
  },
  {
    key: 'blood_pressure',
    displayName: 'Blood Pressure',
    valueShape: 'dual',
    unitDefault: 'mmHg',
    precision: 0,
    minNormal: '90',
    maxNormal: '120',
  },
  {
    key: 'heart_rate',
    displayName: 'Heart Rate',
    valueShape: 'single',
    unitDefault: 'bpm',
    precision: 0,
    minNormal: '60',
    maxNormal: '100',
  },
  {
    key: 'blood_glucose',
    displayName: 'Blood Glucose',
    valueShape: 'single',
    unitDefault: 'mg/dL',
    precision: 0,
    minNormal: '70',
    maxNormal: '140',
  },
  {
    key: 'body_temperature',
    displayName: 'Body Temperature',
    valueShape: 'single',
    unitDefault: '°C',
    precision: 1,
    minNormal: '36.1',
    maxNormal: '37.2',
  },
  {
    key: 'spo2',
    displayName: 'Oxygen Saturation (SpO₂)',
    valueShape: 'single',
    unitDefault: '%',
    precision: 0,
    minNormal: '95',
    maxNormal: '100',
  },
];

export async function seedMeasurementTypes(database: Database = defaultDb): Promise<void> {
  for (const def of DEFAULT_MEASUREMENT_TYPES) {
    const [existing] = await database
      .select({ id: measurementTypes.id })
      .from(measurementTypes)
      .where(and(eq(measurementTypes.key, def.key), isNull(measurementTypes.householdId)))
      .limit(1);
    if (existing) {
      // Keep the catalog row in step with the canonical definition (idempotent update).
      await database
        .update(measurementTypes)
        .set({
          displayName: def.displayName,
          valueShape: def.valueShape,
          unitDefault: def.unitDefault,
          precision: def.precision,
          minNormal: def.minNormal,
          maxNormal: def.maxNormal,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(measurementTypes.id, existing.id));
      continue;
    }
    await database.insert(measurementTypes).values({
      householdId: null,
      key: def.key,
      displayName: def.displayName,
      valueShape: def.valueShape,
      unitDefault: def.unitDefault,
      precision: def.precision,
      minNormal: def.minNormal,
      maxNormal: def.maxNormal,
    });
  }
}
