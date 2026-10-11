# Medical research and reference library

A static, reusable collection extracted from the Railway app's source at `aibotjock/AI-FM-STUDYCHAT` commit `f4b20414d337230f4d90a3c8a14656c3922f5ff1`. It contains no RAG implementation, embeddings, chunk index, vector database, prompt orchestration, application runtime or dependencies.

## Contents

- [Reference catalogue](references/catalogue.json): **429 unique URLs**, preserving **523 metadata records** and their source-file/topic provenance. Multiple records for one URL are retained where attribution, rights, scope or review dates differ.
- [Source registry](references/source-registry.json): the original **75 research/catalog records**, unchanged.
- [Exact-document reuse policy](references/document-reuse-policy.json): source-repository document assessments, unchanged. These are dated research records, not a blanket license or clinical approval.
- [Research documents](research/docs/source-audit/COMMERCIAL_REFERENCE_RESEARCH.md): **17 documents** covering source research, incorporation status, exact-document licenses, corrections, treatment expansion, educational design, board alignment, coverage and curriculum gaps.

## Reuse without RAG

1. Use source titles, organizations, URLs, subject mappings and dates to build a reference directory. Open references when a learner requests one.
2. Load only the directory metadata needed for the current screen. Keep the research archive out of the browser bundle and normal chat context.
3. Keep ordinary conversation independent of reference availability. A greeting, clarification, study plan or explanation of app behavior must not wait for reference matching.
4. A directory link does not verify a medical claim. If a host reads an exact source when answering, respect its item-specific processing rights and distinguish verified evidence from unverified model knowledge. Admit uncertainty when support is missing; never fabricate citations.
5. Text and voice must both be able to express uncertainty or service failure. A missing reference must not silently suppress an otherwise safe conversational response.

This folder can be copied to a separate repository without any runtime imports or application code. It adds no network call to the chat path by itself. The new app decides when references are needed; this collection does not enforce the old source-gated response pipeline.

## Publisher screening

See [Reference provenance audit](SOURCE_AUDIT.md) for the 2026-10-10 screen of 429 URLs across 94 hostnames. No disreputable publisher was identified; no references were removed on that basis. Selected less familiar sources were checked against primary publisher or issuing-organization pages.

This is a publisher/provenance screen, not a full clinical revalidation. Historical project research is archived separately from the reference directory and must not be presented as independently verified clinical guidance.

## Preservation and limits

The research Markdown is historical project evidence. Some passages describe the earlier RAG design and approval workflow; those passages are not requirements for the rebuild. Original prose is preserved, with links to excluded Markdown documents redirected to the pinned source repository. No general clinical passage corpus or question-bank content is duplicated in this folder.

The original extraction did not recheck links and publisher policies. The subsequent provenance audit checked selected publisher identities; it did not revalidate every article, link, policy or current edition. Review dates, corrections, licensing restrictions, applicability, attribution and approval flags remain as recorded. Public availability and a citation do not establish permission to copy, process or commercially redistribute protected content. No new rights, human clinical approval or accuracy guarantee is granted. Credentials, learner records and saved conversations are excluded.

The question bank and practice engine remain separate from this reference collection. Only import what the consuming app needs.
