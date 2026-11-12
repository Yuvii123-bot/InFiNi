# Intelligence benchmark — 2026-11-12T12:58Z

Version 3.0.0 · depth: auto · 36 items · scoring by automatic proxies (see bench/intelligence.js) · Wikimedia contact configured: true

Answered by the built-in brain without a search (no citations by design; left out of the retrieval columns): “Is Pluto a planet?”.

| Category | n | understanding | queries | sources | extraction | support | citations | hallucination | uncertainty | usefulness | avg ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| factual | 3 | 100% | 100% | 92% | 76% | 100% | 100% | 100% | 100% | 100% | 3235 |
| current | 3 | 100% | 100% | 92% | 83% | 100% | 100% | 100% | 100% | 100% | 3059 |
| science | 3 | 100% | 100% | 100% | 67% | 100% | 100% | 100% | 100% | 100% | 3408 |
| history | 3 | 100% | 100% | 92% | 78% | 100% | 78% | 100% | 100% | 100% | 3604 |
| technology | 3 | 100% | 100% | 100% | 86% | 100% | 100% | 100% | 100% | 100% | 2246 |
| programming | 3 | 100% | 100% | 92% | 81% | 100% | 100% | 100% | 100% | 100% | 2417 |
| comparison | 3 | 100% | 100% | 92% | 79% | 100% | 100% | 100% | 100% | 100% | 3851 |
| multi-hop | 3 | 100% | 96% | 100% | 70% | 100% | 100% | 100% | 100% | 60% | 6549 |
| follow-up | 3 | 100% | 100% | 92% | 71% | 100% | 100% | 100% | 100% | 100% | 1238 |
| ambiguous | 3 | 100% | 100% | 100% | 95% | 100% | 100% | 100% | 100% | 100% | 786 |
| conflicting | 3 | 100% | 100% | 100% | 76% | 100% | 100% | 100% | 100% | 100% | 1437 |
| unanswerable | 3 | 100% | 65% | 100% | 80% | 100% | 100% | 100% | 100% | 100% | 5840 |
| **overall** | 36 | **100%** | **97%** | **96%** | **79%** | **100%** | **98%** | **100%** | **100%** | **97%** | 3139 |

## Items

