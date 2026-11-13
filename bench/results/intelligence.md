# Intelligence benchmark — 2026-11-13T02:31Z

Version 3.1.0 · depth: auto · 36 items · scoring by automatic proxies (see bench/intelligence.js) · Wikimedia contact configured: true

Answered by the built-in brain without a search (no citations by design; left out of the retrieval columns): “Is Pluto a planet?”.

| Category | n | understanding | queries | sources | extraction | support | citations | hallucination | uncertainty | usefulness | avg ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| factual | 3 | 100% | 100% | 100% | 90% | 100% | 100% | 100% | 100% | 100% | 4202 |
| current | 3 | 100% | 100% | 92% | 100% | 100% | 100% | 100% | 100% | 100% | 3946 |
| science | 3 | 100% | 100% | 100% | 90% | 100% | 100% | 100% | 100% | 100% | 3397 |
| history | 3 | 100% | 100% | 100% | 100% | 100% | 92% | 100% | 100% | 100% | 3770 |
| technology | 3 | 100% | 100% | 100% | 87% | 100% | 95% | 100% | 100% | 100% | 3083 |
| programming | 3 | 100% | 100% | 100% | 96% | 100% | 100% | 100% | 100% | 87% | 3265 |
| comparison | 3 | 100% | 100% | 92% | 88% | 100% | 100% | 100% | 100% | 100% | 2364 |
| multi-hop | 3 | 100% | 96% | 100% | 91% | 100% | 100% | 100% | 100% | 60% | 4884 |
| follow-up | 3 | 100% | 100% | 92% | 95% | 100% | 100% | 100% | 100% | 100% | 1268 |
| ambiguous | 3 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 880 |
| conflicting | 3 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 980 |
| unanswerable | 3 | 100% | 64% | 100% | 92% | 100% | 100% | 100% | 100% | 100% | 4758 |
| **overall** | 36 | **100%** | **97%** | **98%** | **94%** | **100%** | **99%** | **100%** | **100%** | **96%** | 3066 |

## Items

