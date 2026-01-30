# CitationLint MVP - Sub-Agent Build Plan

## Overview
Build a citation verification tool that checks if DOIs in academic papers actually resolve to real publications.

**Problem:** NeurIPS 2025 had 100+ hallucinated citations across 51 papers. LLMs make up references.

**Solution:** Upload PDF → extract citations → verify each DOI via CrossRef → report results.

---

## Phase 1: Core Engine (Do This First)

### 1.1 Project Setup
```bash
cd ~/clawd/projects/citationlint
python -m venv venv
source venv/bin/activate
pip install requests pypdf2 pdfplumber regex fastapi uvicorn
```

Create structure:
```
citationlint/
├── src/
│   ├── __init__.py
│   ├── extractor.py    # PDF → citations
│   ├── verifier.py     # DOI → CrossRef lookup
│   └── api.py          # FastAPI endpoints
├── tests/
├── requirements.txt
└── README.md
```

### 1.2 DOI Verifier (`src/verifier.py`)
- Use CrossRef API: `https://api.crossref.org/works/{doi}`
- Add polite header: `mailto:john@example.com` (gets you in the "polite pool" - faster)
- Return: exists (bool), metadata (title, authors, year), or error
- Handle rate limiting (50 req/sec for polite pool)

```python
# Key function signature
def verify_doi(doi: str) -> dict:
    """
    Returns:
    {
        "doi": "10.1234/example",
        "valid": True/False,
        "metadata": {...} or None,
        "error": None or "error message"
    }
    """
```

### 1.3 Citation Extractor (`src/extractor.py`)
- Parse PDF with pdfplumber (better than PyPDF2 for text extraction)
- Find References/Bibliography section
- Extract DOIs using regex: `10\.\d{4,}/[^\s]+`
- Also try to match citation text patterns for non-DOI refs

```python
# Key function signatures
def extract_text_from_pdf(pdf_path: str) -> str
def find_references_section(text: str) -> str
def extract_dois(text: str) -> list[str]
def extract_citations(pdf_path: str) -> list[dict]  # main entry point
```

### 1.4 Basic CLI Test
```python
# test_cli.py
if __name__ == "__main__":
    from src.extractor import extract_citations
    from src.verifier import verify_doi
    
    citations = extract_citations("test_paper.pdf")
    for c in citations:
        if c.get("doi"):
            result = verify_doi(c["doi"])
            print(f"{c['doi']}: {'✓' if result['valid'] else '✗'}")
```

---

## Phase 2: Web API

### 2.1 FastAPI Backend (`src/api.py`)
```python
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse

app = FastAPI(title="CitationLint")

@app.post("/verify")
async def verify_paper(file: UploadFile = File(...)):
    """Upload PDF, return verification report"""
    # Save temp file
    # Extract citations
    # Verify each DOI
    # Return report

@app.get("/verify-doi/{doi:path}")
async def verify_single_doi(doi: str):
    """Verify a single DOI"""
```

### 2.2 Response Format
```json
{
    "filename": "paper.pdf",
    "total_citations": 45,
    "dois_found": 38,
    "verified": 35,
    "failed": 3,
    "not_found": 7,
    "results": [
        {
            "citation_number": 1,
            "doi": "10.1234/example",
            "valid": true,
            "title": "Actual Paper Title",
            "authors": ["Smith, J.", "Doe, A."],
            "year": 2023
        },
        {
            "citation_number": 2,
            "doi": "10.9999/hallucinated",
            "valid": false,
            "error": "DOI not found in CrossRef"
        }
    ]
}
```

---

## Phase 3: Simple Frontend (Optional for MVP)

### 3.1 Minimal HTML Upload
- Single page with drag-drop file upload
- Shows results in a table
- Highlight failures in red
- Could use HTMX for simplicity (no JS framework needed)

---

## Technical Notes

### CrossRef API
- Base URL: `https://api.crossref.org/works/`
- No API key needed!
- Polite pool: Add `?mailto=your@email.com` or header `User-Agent: CitationLint (mailto:your@email.com)`
- Rate limit: ~50/sec polite, lower without
- Docs: https://api.crossref.org/swagger-ui/index.html

### DOI Regex
```python
DOI_PATTERN = r'10\.\d{4,9}/[-._;()/:A-Z0-9]+'
```

### Edge Cases to Handle
- DOIs with special characters (parentheses, semicolons)
- DOIs split across lines in PDF
- References without DOIs (just note as "unverifiable")
- PDF text extraction failures (scanned images)
- CrossRef timeouts/errors

---

## Success Criteria
1. Can upload a PDF and get back a JSON report
2. Correctly identifies valid vs invalid DOIs
3. Handles at least 90% of standard academic PDFs
4. Responds in <30 seconds for typical paper (50 refs)

---

## Test With
- A known good paper from arXiv (has valid DOIs)
- Manually insert a fake DOI to verify detection
- Try one of the NeurIPS papers with hallucinated refs if available

---

## Commands to Run After Completion
```bash
# Test the API
uvicorn src.api:app --reload --port 8000

# Test endpoint
curl -X POST "http://localhost:8000/verify" -F "file=@test_paper.pdf"
```

---

*Plan created by Kate 💀🔥 for sub-agent execution*
