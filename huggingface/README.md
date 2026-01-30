---
title: CitationLint
emoji: 📚
colorFrom: purple
colorTo: blue
sdk: gradio
sdk_version: 4.44.0
app_file: app.py
pinned: false
license: mit
short_description: Verify academic paper citations against CrossRef
---

# CitationLint 📚✓

Verify academic paper citations by checking DOIs against CrossRef.

**Problem:** NeurIPS 2025 had 100+ hallucinated citations across 51 papers. LLMs make up references.

**Solution:** Upload PDF → extract DOIs → verify each against CrossRef → get report.

## Features

- PDF text extraction with pdfplumber
- Smart DOI detection (multiple patterns, focuses on References section)
- CrossRef verification
- Parallel processing for speed

## Usage

1. Upload a PDF
2. Click "Verify Citations"
3. Review the report showing valid, invalid, and unverifiable citations

## Limitations

- Scanned/image PDFs won't work (no OCR)
- Some older papers don't have DOIs
- CrossRef may not have all publications (especially non-English)

---

Built to catch hallucinated citations 💀🔥
