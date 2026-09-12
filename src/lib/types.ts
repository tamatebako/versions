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
  // The release carries a signed checksums bundle (SHA256SUMS*.asc) — the
  // trust chain's verifiability marker, observed on the release assets.
  signed: boolean;
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

export interface PayloadPlatform {
  platform: string;
  artifact: string | null;
  sha256: string | null;
}

export interface PayloadVersion {
  version: string;
  entrypoints: string[];
  runtime_requirement: string | null;
  platforms: PayloadPlatform[];
  artifact_url: string | null;
  sha256: string | null;
}

export interface PayloadRow {
  name: string;
  // Flowed from the registries (feedstock's own payload kind; summary from
  // the feedstock registry or the org index catalog) — never authored here.
  kind: string | null;
  summary: string | null;
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
  signed: boolean;
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
