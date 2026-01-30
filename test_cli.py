#!/usr/bin/env python3
"""
CLI test script for CitationLint.

Usage:
    python test_cli.py <path-to-pdf>
    python test_cli.py --test-dois  # Test DOI verification only
"""

import sys
import argparse
from pathlib import Path

# Add src to path for direct imports
sys.path.insert(0, str(Path(__file__).parent))

from src.extractor import extract_citations
from src.verifier import verify_doi, verify_dois_batch


def test_doi_verification():
    """Test DOI verification with known DOIs."""
    print("=" * 60)
    print("Testing DOI Verification")
    print("=" * 60)
    
    test_cases = [
        ("10.1038/nature12373", True, "Nature paper (CRISPR)"),
        ("10.9999/fake.doi.12345", False, "Fake DOI"),
        ("10.1145/3292500.3330701", True, "ACM KDD paper"),
        ("10.48550/arXiv.2303.08774", True, "arXiv DOI (GPT-4)"),
        ("10.1234/hallucinated.reference", False, "Hallucinated reference"),
    ]
    
    for doi, expected_valid, description in test_cases:
        result = verify_doi(doi)
        status = "✓" if result.valid else "✗"
        match = "✓" if result.valid == expected_valid else "⚠ UNEXPECTED"
        
        print(f"\n{status} {doi}")
        print(f"   Description: {description}")
        print(f"   Expected: {'valid' if expected_valid else 'invalid'}")
        print(f"   Result: {'valid' if result.valid else 'invalid'} {match}")
        
        if result.valid:
            print(f"   Title: {result.title}")
            if result.authors:
                print(f"   Authors: {', '.join(result.authors[:3])}{'...' if len(result.authors) > 3 else ''}")
            print(f"   Year: {result.year}")
        else:
            print(f"   Error: {result.error}")


def verify_pdf(pdf_path: str):
    """Extract and verify citations from a PDF."""
    print("=" * 60)
    print(f"Processing: {pdf_path}")
    print("=" * 60)
    
    # Step 1: Extract citations
    print("\n[1/2] Extracting citations from PDF...")
    extraction = extract_citations(pdf_path)
    
    if not extraction.success:
        print(f"ERROR: {extraction.error}")
        return
    
    print(f"   Pages: {extraction.total_pages}")
    print(f"   DOIs found: {len(extraction.dois_found)}")
    print(f"   Citations parsed: {len(extraction.citations)}")
    
    if not extraction.dois_found:
        print("\nNo DOIs found in this paper.")
        return
    
    # Step 2: Verify DOIs
    print("\n[2/2] Verifying DOIs against CrossRef...")
    print("-" * 60)
    
    valid_count = 0
    invalid_count = 0
    error_count = 0
    
    for doi in extraction.dois_found:
        result = verify_doi(doi)
        
        if result.valid:
            status = "✓"
            valid_count += 1
            detail = f"{result.title[:50]}..." if result.title and len(result.title) > 50 else result.title
        else:
            if result.error and "not found" in result.error.lower():
                status = "✗"
                invalid_count += 1
            else:
                status = "?"
                error_count += 1
            detail = result.error
        
        print(f"{status} {doi}")
        print(f"   {detail}")
    
    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total DOIs: {len(extraction.dois_found)}")
    print(f"Valid:      {valid_count} ✓")
    print(f"Invalid:    {invalid_count} ✗")
    print(f"Errors:     {error_count} ?")
    
    if invalid_count > 0:
        print(f"\n⚠️  WARNING: {invalid_count} DOI(s) could not be verified!")
        print("   These may be hallucinated or incorrect citations.")


def main():
    parser = argparse.ArgumentParser(description="CitationLint CLI - Verify academic paper citations")
    parser.add_argument("pdf", nargs="?", help="Path to PDF file to verify")
    parser.add_argument("--test-dois", action="store_true", help="Run DOI verification tests only")
    
    args = parser.parse_args()
    
    if args.test_dois:
        test_doi_verification()
    elif args.pdf:
        verify_pdf(args.pdf)
    else:
        parser.print_help()
        print("\nExamples:")
        print("  python test_cli.py paper.pdf      # Verify a paper")
        print("  python test_cli.py --test-dois    # Test DOI verification")


if __name__ == "__main__":
    main()