| ✓ | Category | Question | Confidence | ms | Start of answer |
|---|---|---|---|---|---|
| ✓ | factual | What is the capital of Nepal? | high | 3608 | The capital of Nepal is Kathmandu. [1] Confirmed in the text of the sources • The capital, Kathmandu, nicknamed the "City of temples", is the largest  |
| ✓ | factual | Who wrote Pride and Prejudice? | high | 3535 | Pride and Prejudice was written by Jane Austen. [1] Confirmed in the text of the sources • Pride and Prejudice is a novel by English author Jane Auste |
| ✓ | factual | How tall is Mount Everest? | medium | 2563 | Elevation above sea level of Mount Everest: 8,848.86 metre. [1] |
| ✓ | current | What happened in Nepal today? | high | 2997 | These are the main stories about Nepal that news publishers reported in the last 24 hours (checked 12 November 2026, 12:56 UTC): • Death toll in Makwa |
| ✓ | current | Who is the president of Nepal? | low | 3709 | The head of state of Nepal is Ram Chandra Poudel. [1] |
| ✓ | current | Latest news about artificial intelligence | medium | 2472 | These are the main stories about artificial intelligence that news publishers reported in the last 7 days (checked 12 November 2026, 12:56 UTC): • Who |
| ✓ | science | Why do stars shine? | high | 1949 | A star shines for most of its active life due to the thermonuclear fusion of hydrogen into helium in its core. [1] This process releases energy that t |
| ✓ | science | Why is the sky blue? | high | 2404 | The daytime sky appears blue because air molecules scatter shorter wavelengths of sunlight more than longer ones (redder light). [1] In more detail •  |
| ✓ | science | How does photosynthesis work? | medium | 5872 | Photosynthesis is a system of biological processes by which photopigment-bearing autotrophic organisms, such as most plants, algae and cyanobacteria,  |
| ✓ | history | When did World War II end? | high | 4486 | The sources agree on this date: 2 September 1945 [1][2]. • World War II, fought from 1939 to 1945, was the deadliest war in history and involved more  |
| ✓ | history | Who was the first person to walk on the Moon? | high | 3155 | The sources agree on this name: Neil Armstrong [1][2][3]. • Neil Armstrong was the first human to walk on the moon on July 20, 1969, during NASA’s Apo |
| ✓ | history | Why did the Roman Empire fall? | medium | 3171 | The Migration Period, involving large invasions by Germanic peoples and the Huns, led to the decline of the Western Roman Empire. [1] With the fall of |
| ✓ | technology | What is quantum computing? | high | 2127 | A quantum computer is a computer that represents and processes information using quantum states. [1][2] Quantum computations exploit phenomena such as |
| ✓ | technology | How does a blockchain work? | high | 2469 | A blockchain is a distributed ledger with growing lists of records (blocks) that are securely linked together via cryptographic hashes. [1] How it wor |
| ✓ | technology | What is the difference between TCP and UDP? | high | 2142 | • TCP: The Transmission Control Protocol (TCP) is one of the main protocols of the Internet protocol suite, providing reliable, ordered, and error-che |
| ✓ | programming | How to remove duplicates from an array in JavaScript? | medium | 2798 | Steps — from Built In (“How to Remove Duplicates From JavaScript Arrays: 7 Methods…”) 1. Filter Method: The `filter` method creates a new array of ele |
| ✓ | programming | What does the map method do in JavaScript? | high | 1712 | The `map` method of `Array` instances creates a new array populated with the results of calling a provided function on every element in the calling ar |
| ✓ | programming | How do I reverse a string in Python? | medium | 2741 | The sections below include several ways you can reverse strings in Python. [1][2] Example code — from Stack Overflow def reverse_string_readable_answe |
| ✓ | comparison | Compare Python and Rust | medium | 3635 | • Python: Python is a high-level, general-purpose programming language that emphasizes code readability, simplicity, and ease-of-writing with the use  |
| ✓ | comparison | What is the difference between a virus and a bacterium? | medium | 2399 | • Virus: A virus is a submicroscopic infectious agent that replicates only inside the living cells of an organism. [1] / virus / Bacteria Instance of  |
| ✓ | comparison | Compare the Atlantic Ocean and the Pacific Ocean | medium | 5519 | • Atlantic Ocean: The Atlantic Ocean is the second largest of the world's five oceans, with an area of about 85,133,000 square kilometers (32,870,000  |
| ✓ | multi-hop | Who invented the telephone and when was he born? | high | 5725 | Step 1 — Who invented the telephone? Discoverer or inventor of telephone: Alexander Graham Bell, Johann Philipp Reis, Antonio Meucci and Elisha Gray.  |
| ✓ | multi-hop | What is the population of the capital of Nepal? | medium | 5309 | Step 1 — What is the capital of Nepal? The capital of Nepal is Kathmandu. [1] Confirmed in the text of the sources • The capital, Kathmandu, nicknamed |
| ✓ | multi-hop | When was the author of Pride and Prejudice born? | medium | 8612 | Step 1 — Who is the author of Pride and Prejudice? The sources agree on this name: Jane Austen [1][2][3][4]. • Pride and Prejudice is a novel by Engli |
| ✓ | follow-up | Who invented the telephone? → When was he born? | high | 550 | Alexander Graham Bell was born on 3 March 1847. [1] Confirmed in the text of the sources • Alexander Graham Bell (born Alexander Bell; March 3, 1847 – |
| ✓ | follow-up | What is the capital of Nepal? → What is the population there? | medium | 2694 | Kathmandu has a population of 845,767 (as of 2021). [1] Related passages • As per the 2021 Nepal census, it has a population of 845,767 residing in 10 |
| ✓ | follow-up | Why do stars shine? → Explain the answer more simply. | high | 470 | A star shines for most of its active life due to the thermonuclear fusion of hydrogen into helium in its core. [1] In more detail • The missing mass i |
| ✓ | ambiguous | Compare these two programming languages. | none | 15 | Which programming languages would you like me to compare? Name them — for example “Compare Python and Rust”. |
| ✓ | ambiguous | What is Mercury? | high | 2341 | Preeminent is mercury(II) sulfide, HgS, which occurs in nature as the ore cinnabar and is the brilliant pigment vermilion. [1] Key points • Mercury is |
| ✓ | ambiguous | When was he born? | none | 2 | I’m not sure what “he” refers to — there is nothing earlier in this conversation it could point to. Could you name it? |
| ✓ | conflicting | Who invented the telephone? | high | 359 | Discoverer or inventor of telephone: Alexander Graham Bell, Johann Philipp Reis, Antonio Meucci and Elisha Gray. [1] Of these, Alexander Graham Bell i |
| ✓ | conflicting | Was Alexander Graham Bell the first person to invent the telephone? | medium | 3951 | The sources describe this as disputed or qualified rather than a simple yes or no: • Alexander Graham Bell (born Alexander Bell; March 3, 1847 – Augus |
| ✓ | conflicting | Is Pluto a planet? | brain | 1 | No. Pluto is not a planet; it is a dwarf planet. |
| ✓ | unanswerable | What did Zorblax Quimbleton say about the 2031 Mars treaty? | insufficient | 11295 | I could not verify this from the sources I found. Note: The pages I retrieved mention the topic but none of them addresses this question directly. Clo |
| ✓ | unanswerable | What is the phone number of the owner of the blue house on Elm Street in Springfield? | insufficient | 4405 | I could not verify this from the sources I found. Note: The pages I retrieved mention the topic but none of them addresses this question directly. |
| ✓ | unanswerable | Who will win the 2040 World Cup? | insufficient | 1819 | I could not verify this from the sources I found. Note: I cannot predict the future, and none of the pages I retrieved makes a statement about 2040. C |
