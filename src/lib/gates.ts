// The loader size gate — one constant, one owner.
// spec 00 invariant 2: "Loader size gate < 3 MiB per platform, enforced in CI."
// Rendered here as the toolchain table's pass/fail threshold.
export const BOOTSTRAP_MAX_BYTES = 3_145_728;