| ✓ | Category | Question | Confidence | ms | Start of answer |
|---|---|---|---|---|---|
| ✓ | factual | What is the capital of Nepal? | high | 4067 | The capital of Nepal is Kathmandu. [1] Confirmed in the text of the sources • The capital, Kathmandu, nicknamed the "City of temples", is the largest  |
| ✓ | factual | Who wrote Pride and Prejudice? | high | 4442 | Pride and Prejudice was written by Jane Austen. [1] Confirmed in the text of the sources • According to family tradition, Jane Austen began writing Fi |
| ✓ | factual | How tall is Mount Everest? | high | 4097 | Elevation above sea level of Mount Everest: 8,848.86 metre. [1] Confirmed in the text of the sources • “The new height of Mt Everest is 8,848.86 metre |
| ✓ | current | What happened in Nepal today? | high | 3406 | These are the main stories about Nepal that news publishers reported in the last 24 hours (checked 13 November 2026, 02:29 UTC): • Death toll in Makwa |
| ✓ | current | Who is the president of Nepal? | medium | 4206 | The head of state of Nepal is Ram Chandra Poudel. [1] Related passages • The current president is Ram Chandra Poudel elected in March 2023. [2] |
| ✓ | current | Latest news about artificial intelligence | medium | 4225 | These are the main stories about artificial intelligence that news publishers reported in the last 7 days (checked 13 November 2026, 02:30 UTC): • The |
| ✓ | science | Why do stars shine? | high | 3244 | A star shines for most of its active life due to the thermonuclear fusion of hydrogen into helium in its core. [1] This process releases energy that t |
| ✓ | science | Why is the sky blue? | high | 5135 | The daytime sky appears blue because air molecules scatter shorter wavelengths of sunlight more than longer ones (redder light). [1] The night sky app |
| ✓ | science | How does photosynthesis work? | high | 1813 | Photosynthesis is a system of biological processes by which photopigment-bearing autotrophic organisms, such as most plants, algae and cyanobacteria,  |
| ✓ | history | When did World War II end? | medium | 4299 | The sources agree on this date: 2 September 1945 [1][2][3]. • Most history books give a simple answer: World War II ended on September 2, 1945, when J |
| ✓ | history | Who was the first person to walk on the Moon? | medium | 3177 | The sources agree on this name: Neil Armstrong [1][2][3]. • At 02:56 GMT on 21 July 1969, American astronaut Neil Armstrong became the first person to |
| ✓ | history | Why did the Roman Empire fall? | medium | 3833 | The Migration Period, involving large invasions by Germanic peoples and the Huns, led to the decline of the Western Roman Empire. [1] With the fall of |
| ✓ | technology | What is quantum computing? | medium | 2949 | A quantum computer is a computer that represents and processes information using quantum states. [1] Quantum computations exploit phenomena such as su |
| ✓ | technology | How does a blockchain work? | medium | 3187 | A blockchain is a distributed ledger with growing lists of records (blocks) that are securely linked together via cryptographic hashes. [1] How it wor |
| ✓ | technology | What is the difference between TCP and UDP? | medium | 3113 | • TCP: The Transmission Control Protocol (TCP) is one of the main protocols of the Internet protocol suite, providing reliable, ordered, and error-che |
| ✓ | programming | How to remove duplicates from an array in JavaScript? | medium | 3670 | Steps — from Softlookup (“Best Practices”) 1. Use `const` by default and `let` when a value must change. [1] 2. Keep functions small and focused on on |
| ✓ | programming | What does the map method do in JavaScript? | high | 2148 | Accordion the MDN documentation, the `map` method creates a new array populated with the results of calling a provided function on every element in th |
| ✓ | programming | How do I reverse a string in Python? | medium | 3978 | Steps — from HCL GUVI Blog (“6 Ways to Reverse a String in Python”) 1. Slicing with `[::-1]`: This is the method most Python developers reach for firs |
| ✓ | comparison | Compare Python and Rust | medium | 2515 | • Python: Python is a high-level, general-purpose programming language that emphasizes code readability, simplicity, and ease-of-writing with the use  |
| ✓ | comparison | What is the difference between a virus and a bacterium? | medium | 2291 | • Virus: A virus is a submicroscopic infectious agent that replicates only inside the living cells of an organism. [1] / virus / Bacteria Instance of  |
| ✓ | comparison | Compare the Atlantic Ocean and the Pacific Ocean | medium | 2287 | • Atlantic Ocean: The Atlantic Ocean is the second largest of the world's five oceans, with an area of about 85,133,000 square kilometers (32,870,000  |
| ✓ | multi-hop | Who invented the telephone and when was he born? | high | 5598 | Step 1 — Who invented the telephone? Discoverer or inventor of telephone: Alexander Graham Bell, Johann Philipp Reis, Antonio Meucci and Elisha Gray.  |
| ✓ | multi-hop | What is the population of the capital of Nepal? | medium | 4291 | Step 1 — What is the capital of Nepal? The capital of Nepal is Kathmandu. [1] Confirmed in the text of the sources • The capital, Kathmandu, nicknamed |
| ✓ | multi-hop | When was the author of Pride and Prejudice born? | high | 4762 | Step 1 — Who is the author of Pride and Prejudice? The sources agree on this name: Jane Austen [1][2][3]. • Pride and Prejudice is a novel by English  |
| ✓ | follow-up | Who invented the telephone? → When was he born? | high | 704 | Alexander Graham Bell was born on 3 March 1847. [1] Confirmed in the text of the sources • Scottish-born American inventor and teacher of the deaf, Al |
| ✓ | follow-up | What is the capital of Nepal? → What is the population there? | medium | 2708 | Kathmandu has a population of 845,767 (as of 2021). [1] Related passages • As per the 2021 Nepal census, it has a population of 845,767 residing in 10 |
| ✓ | follow-up | Why do stars shine? → Explain the answer more simply. | high | 391 | A star shines for most of its active life due to the thermonuclear fusion of hydrogen into helium in its core. [1] In more detail • Planets shine more |
| ✓ | ambiguous | Compare these two programming languages. | none | 8 | Which programming languages would you like me to compare? Name them — for example “Compare Python and Rust”. |
| ✓ | ambiguous | What is Mercury? | high | 2629 | Mercury is the first planet from the Sun and the smallest in the Solar System. [1][2] Key points • Mercury is the innermost planet of the solar system |
| ✓ | ambiguous | When was he born? | none | 2 | I’m not sure what “he” refers to — there is nothing earlier in this conversation it could point to. Could you name it? |
| ✓ | conflicting | Who invented the telephone? | high | 516 | Discoverer or inventor of telephone: Alexander Graham Bell, Johann Philipp Reis, Antonio Meucci and Elisha Gray. [1] Of these, Alexander Graham Bell i |
| ✓ | conflicting | Was Alexander Graham Bell the first person to invent the telephone? | high | 2419 | The sources describe this as disputed or qualified rather than a simple yes or no: • Alexander Graham Bell (born Alexander Bell; March 3, 1847 – Augus |
| ✓ | conflicting | Is Pluto a planet? | brain | 6 | No. Pluto is not a planet; it is a dwarf planet. |
| ✓ | unanswerable | What did Zorblax Quimbleton say about the 2031 Mars treaty? | insufficient | 8748 | I could not verify this from the sources I found. Note: The pages I retrieved mention the topic but none of them addresses this question directly. Clo |
| ✓ | unanswerable | What is the phone number of the owner of the blue house on Elm Street in Springfield? | insufficient | 1248 | I could not verify this from the sources I found. Note: The pages I retrieved mention the topic but none of them addresses this question directly. Clo |
| ✓ | unanswerable | Who will win the 2040 World Cup? | insufficient | 4279 | I could not verify this from the sources I found. Note: I cannot predict the future, and none of the pages I retrieved makes a statement about 2040. C |
