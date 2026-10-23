# Attribution and dependency provenance

PhishScoutSentinel derives from PeelScout by ExploitBlock (MIT, see LICENSE).
The original wrapper decoders, calendar extractor, phone candidate extraction and
bounded zlib reader have been retained and modified. The old injected message
viewer, MIME parser and unused QR library have been removed.

PostalMime 4.1.4 by Andris Reinman is vendored from the npm registry, with no
transitive runtime dependencies. License: MIT-0 (vendor/postal-mime/LICENSE.txt).
ESM runtime files, declarations and source maps are retained for inspection.

Source: https://github.com/postalsys/postal-mime
Archive: https://registry.npmjs.org/postal-mime/-/postal-mime-4.1.4.tgz
Verified archive integrity:
`sha512-+6Qsn7Q2TSLMScfN4X2VQIclPRKgDAtKhytQex3fVSV/+HgVaawtsQGzKYDQLQIBR7b4Vfg+88WRGvuF/kwLSw==`

Runtime files are copied unchanged from dist/esm. The small local package.json
sets the ESM boundary for Node tests; it is not the upstream package manifest.
