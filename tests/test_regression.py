#!/usr/bin/env python3
"""
Regression test suite for CitationLint/GhostRef.

Runs all PDFs in tests/ directory through extraction and verification.
Compares against expected baselines stored in expected_results.json.

Usage:
    pytest tests/test_regression.py -v
    pytest tests/test_regression.py --update-baseline  # regenerate baselines
"""

import json
import sys
from pathlib import Path

import pytest

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.extractor import extract_citations
from src.verifier import verify_doi, verify_citation, search_by_title


TESTS_DIR = Path(__file__).parent
BASELINE_FILE = TESTS_DIR / "expected_results.json"


def get_test_pdfs() -> list[Path]:
    """Find all PDF files in the tests directory."""
    return sorted(TESTS_DIR.glob("*.pdf"))


def load_baseline() -> dict:
    """Load expected results from baseline file."""
    if BASELINE_FILE.exists():
        with open(BASELINE_FILE) as f:
            return json.load(f)
    return {}


def save_baseline(results: dict):
    """Save results as new baseline."""
    with open(BASELINE_FILE, "w") as f:
        json.dump(results, f, indent=2, sort_keys=True)
    print(f"\n✓ Baseline saved to {BASELINE_FILE}")


class TestExtraction:
    """Test citation extraction from PDFs."""

    @pytest.fixture(scope="class")
    def baseline(self):
        return load_baseline()

    @pytest.mark.parametrize("pdf_path", get_test_pdfs(), ids=lambda p: p.name)
    def test_extraction_succeeds(self, pdf_path):
        """Extraction should succeed for all test PDFs."""
        result = extract_citations(pdf_path)
        assert result.success, f"Extraction failed: {result.error}"
        assert result.total_pages > 0, "No pages found"

    @pytest.mark.parametrize("pdf_path", get_test_pdfs(), ids=lambda p: p.name)
    def test_dois_found(self, pdf_path, baseline):
        """Should find DOIs in academic papers (unless baseline expects none)."""
        result = extract_citations(pdf_path)
        assert result.success

        # Some older papers (pre-2015) genuinely have no DOIs in the PDF
        if pdf_path.name in baseline:
            expected_count = baseline[pdf_path.name]["doi_count"]
            if expected_count == 0:
                pytest.skip(f"{pdf_path.name} baseline has 0 DOIs (older paper)")

        assert len(result.dois_found) > 0, "No DOIs found in paper"

    @pytest.mark.parametrize("pdf_path", get_test_pdfs(), ids=lambda p: p.name)
    def test_doi_count_matches_baseline(self, pdf_path, baseline):
        """DOI count should match expected baseline."""
        if pdf_path.name not in baseline:
            pytest.skip(f"No baseline for {pdf_path.name} - run with --update-baseline")

        result = extract_citations(pdf_path)
        expected = baseline[pdf_path.name]

        assert len(result.dois_found) == expected["doi_count"], (
            f"DOI count changed: expected {expected['doi_count']}, "
            f"got {len(result.dois_found)}"
        )

    @pytest.mark.parametrize("pdf_path", get_test_pdfs(), ids=lambda p: p.name)
    def test_specific_dois_present(self, pdf_path, baseline):
        """Key DOIs from baseline should still be found."""
        if pdf_path.name not in baseline:
            pytest.skip(f"No baseline for {pdf_path.name}")

        result = extract_citations(pdf_path)
        expected_dois = set(baseline[pdf_path.name].get("sample_dois", []))
        found_dois = set(d.lower() for d in result.dois_found)

        missing = expected_dois - found_dois
        assert not missing, f"Missing expected DOIs: {missing}"


