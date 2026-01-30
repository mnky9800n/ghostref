# GhostRef 👻

**Hunt hallucinated citations in academic papers.**

🌐 **Try it:** https://mnky9800n.github.io/ghostref/

## What It Does

Upload a PDF → Extract citations → Verify against CrossRef → See what's real and what's hallucinated.

100% client-side. Your PDF never leaves your browser.

## Why

LLMs make up citations that sound real but don't exist. NeurIPS 2025 had 100+ hallucinated citations across 51 papers.

GhostRef catches them.

## How It Works

1. Extracts text from your PDF
2. Finds the references section
3. Looks up each citation in CrossRef (by DOI, title, or author)
4. Shows you what verified and what didn't

## License

MIT
