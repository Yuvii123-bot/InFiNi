# Intelligence benchmark — 2026-11-12T06:05Z

Version 2.0.0 · depth: balanced · 36 items · scoring by automatic proxies (see bench/intelligence.js) · Wikimedia contact configured: true

Answered by the built-in brain without a search (no citations by design; left out of the retrieval columns): “Is Pluto a planet?”.

| Category | n | understanding | queries | sources | extraction | support | citations | hallucination | uncertainty | usefulness | avg ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| factual | 3 | 100% | 100% | 100% | 76% | 100% | 100% | 100% | 100% | 100% | 3997 |
| current | 3 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 2942 |
| science | 3 | 100% | 100% | 100% | 76% | 100% | 100% | 100% | 100% | 100% | 3347 |
| history | 3 | 100% | 100% | 83% | 73% | 100% | 78% | 100% | 100% | 100% | 2327 |
| technology | 3 | 100% | 100% | 100% | 87% | 100% | 100% | 100% | 100% | 100% | 2615 |
| programming | 3 | 100% | 100% | 92% | 86% | 100% | 100% | 100% | 100% | 100% | 2763 |
| comparison | 3 | 100% | 100% | 92% | 82% | 100% | 100% | 100% | 100% | 100% | 4193 |
| multi-hop | 3 | 100% | 96% | 100% | 72% | 100% | 100% | 100% | 100% | 60% | 5823 |
| follow-up | 3 | 100% | 100% | 92% | 72% | 100% | 100% | 100% | 100% | 100% | 1090 |
| ambiguous | 3 | 100% | 100% | 100% | 95% | 100% | 95% | 100% | 100% | 87% | 1360 |
| conflicting | 3 | 100% | 100% | 100% | 69% | 100% | 100% | 100% | 100% | 100% | 689 |
| unanswerable | 3 | 100% | 77% | 100% | 89% | 100% | 100% | 100% | 100% | 100% | 2677 |
| **overall** | 36 | **100%** | **98%** | **96%** | **82%** | **100%** | **98%** | **100%** | **100%** | **96%** | 2819 |

## Items

