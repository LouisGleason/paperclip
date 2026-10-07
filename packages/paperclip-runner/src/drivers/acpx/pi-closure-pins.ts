/**
 * Candidate closure pins from the isolated npm lock and official Node 24.21.0.
 * The non-Node graph is identical across targets, including platform resources.
 * Pi 1.0.0 dependency graphs were independently installed for all three targets.
 * Native platform execution and paid qualification remain separately required.
 * Changing any package, helper, extension or bootstrap requires regenerating all
 * three pins. Never accept a digest supplied only by an installed manifest.
 */
export const PI_DISTRIBUTION_CLOSURE_SHA256 = Object.freeze({
  "darwin-arm64": "8b85caad950fc720eabd80d7b67146b5b2106c66aecf1797993b90a3568ddc7f",
  "darwin-x64": "c66bfff68705627b3c5589e038080b284a04027a0a0a3371a54a657a80787789",
  "linux-x64": "a1b2797c5ca8245b441b0cc0e18f09463d9d896bd52631874320d77a09a4736d",
});
