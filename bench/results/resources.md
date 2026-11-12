# Resource benchmark — 2026-11-12T13:15Z
Machine: 2 × Intel(R) Xeon(R) Processor @ 2.60GHz, 1983 MB RAM, Node v20.20.2, no GPU.
| Measure | Result |
|---|---|
| Engine cold start (import + construct, fresh process, median of 5) | 85 ms |
| Process memory after engine start | 53.4 MB RSS (8.7 MB JS heap) |
| Server ready (spawn → first /api/health 200) | 129 ms |
| Server memory idle | 53.5 MB RSS |
| Server memory after 6 questions | 150.2 MB RSS |
| Question analysis (two-part question) | 292 µs |
| HTML parse + extraction | 8.9 MB/s (585 kB page in 64.4 ms → 1500 blocks) |
| Ranking | 4000 sentences / 1600 passages in 413.2 ms |
| Built-in brain, fresh process (median of 3) | first chat reply 215 ms (loads the conversation data) · first common-sense reply 88 ms (loads the fact base) · then 0.5 ms per reply (520 replies) |
| Brain memory | 87.7 MB RSS after the first reply · 122.4 MB RSS with all data loaded (27.1 MB JS heap) |
| Code size | engine 885 kB in 44 files · brain data 4045 kB in 8 files · server 14 kB · client JS 73 kB + CSS 40 kB (unminified) |
| Runtime dependencies | 0 (node_modules present: false) |

## Live questions

| Question | Cold | Repeat (cached) | Server CPU | Searches | Pages | Data read | Pages from cache on repeat | Stage times (ms) |
|---|---|---|---|---|---|---|---|---|
| Why do stars shine? | 2372 ms | 280 ms | 1210 ms | 6 | 4 | 3134 kB | 4 | understanding 11, planning 2, searching 1029, reading 774, comparing 118 |
| What is the capital of Nepal? | 2856 ms | 526 ms | 440 ms | 6 | 4 | 226 kB | 4 | understanding 2, planning 3, searching 679, reading 1948, comparing 184 |
| What happened in Nepal today? | 6116 ms | 3254 ms | 270 ms | 5 | 3 | 282 kB | 3 | understanding 1, planning 0, searching 2027, reading 4050, comparing 18 |
