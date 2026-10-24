AY 2026-27. Sources are the Income Tax Department downloads page: https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns. The schemas are unchanged and used by the field mapping tests. Validation PDFs are read outside the repository and are not committed.

ITR-1_2026_Main_V1.1.json: source https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-06/ITR-1_2026_Main_V1.1.json; fetched 24 Oct 2026; SHA-256 6a0ef9f64065431879dcc724869d8455a640bcf11279d1818eb19f11448ce763.

ITR-2_2026_Main_V1.2.json: source https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-08/ITR-2_2026_Main_V1.2.json; fetched 24 Oct 2026; SHA-256 4e34389cb1cb1a0d9261fc6db8594d9bdfaf761f13d4af6b84c1862510e2aeeb.

ITR-3_2026_Main_V1.1.json: source https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-07/ITR-3_2026_Main_V1.1.json; fetched 24 Oct 2026; SHA-256 66f4bd705e0e0788fdacb37eb297ace56749d791b84f2f170f4da84236c25e8b.

ITR-4_2026_Main_V1.1.json: source https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-07/ITR-4_2026_Main_V1.1.json; fetched 24 Oct 2026; SHA-256 5e9af50083ad92faa684a02ae51693189b43df16b92c1da5a184026fc5cdc2ac.

ITR-5_2026_Main_V1.1.json: source https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-08/ITR-5_2026_Main_V1.1.json; fetched 24 Oct 2026; SHA-256 3bb5f158f63556c3b91706de2901dba7e4c71039e12ec7a181c4dfc96fead6a9.

ITR-6_2026_Main_V1.0.json: source https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-08/ITR-6_2026_Main_V1.0.json; fetched 24 Oct 2026; SHA-256 15fb24266820944b0ca69b16f35459eea75bdb21f653e5e07e3400d16ed83e6a.

itr1-rules.pdf: source https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-05/CBDT_e-Filing_ITR%201_Validation%20Rules_AY%202026-27.pdf; fetched 24 Oct 2026; SHA-256 fd0e447af6c0a6ed43c29697722c4d469f42d5e7a0bad54e21bd4600803a100a. Not committed.

itr2-rules.pdf: source https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-05/CBDT__e-Filing_ITR%202_Validation%20Rules_AY%202026-27_V1.0.pdf; fetched 24 Oct 2026; SHA-256 2321c5ba2469d3c9eaeee40d906b99abe56176782d547e6d0ec09ffdb529550b. Not committed.

itr3-rules.pdf: source https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-06/CBDT_e-filing_ITR-3_Validation%20Rules_V1.0_AY%2026-27.pdf; fetched 24 Oct 2026; SHA-256 60334e821eef769b1af2826b7e8ca2f1aeb76b302886473ed5fec6a0b7cc9d5d. Not committed.

itr4-rules.pdf: source https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-05/CBDT_e-Filing_ITR%204_Validation%20Rules_AY%202026-27.pdf; fetched 24 Oct 2026; SHA-256 769a8f71aa22c4f9a9e052006e8423a78c4cb130d33088fcdfdeaca9aae126f4. Not committed.

itr5-rules.pdf: source https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-07/CBDT_e-Filing_ITR-5_Validation%20Rules_V1.0_AY%2026-27.pdf; fetched 24 Oct 2026; SHA-256 172353a9614c03fe787fbec95f5fb83b9cdc26ed6b60d0cdefde119f03a7f9d9. Not committed.

itr6-rules.pdf: source https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-08/CBDT__e-Filing_ITR-6_Validation%20Rules_Version%201.0_AY%202026-27.pdf; fetched 24 Oct 2026; SHA-256 e48fd81e61b238437d1856e8d342fb49f3b17f3708b2aabf70620cdd268a406d. Not committed.

Draft contract: form_code ITR, period_key 2026 means AY 2026-27, and registration is the client PAN registration. Use src/lib/itr-fields.ts names. Replace each * with a zero based row index and keep one stable row per source entry. A total and its detail lines are not separate credits to add together. A credit reported by 26AS or AIS is not automatically eligible or claimed. Imported figures remain pending until checked. A missing mapping means the form does not support that field here, never a zero or a substitute.

This step defines names only. No return is generated and no validation PDF calculation is claimed as implemented yet. Output builders, typed figures and the prepared form extension follow separately.
