# Intelligence benchmark — 2026-11-11T16:42Z

Depth: balanced · 36 items · scoring by automatic proxies (see bench/intelligence.js) · Wikimedia contact configured: true

| Category | n | understanding | queries | sources | extraction | support | citations | hallucination | uncertainty | usefulness | avg ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| factual | 3 | 100% | 67% | 75% | 100% | 100% | 100% | 100% | 100% | 100% | 2712 |
| current | 3 | 100% | 79% | 92% | 86% | 100% | 100% | 100% | 100% | 100% | 2428 |
| science | 3 | 100% | 67% | 75% | 77% | 100% | 100% | 100% | 100% | 100% | 1600 |
| history | 3 | 100% | 62% | 83% | 84% | 100% | 78% | 100% | 100% | 100% | 1122 |
| technology | 3 | 100% | 59% | 100% | 82% | 100% | 100% | 100% | 100% | 100% | 3008 |
| programming | 3 | 100% | 62% | 92% | 64% | 67% | 100% | 67% | 67% | 67% | 1372 |
| comparison | 3 | 100% | 59% | 83% | 89% | 100% | 100% | 100% | 100% | 100% | 1357 |
| multi-hop | 3 | 100% | 64% | 83% | 84% | 100% | 100% | 100% | 100% | 60% | 3525 |
| follow-up | 3 | 100% | 68% | 83% | 90% | 100% | 100% | 100% | 100% | 100% | 976 |
| ambiguous | 3 | 100% | 87% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 503 |
| conflicting | 3 | 100% | 59% | 83% | 82% | 67% | 100% | 67% | 67% | 67% | 2084 |
| unanswerable | 3 | 100% | 33% | 100% | 89% | 100% | 100% | 100% | 100% | 100% | 1313 |
| **overall** | 36 | **100%** | **64%** | **88%** | **85%** | **94%** | **98%** | **94%** | **94%** | **91%** | 1833 |

## Items

