# Resource benchmark — 2026-11-11T13:44Z
Machine: 2 × Intel(R) Xeon(R) Processor @ 2.60GHz, 1983 MB RAM, Node v20.20.2, no GPU.
| Measure | Result |
|---|---|
| Engine cold start (import + construct, fresh process, median of 5) | 50.3 ms |
| Process memory after engine start | 49.8 MB RSS (6.4 MB JS heap) |
| Server ready (spawn → first /api/health 200) | 92 ms |
| Server memory idle | 50.1 MB RSS |
| Server memory after 6 questions | 108.7 MB RSS |
| Question analysis (two-part question) | 271 µs |
| HTML parse + extraction | 8.6 MB/s (585 kB page in 66.4 ms → 1500 blocks) |
| Ranking | 4000 sentences / 1600 passages in 190.9 ms |
| Code size | engine 384 kB in 25 files · server 11 kB · client JS 41 kB + CSS 20 kB (unminified) |
| Runtime dependencies | 0 (node_modules present: false) |

## Live questions

| Question | Cold | Repeat (cached) | Server CPU | Searches | Pages | Data read | Pages from cache on repeat | Stage times (ms) |
|---|---|---|---|---|---|---|---|---|
| Why do stars shine? | 1711 ms | 261 ms | 880 ms | 5 | 4 | 3134 kB | 4 | understanding 28, planning 3, searching 742, reading 730, comparing 182, constructing 5 |
| What is the capital of Nepal? | 2752 ms | 840 ms | 980 ms | 5 | 4 | 2860 kB | 4 | understanding 8, planning 3, searching 596, reading 1939, comparing 184, constructing 17 |
| What happened in Nepal today? | 3495 ms | 123 ms | 260 ms | 5 | 4 | 369 kB | 4 | understanding 4, planning 1, searching 1582, reading 1876, comparing 23, constructing 3 |
