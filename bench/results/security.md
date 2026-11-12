# Security audit — 2026-11-12T06:12Z

20 of 20 automated checks passed.

| Result | Area | Check | Detail |
|---|---|---|---|
| PASS | SSRF | 33 hostile URL forms rejected by the URL guard |  |
| PASS | SSRF | public URLs still allowed |  |
| PASS | SSRF | DNS rebinding: host with one private A record is refused | private_address |
| PASS | SSRF | public hostname resolving to loopback is refused (live DNS: localtest.me) | private_address |
| PASS | SSRF | redirects are re-validated hop by hop (trusted origin → private target refused) | bad_port |
| PASS | Resource limits | response size cap enforced | 10000 bytes kept of 300 kB |
| PASS | Resource limits | request timeout enforced | timeout after 501 ms |
| PASS | Resource limits | HTML parser survives a nesting bomb and a 2 MB attribute |  |
| PASS | Untrusted content | hidden text, comments and scripts are dropped during extraction | 3 blocks kept |
| PASS | Untrusted content | visible injected instructions are treated as data: they do not change behaviour | answer is built only from sentences relevant to the question; the engine has no instruction-following path |
| PASS | Untrusted content | answers are plain structured text (no HTML reaches the client); client never uses innerHTML/eval |  |
| PASS | Untrusted content | calculator cannot execute code |  |
| PASS | Secrets | API keys and internal URLs never appear in any public endpoint or page |  |
| PASS | Secrets | a whole answer stream (events, search log, provider errors) never contains a key, even when the provider rejects it |  |
| PASS | Input validation | malformed, oversized and wrongly typed requests are rejected | 415 400 400 413 405 400 |
| PASS | Input validation | hostile context/learned payloads are sanitised |  |
| PASS | SSRF | preview endpoint cannot reach private addresses | 403 403 403 403 |
| PASS | Static files | path traversal blocked | 404 404 404 404 |
| PASS | Headers | CSP, nosniff, frame and referrer policies are sent |  |
| PASS | Rate limiting | per-address token bucket rejects a burst | 23 of 25 rapid requests rejected with 429 |
