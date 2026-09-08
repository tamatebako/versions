// versions.json schema — the contract between tools/collect.ts (writer) and the
// pages (readers). Authored here once; the collector validates its output
// against this shape before writing.
export interface ArtifactRef {
  url: string;
  size: number;
  downloads: number;
  sha256: string | null;
}

export interface RuntimeReleaseRef {
  tag: string;
  url: string;
  published_at: string;
  prerelease: boolean;
}

export interface RuntimeRow {
  engine: string;
  lang_version: string;
  flavor: string | null;
  tebako_line: string;
  triplet: string;
  reference: string;
  latest_in_line: boolean;
  // Flowed from the factory's published .manifest.json (plan 04) — WINS over
  // render-time derivation. null = pre-key release (or fetch miss): derive.
  capabilities: string[] | null;
  exe: ArtifactRef | null;
  image: ArtifactRef | null;
  release: RuntimeReleaseRef;
}

export interface PayloadVersion {
  version: string;
  entrypoints: string[];
  runtime_requirement: string | null;
  platforms: string[];
  artifact_url: string | null;
  sha256: string | null;
}

export interface PayloadRow {
  name: string;
  registry_repo: string;
  registry_url: string;
  versions: PayloadVersion[];
}

export interface BootstrapAsset {
  triplet: string;
  bytes: number;
}

export interface ToolchainRow {
  version: string;
  url: string;
  published_at: string;
  bootstrap: BootstrapAsset[];
}

export type SourceKind =
  | 'factory-release'
  | 'registry'
  | 'product-release'
  | 'checksum';

export interface SourceStatus {
  url: string;
  kind: SourceKind;
  ok: boolean;
  note?: string;
}

export interface VersionsData {
  generated_at: string;
  sources: SourceStatus[];
  runtimes: RuntimeRow[];
  payloads: PayloadRow[];
  toolchain: ToolchainRow[];
}