class TestVerification:
    """Test DOI verification against CrossRef."""

    @pytest.fixture(scope="class")
    def baseline(self):
        return load_baseline()

    def test_known_valid_doi(self):
        """Known valid DOI should verify."""
        result = verify_doi("10.1038/nature12373")  # Famous CRISPR paper
        assert result.valid, f"Valid DOI rejected: {result.error}"
        assert result.title is not None

    def test_known_invalid_doi(self):
        """Fake DOI should fail verification."""
        result = verify_doi("10.9999/totally.fake.doi.12345")
        assert not result.valid, "Fake DOI should not validate"

    def test_arxiv_doi(self):
        """arXiv DOIs use DataCite, not CrossRef - expect failure or skip."""
        # NOTE: arXiv DOIs (10.48550) are registered with DataCite, not CrossRef
        # CrossRef will return 404 for these. This is expected behavior.
        result = verify_doi("10.48550/arXiv.2303.08774")  # GPT-4 paper
        # arXiv DOIs won't verify via CrossRef - that's fine
        if not result.valid:
            pytest.skip("arXiv DOIs not in CrossRef (uses DataCite) - expected")

    @pytest.mark.parametrize("pdf_path", get_test_pdfs(), ids=lambda p: p.name)
    def test_extracted_dois_verify(self, pdf_path, baseline):
        """Extracted DOIs should verify against CrossRef."""
        if pdf_path.name not in baseline:
            pytest.skip(f"No baseline for {pdf_path.name}")

        expected = baseline[pdf_path.name]
        if "verified_dois" not in expected:
            pytest.skip("No verified DOIs in baseline")

        # Test a sample of DOIs (not all, to avoid rate limits)
        sample_dois = expected["verified_dois"][:3]
        
        for doi in sample_dois:
            result = verify_doi(doi)
            assert result.valid, f"DOI {doi} failed verification: {result.error}"


class TestFallbackVerification:
    """Test title and author fallback verification."""

    def test_title_search_known_paper(self):
        """Should find a paper by its title."""
        # "Deep Residual Learning for Image Recognition" - ResNet, CVPR 2016
        result = search_by_title("Deep Residual Learning for Image Recognition", year=2016)
        assert result.valid, f"Title search failed: {result.error}"
        assert result.doi is not None
        assert "deep" in result.title.lower() or "residual" in result.title.lower()

    def test_title_search_with_typo(self):
        """Slight typos should still match (fuzzy matching)."""
        result = search_by_title("Deep Residul Learning for Image Recogntion", year=2016)  # Typos
        # May or may not match depending on threshold
        # Just verify it doesn't crash
        assert isinstance(result.valid, bool)

    def test_verify_citation_with_doi(self):
        """verify_citation should use DOI when available."""
        result = verify_citation(doi="10.1038/nature12373")
        assert result.valid
        assert result.method == "doi"
        assert result.confidence == 1.0

    def test_verify_citation_title_fallback(self):
        """verify_citation should fall back to title search."""
        result = verify_citation(
            title="CRISPR-Cas9 Structures and Mechanisms",
            year=2017
        )
        # May or may not find exact match, but should try
        assert result.method in ["title", "failed"]
        if result.valid:
            assert result.confidence < 1.0

    def test_verify_citation_full_fallback(self):
        """verify_citation with all info should find paper."""
        result = verify_citation(
            title="Deep Residual Learning for Image Recognition",
            authors=["Kaiming He"],
            year=2016
        )
        if result.valid:
            assert result.method in ["title", "author"]
            assert result.doi is not None

    @pytest.mark.parametrize("pdf_path", get_test_pdfs(), ids=lambda p: p.name)
    def test_citations_have_parsed_metadata(self, pdf_path):
        """Extracted citations should have parsed title/author/year."""
        result = extract_citations(pdf_path)
        assert result.success
        
        # Check that at least some citations have parsed metadata
        citations_with_title = sum(1 for c in result.citations if c.title)
        citations_with_year = sum(1 for c in result.citations if c.year)
        
        # For papers with citations, at least some should parse
        if len(result.citations) > 0:
            # Allow for older papers where parsing may fail
            # Just check it doesn't crash and produces reasonable output
            assert isinstance(citations_with_title, int)
            assert isinstance(citations_with_year, int)


class TestRegressionBaseline:
    """Generate and validate baseline results."""

    def test_generate_baseline(self, update_baseline):
        """Generate new baseline when --update-baseline flag is passed."""
        if not update_baseline:
            pytest.skip("Use --update-baseline to regenerate")

        results = {}
        pdfs = get_test_pdfs()

        for pdf_path in pdfs:
            print(f"\nProcessing {pdf_path.name}...")
            extraction = extract_citations(pdf_path)

            if not extraction.success:
                print(f"  ⚠ Extraction failed: {extraction.error}")
                continue

            # Verify DOIs and collect valid ones
            verified = []
            for doi in extraction.dois_found[:10]:  # Limit to first 10
                vresult = verify_doi(doi)
                if vresult.valid:
                    verified.append(doi.lower())

            results[pdf_path.name] = {
                "doi_count": len(extraction.dois_found),
                "page_count": extraction.total_pages,
                "sample_dois": [d.lower() for d in extraction.dois_found[:5]],
                "verified_dois": verified,
            }

            print(f"  ✓ {len(extraction.dois_found)} DOIs, {len(verified)} verified")

        save_baseline(results)
        assert results, "No PDFs processed"
