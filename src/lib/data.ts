// The one loader for the collected catalog — every page and endpoint reads
// versions.json through here (no scattered imports + casts).
import type { VersionsData } from './types';
import data from '../data/versions.json' with { type: 'json' };

export function loadVersions(): VersionsData {
  return data as unknown as VersionsData;
}
