gstr2b-v4.5-response-schema.json: source https://developer.gst.gov.in/pages/apiportal/data/Returns/GSTR2B%20-%20Get%20All%20Details/v4.5/GSTR2B%20-%20Get%20All%20Details%20response_schema.json; fetched 21 Oct 2026; SHA-256 3351e86b8309ebe0cd45abcc217951cbb57401c24336a7bbaaaef5d687202e95.

gstr2b-v4.4-response-schema.json: source https://developer.gst.gov.in/pages/apiportal/data/Returns/GSTR2B%20-%20Get%20All%20Details/v4.4/GSTR2B%20-%20Get%20All%20Details%20response_schema.json; fetched 21 Oct 2026; SHA-256 80ef571df18bee03c302af7e1957ecb1d0ae35d21dc14ac96a745f044f42b000.

gstr2a-v2.3-response-schema.json: source https://developer.gst.gov.in/pages/apiportal/data/Returns/GSTR2A%20-%20Get%20B2B%20Invoices/v2.3/GSTR2A%20-%20Get%20B2B%20Invoices%20response_schema.json; fetched 21 Oct 2026; SHA-256 2b2e698870db2cd4a9826f09ad9ddec07abb507d268141252352e80f8c6972f0.

These are unchanged public GSTN schemas. The GSTR-2A file covers the B2B API response only, not a whole portal download. No taxpayer API was called. The source links came from the public Returns documentation at https://developer.gst.gov.in/apiportal/taxpayer/returns.

Still needed: a complete official GSTR-2A download layout with its own taxpayer and month, and the GSTR-2A and GSTR-2B Excel layouts from https://www.gst.gov.in/ after sign in, Returns dashboard, Download. The public matching tool's purchase register is not a GSTR-2B download layout.

For Form 26AS, fetch the text download layout from TRACES through https://www.tdscpc.gov.in/ and its current official instructions. The public conversion guide establishes a caret delimiter but not every record field. For AIS and TIS, fetch the current JSON and digital text PDF layouts and instructions through https://www.incometax.gov.in/iec/foportal/ and the AIS portal after sign in. Provide official blank layouts or replace every taxpayer value in a sample before it is used here. No live taxpayer file belongs in this repository. These readers and one-time password handling stay unimplemented until those structures can be verified.


gstr1-v4.0-request-schema.json: source https://developer.gst.gov.in/pages/apiportal/data/Returns/GSTR1%20-%20Save%20GSTR1%20data/v4.0/GSTR1%20-%20Save%20GSTR1%20data%20request_schema.json; fetched 21 Oct 2026; SHA-256 fa756cbe69a4690688b5bab9ffa9705db47e88c337cd0484de56ebb77d53776a. The source file is unchanged.

gstr1-v5.0-request-schema.json: source https://developer.gst.gov.in/pages/apiportal/data/Returns/GSTR1%20-%20Save%20GSTR1%20data/v5.0/GSTR1%20-%20Save%20GSTR1%20data%20request_schema.json; fetched 21 Oct 2026; SHA-256 51c7381fb50688a8b1796dabe0ec57d85da06be4287ed61f50c592cfdf2ca1e5. The source file is unchanged.

gstr3b-v7.1-request-schema.json: source https://developer.gst.gov.in/pages/apiportal/data/Returns/GSTR3B%20-%20Save%20GSTR3B%20data/v7.1/GSTR3B%20-%20Save%20GSTR3B%20data%20request_schema.json; fetched 21 Oct 2026; SHA-256 043917ea6fcbe34e97e851fde6cfe9a472aaefb2be503e9438973b16e67480ae. The source file is unchanged.

The public GSTR-3B version list labels v7.1, v7.0 and v6.0 as Draft. No tax-period start is inferred from an API publication date. The GSTR-3B library entry stays draft and cannot produce a filing file. Needed: the current published offline JSON layout or its official final schema and period applicability from https://www.gst.gov.in/download/returns. The public Excel utility is available, but its macro-generated JSON has not been independently verified. No macro is executed here.

gstr3b-versions.json: unchanged public response from POST https://developer.gst.gov.in/apiportal/getAPIVersion with body {"apiId":2269}; fetched 21 Oct 2026; SHA-256 e41b250dc9cd4e29552f902dab9a3c42f872450ca3026671fe9f73ad903eb570. No sign in or taxpayer API was used.