| ✓ | Category | Question | Confidence | ms | Start of answer |
|---|---|---|---|---|---|
| ✓ | factual | What is the capital of Nepal? | high | 3134 | The capital of Nepal is Kathmandu. [1] Confirmed in the text of the sources • The capital, Kathmandu, nicknamed the "City of temples", is the largest  |
| ✓ | factual | Who wrote Pride and Prejudice? | high | 4891 | Pride and Prejudice was written by Jane Austen. [1] Confirmed in the text of the sources • Pride and Prejudice is a novel by English author Jane Auste |
| ✓ | factual | How tall is Mount Everest? | high | 3966 | Elevation above sea level of Mount Everest: 8,848.86 metre. [1] Confirmed in the text of the sources • Mount Everest is 8,848.86 metres (29,031.7 feet |
| ✓ | current | What happened in Nepal today? | high | 2847 | These are the main stories about Nepal that news publishers reported in the last 24 hours (checked 12 November 2026, 06:04 UTC): • 10 killed, five inj |
| ✓ | current | Who is the president of Nepal? | low | 3520 | The head of state of Nepal is Ram Chandra Poudel. [1] Related passages • Ram Chandra Poudel (born October 6, 1944, in Tanahun District, Nepal) is the  |
| ✓ | current | Latest news about artificial intelligence | medium | 2458 | These are the main stories about artificial intelligence that news publishers reported in the last 7 days (checked 12 November 2026, 06:04 UTC): • The |
| ✓ | science | Why do stars shine? | high | 1734 | The production of energy at the core is the reason stars shine so brightly: every time two or more atomic nuclei fuse together to form a single atomic |
| ✓ | science | Why is the sky blue? | high | 2297 | The daytime sky appears blue because air molecules scatter shorter wavelengths of sunlight more than longer ones (redder light). The night sky appears |
| ✓ | science | How does photosynthesis work? | high | 6011 | Photosynthesis is a system of biological processes by which photopigment-bearing autotrophic organisms, such as most plants, algae and cyanobacteria,  |
| ✓ | history | When did World War II end? | medium | 1899 | The sources agree on this date: 2 September 1945 [1]. • World War II, fought from 1939 to 1945, was the deadliest war in history and involved more tha |
| ✓ | history | Who was the first person to walk on the Moon? | high | 2546 | The sources agree on this name: Neil Armstrong [1][2][3]. • Neil Armstrong was the first human to walk on the moon on July 20, 1969, during NASA’s Apo |
| ✓ | history | Why did the Roman Empire fall? | medium | 2535 | The Migration Period, involving large invasions by Germanic peoples and the Huns, led to the decline of the Western Roman Empire. [1] With the fall of |
| ✓ | technology | What is quantum computing? | high | 2156 | A quantum computer is a computer that represents and processes information using quantum states. [1] Quantum computations exploit phenomena such as su |
| ✓ | technology | How does a blockchain work? | high | 2937 | A blockchain is a distributed ledger with growing lists of records (blocks) that are securely linked together via cryptographic hashes. [1] Each block |
| ✓ | technology | What is the difference between TCP and UDP? | high | 2753 | • TCP: The Transmission Control Protocol (TCP) is one of the main protocols of the Internet protocol suite, providing reliable, ordered, and error-che |
| ✓ | programming | How to remove duplicates from an array in JavaScript? | medium | 2389 | Steps — from Built In (“How to Remove Duplicates From JavaScript Arrays: 7 Methods…”) 1. Filter Method: The `filter` method creates a new array of ele |
| ✓ | programming | What does the map method do in JavaScript? | high | 3209 | The `map` method of `Array` instances creates a new array populated with the results of calling a provided function on every element in the calling ar |
| ✓ | programming | How do I reverse a string in Python? | medium | 2690 | s = 'Python' #initial string reversed=''.join(reversed(s)) #.join method merges all of the characters resulting from the reversed iteration into a new |
| ✓ | comparison | Compare Python and Rust | medium | 3143 | • Python: Python is a high-level, general-purpose programming language that emphasizes code readability, simplicity, and ease-of-writing with the use  |
| ✓ | comparison | What is the difference between a virus and a bacterium? | medium | 4909 | • Virus: A virus is a submicroscopic infectious agent that replicates only inside the living cells of an organism. [1] / virus / Bacteria Instance of  |
| ✓ | comparison | Compare the Atlantic Ocean and the Pacific Ocean | medium | 4528 | • Atlantic Ocean: The Atlantic Ocean is the second largest of the world's five oceans, with an area of about 85,133,000 square kilometers (32,870,000  |
| ✓ | multi-hop | Who invented the telephone and when was he born? | high | 5845 | Step 1 — Who invented the telephone? Discoverer or inventor of telephone: Alexander Graham Bell, Johann Philipp Reis, Elisha Gray and Antonio Meucci.  |
| ✓ | multi-hop | What is the population of the capital of Nepal? | medium | 4321 | Step 1 — What is the capital of Nepal? The capital of Nepal is Kathmandu. [1] Confirmed in the text of the sources • The capital, Kathmandu, nicknamed |
| ✓ | multi-hop | When was the author of Pride and Prejudice born? | medium | 7302 | Step 1 — Who is the author of Pride and Prejudice? The sources agree on this name: Jane Austen [1][2][3]. • Pride and Prejudice is a novel by English  |
| ✓ | follow-up | Who invented the telephone? → When was he born? | high | 615 | Alexander Graham Bell was born on 3 March 1847. [1] Confirmed in the text of the sources • Alexander Graham Bell (born Alexander Bell; March 3, 1847 – |
| ✓ | follow-up | What is the capital of Nepal? → What is the population there? | medium | 2263 | Kathmandu has a population of 845,767 (as of 2021). [1] Related passages • As per the 2021 Nepal census, it has a population of 845,767 residing in 10 |
| ✓ | follow-up | Why do stars shine? → Explain the answer more simply. | high | 391 | A star shines for most of its active life due to the thermonuclear fusion of hydrogen into helium in its core. [1] In more detail • On the large scale |
| ✓ | ambiguous | Compare these two programming languages. | none | 6 | Which programming languages would you like me to compare? Name them — for example “Compare Python and Rust”. |
| ✓ | ambiguous | What is Mercury? | high | 4068 | Tracking liquid mercury away from the site of a spill is a major concern in liquid mercury spills; regulations emphasize containment of the visible me |
| ✓ | ambiguous | When was he born? | none | 6 | I’m not sure what “he” refers to — there is nothing earlier in this conversation it could point to. Could you name it? |
| ✓ | conflicting | Who invented the telephone? | high | 258 | Discoverer or inventor of telephone: Alexander Graham Bell, Johann Philipp Reis, Elisha Gray and Antonio Meucci. [1] Of these, Alexander Graham Bell i |
| ✓ | conflicting | Was Alexander Graham Bell the first person to invent the telephone? | medium | 1808 | The sources describe this as disputed or qualified rather than a simple yes or no: • Alexander Graham Bell (born Alexander Bell; March 3, 1847 – Augus |
| ✓ | conflicting | Is Pluto a planet? | brain | 2 | No. Pluto is not a planet; it is a dwarf planet. |
| ✓ | unanswerable | What did Zorblax Quimbleton say about the 2031 Mars treaty? | insufficient | 3045 | I could not verify this from the sources I found. Note: The pages I retrieved mention the topic but none of them addresses this question directly. Clo |
| ✓ | unanswerable | What is the phone number of the owner of the blue house on Elm Street in Springfield? | insufficient | 2501 | I could not verify this from the sources I found. Note: The pages I retrieved mention the topic but none of them addresses this question directly. |
| ✓ | unanswerable | Who will win the 2040 World Cup? | insufficient | 2486 | I could not verify this from the sources I found. Note: I cannot predict the future, and none of the pages I retrieved makes a statement about 2040. C |
