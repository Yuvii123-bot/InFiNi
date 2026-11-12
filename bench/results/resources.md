# Resource benchmark — 2026-11-12T06:01Z
Machine: 2 × Intel(R) Xeon(R) Processor @ 2.60GHz, 1983 MB RAM, Node v20.20.2, no GPU.
| Measure | Result |
|---|---|
| Engine cold start (import + construct, fresh process, median of 5) | 51.8 ms |
| Process memory after engine start | 52.1 MB RSS (7.7 MB JS heap) |
| Server ready (spawn → first /api/health 200) | 85 ms |
| Server memory idle | 52.9 MB RSS |
| Server memory after 6 questions | 133.9 MB RSS |
| Question analysis (two-part question) | 236 µs |
| HTML parse + extraction | 11.5 MB/s (585 kB page in 49.9 ms → 1500 blocks) |
| Ranking | 4000 sentences / 1600 passages in 162.7 ms |
| Built-in brain, fresh process (median of 3) | first chat reply 155 ms (loads the conversation data) · first common-sense reply 74 ms (loads the fact base) · then 0.39 ms per reply (520 replies) |
| Brain memory | 86 MB RSS after the first reply · 120.2 MB RSS with all data loaded (30.9 MB JS heap) |
| Code size | engine 660 kB in 35 files · brain data 4037 kB in 8 files · server 12 kB · client JS 52 kB + CSS 31 kB (unminified) |
| Runtime dependencies | 0 (node_modules present: false) |

## Live questions

| Question | Cold | Repeat (cached) | Server CPU | Searches | Pages | Data read | Pages from cache on repeat | Stage times (ms) |
|---|---|---|---|---|---|---|---|---|
| Why do stars shine? | 1320 ms | 204 ms | 680 ms | 4 | 3 | 1296 kB | 3 | understanding 11, planning 3, searching 460, reading 464, comparing 94, constructing 2 |
| What is the capital of Nepal? | 2246 ms | 682 ms | 500 ms | 4 | 5 | 557 kB | 5 | understanding 1, planning 2, searching 671, reading 1395, comparing 143, constructing 12 |
| What happened in Nepal today? | 5861 ms | 3118 ms | 180 ms | 5 | 3 | 250 kB | 3 | understanding 0, planning 0, searching 1761, reading 4058, comparing 20, constructing 4 |
