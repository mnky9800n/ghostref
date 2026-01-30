# GhostRef 👻

**Hunt hallucinated citations in academic papers.**

> Did your AI ghostwriter make up the references? Find out.

🌐 **Try it now:** [ghostref.com](https://mnky9800n.github.io/ghostref/) (100% client-side, your PDF never leaves your browser)

## The Problem

NeurIPS 2025 had 100+ hallucinated citations across 51 papers. LLMs make up references that sound real but don't exist.

## The Solution

Upload a PDF → Extract citations → Verify against CrossRef → Get a report.

GhostRef uses a fallback verification strategy:
1. **DOI lookup** - Direct verification (highest confidence)
2. **Title search** - Fuzzy matching against CrossRef (high confidence)
3. **Author search** - Search by author + year (medium confidence)

## Quick Start

### Web App (No Install)
Visit [ghostref.com](https://mnky9800n.github.io/ghostref/) - works entirely in your browser.

### Python API

```bash
# Setup
git clone https://github.com/mnky9800n/ghostref.git
cd ghostref
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run API
uvicorn src.api:app --reload --port 8000

# Test
curl -X POST "http://localhost:8000/verify" -F "file=@paper.pdf"
```

### CLI

```bash
python test_cli.py paper.pdf        # Verify a paper
python test_cli.py --test-dois      # Test DOI verification
```

### Run Tests

```bash
./run_tests.sh                      # Run test suite
./run_tests.sh --update-baseline    # Regenerate baselines
```

## Project Structure

```
ghostref/
├── docs/                 # Website (GitHub Pages)
│   ├── index.html
│   ├── app.js
│   └── style.css
├── src/                  # Python backend
│   ├── api.py           # FastAPI endpoints
│   ├── extractor.py     # PDF → citations
│   └── verifier.py      # Citation verification
├── tests/               # Test PDFs + pytest suite
├── test_cli.py          # CLI tool
└── requirements.txt
```

## How It Works

1. **PDF Extraction** - pdfplumber extracts text
2. **Citation Parsing** - Finds References section, extracts DOIs/titles/authors
3. **Verification** - Checks each citation against CrossRef API
4. **Report** - Returns detailed JSON with valid/invalid/error status

## API Endpoints

### `POST /verify`
Upload PDF, get verification report.

### `GET /verify-doi/{doi}`
Verify a single DOI.

### `POST /verify-citation`
Verify by title/author (fallback method).

## Limitations

- Scanned/image PDFs won't work (no OCR)
- Some old papers don't have DOIs
- CrossRef doesn't have everything (especially non-English publications)
- arXiv DOIs use DataCite, not CrossRef

## License

MIT - see [LICENSE](LICENSE)

---

*Built for catching ghost citations* 💀🔥
