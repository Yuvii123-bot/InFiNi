# Intelligence benchmark — 2026-11-13T01:14Z

Version 3.0.0 · depth: auto · 36 items · scoring by automatic proxies (see bench/intelligence.js) · Wikimedia contact configured: true

Answered by the built-in brain without a search (no citations by design; left out of the retrieval columns): “Is Pluto a planet?”.

| Category | n | understanding | queries | sources | extraction | support | citations | hallucination | uncertainty | usefulness | avg ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| factual | 3 | 100% | 100% | 92% | 73% | 100% | 100% | 100% | 100% | 100% | 3862 |
| current | 3 | 100% | 100% | 100% | 93% | 100% | 100% | 100% | 100% | 100% | 3173 |
| science | 3 | 100% | 100% | 100% | 71% | 100% | 100% | 100% | 100% | 100% | 3264 |
| history | 3 | 100% | 100% | 92% | 81% | 100% | 78% | 100% | 100% | 100% | 2763 |
| technology | 3 | 100% | 100% | 100% | 92% | 100% | 100% | 100% | 100% | 100% | 2324 |
| programming | 3 | 100% | 100% | 100% | 86% | 100% | 100% | 100% | 100% | 100% | 2158 |
| comparison | 3 | 100% | 100% | 92% | 75% | 100% | 100% | 100% | 100% | 100% | 3626 |
| multi-hop | 3 | 100% | 96% | 92% | 75% | 100% | 100% | 100% | 100% | 60% | 7069 |
| follow-up | 3 | 100% | 100% | 92% | 62% | 100% | 100% | 100% | 100% | 100% | 1038 |
| ambiguous | 3 | 100% | 100% | 100% | 95% | 100% | 100% | 100% | 100% | 100% | 627 |
| conflicting | 3 | 100% | 100% | 100% | 71% | 100% | 100% | 100% | 100% | 100% | 835 |
| unanswerable | 3 | 100% | 65% | 100% | 94% | 100% | 100% | 100% | 100% | 100% | 5684 |
| **overall** | 36 | **100%** | **97%** | **96%** | **81%** | **100%** | **98%** | **100%** | **100%** | **97%** | 3035 |

## Items