| ✓ | Category | Question | Confidence | ms | Start of answer |
|---|---|---|---|---|---|
| ✓ | factual | What is the capital of Nepal? | medium | 3044 | The capital of Nepal is Kathmandu. [1] Confirmed in the text of the sources • The capital, Kathmandu, nicknamed the "City of temples", is the largest  |
| ✓ | factual | Who wrote Pride and Prejudice? | medium | 3313 | Pride and Prejudice was written by Jane Austen. [1] Confirmed in the text of the sources • Pride and Prejudice is a novel by English author Jane Auste |
| ✓ | factual | How tall is Mount Everest? | medium | 1780 | Elevation above sea level of Mount Everest: 8,848.86 metre. [1] |
| ✓ | current | What happened in Nepal today? | medium | 1974 | These are the main stories about Nepal that news publishers reported in the last 24 hours (checked 11 November 2026, 16:41 UTC): • Today’s News in a N |
| ✓ | current | Who is the president of Nepal? | low | 3424 | The head of state of Nepal is Ram Chandra Poudel. [1] |
| ✓ | current | Latest news about artificial intelligence | medium | 1885 | These are the main stories about artificial intelligence that news publishers reported in the last 7 days (checked 11 November 2026, 16:41 UTC): • Goo |
| ✓ | science | Why do stars shine? | medium | 1075 | The production of energy at the core is the reason stars shine so brightly: every time two or more atomic nuclei fuse together to form a single atomic |
| ✓ | science | Why is the sky blue? | medium | 2122 | The daytime sky appears blue because air molecules scatter shorter wavelengths of sunlight more than longer ones (redder light). The night sky appears |
| ✓ | science | How does photosynthesis work? | medium | 1604 | Photosynthesis is a system of biological processes by which photopigment-bearing autotrophic organisms, such as most plants, algae and cyanobacteria,  |
| ✓ | history | When did World War II end? | medium | 1118 | The sources agree on this date: 2 September 1945 [1][2]. • World War II, or the Second World War (1 September 1939 – 2 September 1945), was a global c |
| ✓ | history | Who was the first person to walk on the Moon? | medium | 869 | The film, which was set against the backdrop of the Woodstock festival of 1969 and the United States's first Moon landing of that year, was distribute |
| ✓ | history | Why did the Roman Empire fall? | medium | 1379 | The Migration Period, involving large invasions by Germanic peoples and the Huns, led to the decline of the Western Roman Empire. [1] With the fall of |
| ✓ | technology | What is quantum computing? | high | 2515 | A quantum computer is a computer that represents and processes information using quantum states. [1] Quantum computations exploit phenomena such as su |
| ✓ | technology | How does a blockchain work? | medium | 4266 | A blockchain is a distributed ledger with growing lists of records (blocks) that are securely linked together via cryptographic hashes. [1] Each block |
| ✓ | technology | What is the difference between TCP and UDP? | high | 2243 | • TCP: The Transmission Control Protocol (TCP) is one of the main protocols of the Internet protocol suite, providing reliable, ordered, and error-che |
| ✓ | programming | How to remove duplicates from an array in JavaScript? | medium | 1034 | Obviously, these two positions are different for duplicate elements. [1] Example code — from Stack Overflow uniq = [...new Set(array)]; Other sources  |
| ✗ | programming | What does the map method do in JavaScript? | medium | 1210 | JavaScript’s `Array.map` method is just one of many methods for operating on arrays. [1] In order to use it effectively we need to not only understand |
| ✓ | programming | How do I reverse a string in Python? | medium | 1872 | Slice notation takes the form `[start:stop:step]`. In this case, we omit the `start` and `stop` positions since we want the whole string. [1] Example  |
| ✓ | comparison | Compare Python and Rust | medium | 1525 | • Python: Python is a high-level, general-purpose programming language that emphasizes code readability, simplicity, and ease-of-writing with the use  |
| ✓ | comparison | What is the difference between a virus and a bacterium? | medium | 1181 | • Virus: A virus is a submicroscopic infectious agent that replicates only inside the living cells of an organism. [1] / virus / Bacteria Instance of  |
| ✓ | comparison | Compare the Atlantic Ocean and the Pacific Ocean | medium | 1364 | • Atlantic Ocean: The Atlantic Ocean is the second largest of the world's five oceans, with an area of about 85,133,000 square kilometers (32,870,000  |
| ✓ | multi-hop | Who invented the telephone and when was he born? | medium | 3630 | Step 1 — Who invented the telephone? Discoverer or inventor of telephone: Alexander Graham Bell, Johann Philipp Reis, Elisha Gray and Antonio Meucci.  |
| ✓ | multi-hop | What is the population of the capital of Nepal? | medium | 3389 | Step 1 — What is the capital of Nepal? The capital of Nepal is Kathmandu. [1] Confirmed in the text of the sources • The capital, Kathmandu, nicknamed |
| ✓ | multi-hop | When was the author of Pride and Prejudice born? | low | 3555 | Step 1 — Who is the author of Pride and Prejudice? The source text points to this name: Jane Austen [1][2][3]. • Pride and Prejudice is a novel by Eng |
| ✓ | follow-up | Who invented the telephone? → When was he born? | high | 805 | Alexander Graham Bell was born on 3 March 1847. [1] Confirmed in the text of the sources • Alexander Graham Bell (born Alexander Bell; March 3, 1847 – |
| ✓ | follow-up | What is the capital of Nepal? → What is the population there? | medium | 1713 | Kathmandu has a population of 845,767 (as of 2021). [1] Related passages • As per the 2021 Nepal census, it has a population of 845,767 residing in 10 |
| ✓ | follow-up | Why do stars shine? → Explain the answer more simply. | medium | 411 | A star shines for most of its active life due to the thermonuclear fusion of hydrogen into helium in its core. [1] In more detail • The production of  |
| ✓ | ambiguous | Compare these two programming languages. | none | 5 | Which programming languages would you like me to compare? Name them — for example “Compare Python and Rust”. |
| ✓ | ambiguous | What is Mercury? | high | 1502 | Mercury is a classical planet that has been observed and recognized throughout history as a planet (or wandering star). In English, it is named after  |
| ✓ | ambiguous | When was he born? | none | 2 | I’m not sure what “he” refers to — there is nothing earlier in this conversation it could point to. Could you name it? |
| ✓ | conflicting | Who invented the telephone? | medium | 425 | Discoverer or inventor of telephone: Alexander Graham Bell, Johann Philipp Reis, Elisha Gray and Antonio Meucci. [1] Of these, Alexander Graham Bell i |
| ✓ | conflicting | Was Alexander Graham Bell the first person to invent the telephone? | medium | 1707 | The sources describe this as disputed or qualified rather than a simple yes or no: • After much trial and error, Alexander Graham Bell finally invents |
| ✗ | conflicting | Is Pluto a planet? | medium | 4119 | The sources point in different directions: • The prospect of Pluto's "demotion" created a public outcry, and in response the International Astronomica |
| ✓ | unanswerable | What did Zorblax Quimbleton say about the 2031 Mars treaty? | insufficient | 1167 | I could not verify this from the sources I found. Note: The pages I retrieved mention the topic but none of them addresses this question directly. Clo |
| ✓ | unanswerable | What is the phone number of the owner of the blue house on Elm Street in Springfield? | insufficient | 1906 | I could not verify this from the sources I found. Note: The pages I retrieved mention the topic but none of them addresses this question directly. |
| ✓ | unanswerable | Who will win the 2040 World Cup? | insufficient | 865 | I could not verify this from the sources I found. Note: The pages I retrieved mention the topic but none of them addresses this question directly. Clo |
