import { authHeaders } from './auth'

export type SchoolFeatureDefinition = {
  key: string
  label: string
  description: string
  defaultEnabled: boolean
}

export type SchoolFeatureRecord = {
  schoolId: string
  schoolName: string
  administrator: { username: string; name: string; isActive: boolean } | null
  featureFlags: Record<string, boolean>
  featureSettings: Record<string, unknown>
  featureNotes: string
  updatedAt: string
}

export type CurrentSchoolFeatures = Pick<
  SchoolFeatureRecord,
  'schoolId' | 'featureFlags' | 'featureSettings' | 'updatedAt'
>

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export async function fetchSchoolFeatureCatalog(): Promise<SchoolFeatureDefinition[]> {
  const payload = await readJson<{ ok: boolean; features?: SchoolFeatureDefinition[] }>(
    await fetch(`${apiBaseUrl}/api/school-features/catalog`, { headers: authHeaders() })
  )
  return Array.isArray(payload.features) ? payload.features : []
}

export async function fetchSchoolFeatureRecords(): Promise<SchoolFeatureRecord[]> {
  const payload = await readJson<{ ok: boolean; schools?: SchoolFeatureRecord[] }>(
    await fetch(`${apiBaseUrl}/api/school-features/schools`, { headers: authHeaders() })
  )
  return Array.isArray(payload.schools) ? payload.schools : []
}

export async function updateSchoolFeatureRecord(
  schoolId: string,
  input: Pick<SchoolFeatureRecord, 'featureFlags' | 'featureSettings' | 'featureNotes'>
): Promise<SchoolFeatureRecord> {
  const payload = await readJson<{ ok: boolean; school: SchoolFeatureRecord }>(
    await fetch(`${apiBaseUrl}/api/school-features/schools/${encodeURIComponent(schoolId)}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(input)
    })
  )
  return payload.school
}

export async function fetchCurrentSchoolFeatures(): Promise<CurrentSchoolFeatures | null> {
  const payload = await readJson<{ ok: boolean; school?: CurrentSchoolFeatures }>(
    await fetch(`${apiBaseUrl}/api/school-features/current`, { headers: authHeaders() })
  )
  return payload.school ?? null
}