| ✓ | Category | Question | Confidence | ms | Start of answer |
|---|---|---|---|---|---|
| ✓ | factual | What is the capital of Nepal? | medium | 3373 | The capital of Nepal is Kathmandu. [1] Confirmed in the text of the sources • Kathmandu served as the royal capital of the Kingdom of Nepal and is hom |
| ✓ | factual | Who wrote Pride and Prejudice? | high | 4183 | Pride and Prejudice was written by Jane Austen. [1] Confirmed in the text of the sources • Pride and Prejudice is a novel by English author Jane Auste |
| ✓ | factual | How tall is Mount Everest? | high | 4030 | Elevation above sea level of Mount Everest: 8,848.86 metre. [1] Confirmed in the text of the sources • Mount Everest is 8,848.86 metres (29,031.7 feet |
| ✓ | current | What happened in Nepal today? | high | 3272 | These are the main stories about Nepal that news publishers reported in the last 24 hours (checked 13 November 2026, 01:13 UTC): • Death toll in Makwa |
| ✓ | current | Who is the president of Nepal? | low | 3432 | The head of state of Nepal is Ram Chandra Poudel. [1] Related passages • Ram Chandra Poudel (born October 6, 1944, in Tanahun District, Nepal) is the  |
| ✓ | current | Latest news about artificial intelligence | medium | 2816 | These are the main stories about artificial intelligence that news publishers reported in the last 7 days (checked 13 November 2026, 01:13 UTC): • The |
| ✓ | science | Why do stars shine? | high | 2070 | A star shines for most of its active life due to the thermonuclear fusion of hydrogen into helium in its core. [1] This process releases energy that t |
| ✓ | science | Why is the sky blue? | high | 2233 | The daytime sky appears blue because air molecules scatter shorter wavelengths of sunlight more than longer ones (redder light). [1] In more detail •  |
| ✓ | science | How does photosynthesis work? | high | 5489 | Photosynthesis is a system of biological processes by which photopigment-bearing autotrophic organisms, such as most plants, algae and cyanobacteria,  |
| ✓ | history | When did World War II end? | high | 2765 | The sources agree on this date: 2 September 1945 [1][2]. • World War II, fought from 1939 to 1945, was the deadliest war in history and involved more  |
| ✓ | history | Who was the first person to walk on the Moon? | high | 3424 | The sources agree on this name: Neil Armstrong [1][2][3]. • Neil Armstrong was the first human to walk on the moon on July 20, 1969, during NASA’s Apo |
| ✓ | history | Why did the Roman Empire fall? | medium | 2100 | The Migration Period, involving large invasions by Germanic peoples and the Huns, led to the decline of the Western Roman Empire. [1] With the fall of |
| ✓ | technology | What is quantum computing? | high | 2304 | A quantum computer is a computer that represents and processes information using quantum states. [1] Quantum computations exploit phenomena such as su |
| ✓ | technology | How does a blockchain work? | high | 2270 | A blockchain is a distributed ledger with growing lists of records (blocks) that are securely linked together via cryptographic hashes. [1] How it wor |
| ✓ | technology | What is the difference between TCP and UDP? | high | 2399 | • TCP: The Transmission Control Protocol (TCP) is one of the main protocols of the Internet protocol suite, providing reliable, ordered, and error-che |
| ✓ | programming | How to remove duplicates from an array in JavaScript? | medium | 1866 | Steps — from Built In (“How to Remove Duplicates From JavaScript Arrays: 7 Methods…”) 1. Filter Method: The `filter` method creates a new array of ele |
| ✓ | programming | What does the map method do in JavaScript? | high | 2720 | The `map` method of `Array` instances creates a new array populated with the results of calling a provided function on every element in the calling ar |
| ✓ | programming | How do I reverse a string in Python? | medium | 1888 | Using a Loop: You can iterate through the string in reverse order using a loop and build the reversed string manually. [1] Example code — from Stack O |
| ✓ | comparison | Compare Python and Rust | medium | 3882 | • Python: Python is a high-level, general-purpose programming language that emphasizes code readability, simplicity, and ease-of-writing with the use  |
| ✓ | comparison | What is the difference between a virus and a bacterium? | medium | 1686 | • Virus: A virus is a submicroscopic infectious agent that replicates only inside the living cells of an organism. [1] / virus / Bacteria Instance of  |
| ✓ | comparison | Compare the Atlantic Ocean and the Pacific Ocean | medium | 5309 | • Atlantic Ocean: The Atlantic Ocean is the second largest of the world's five oceans, with an area of about 85,133,000 square kilometers (32,870,000  |
| ✓ | multi-hop | Who invented the telephone and when was he born? | high | 7178 | Step 1 — Who invented the telephone? Discoverer or inventor of telephone: Alexander Graham Bell, Johann Philipp Reis, Elisha Gray and Antonio Meucci.  |
| ✓ | multi-hop | What is the population of the capital of Nepal? | medium | 7186 | Step 1 — What is the capital of Nepal? The capital of Nepal is Kathmandu. [1] Confirmed in the text of the sources • Kathmandu served as the royal cap |
| ✓ | multi-hop | When was the author of Pride and Prejudice born? | high | 6842 | Step 1 — Who is the author of Pride and Prejudice? The sources agree on this name: Jane Austen [1][2][3][4]. • Pride and Prejudice is a novel by Engli |
| ✓ | follow-up | Who invented the telephone? → When was he born? | high | 463 | Alexander Graham Bell was born on 3 March 1847. [1] Confirmed in the text of the sources • Alexander Graham Bell (born Alexander Bell; March 3, 1847 – |
| ✓ | follow-up | What is the capital of Nepal? → What is the population there? | medium | 2282 | Kathmandu has a population of 845,767 (as of 2021). [1] Related passages • As per the 2021 Nepal census, it has a population of 845,767 residing in 10 |
| ✓ | follow-up | Why do stars shine? → Explain the answer more simply. | high | 369 | A star shines for most of its active life due to the thermonuclear fusion of hydrogen into helium in its core. [1] In more detail • The missing mass i |
| ✓ | ambiguous | Compare these two programming languages. | none | 12 | Which programming languages would you like me to compare? Name them — for example “Compare Python and Rust”. |
| ✓ | ambiguous | What is Mercury? | high | 1861 | Mercury is the first planet from the Sun and the smallest in the Solar System. [1][2][3] Key points • Elemental or metallic mercury is a shiny, silver |
| ✓ | ambiguous | When was he born? | none | 9 | I’m not sure what “he” refers to — there is nothing earlier in this conversation it could point to. Could you name it? |
| ✓ | conflicting | Who invented the telephone? | high | 332 | Discoverer or inventor of telephone: Alexander Graham Bell, Johann Philipp Reis, Elisha Gray and Antonio Meucci. [1] Of these, Alexander Graham Bell i |
| ✓ | conflicting | Was Alexander Graham Bell the first person to invent the telephone? | medium | 2170 | The sources describe this as disputed or qualified rather than a simple yes or no: • Alexander Graham Bell (born Alexander Bell; March 3, 1847 – Augus |
| ✓ | conflicting | Is Pluto a planet? | brain | 2 | No. Pluto is not a planet; it is a dwarf planet. |
| ✓ | unanswerable | What did Zorblax Quimbleton say about the 2031 Mars treaty? | insufficient | 10835 | I could not verify this from the sources I found. Note: The pages I retrieved mention the topic but none of them addresses this question directly. Clo |
| ✓ | unanswerable | What is the phone number of the owner of the blue house on Elm Street in Springfield? | insufficient | 3955 | I could not verify this from the sources I found. Note: The pages I retrieved mention the topic but none of them addresses this question directly. |
| ✓ | unanswerable | Who will win the 2040 World Cup? | insufficient | 2263 | I could not verify this from the sources I found. Note: I cannot predict the future, and none of the pages I retrieved makes a statement about 2040. C |
