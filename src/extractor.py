"""
PDF Citation Extractor Module

Extracts citations and DOIs from academic PDF papers using pdfplumber.
Handles various reference section formats and DOI patterns.
"""

import re
from pathlib import Path
from typing import Optional, Union
from dataclasses import dataclass, asdict

import pdfplumber


# DOI regex pattern - captures the full DOI including special characters
# DOIs start with 10. followed by registrant code (4+ digits) and suffix
DOI_PATTERN = re.compile(
    r'10\.\d{4,9}/[^\s\[\]<>"\'{}|\\^`]+',
    re.IGNORECASE
)

# Common reference section headers
REFERENCE_HEADERS = [
    r'\bReferences\b',
    r'\bBibliography\b',
    r'\bWorks\s+Cited\b',
    r'\bLiterature\s+Cited\b',
    r'\bCited\s+Works\b',
    r'\bREFERENCES\b',
    r'\bBIBLIOGRAPHY\b',
]

# Year pattern - matches 4 digit years from 1900-2099
YEAR_PATTERN = re.compile(r'\b(19|20)\d{2}\b')


@dataclass
class ExtractedCitation:
    """A citation extracted from a PDF."""
    number: int
    text: str
    doi: Optional[str] = None
    title: Optional[str] = None
    authors: Optional[list[str]] = None
    year: Optional[int] = None
    raw_match: Optional[str] = None
    
    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ExtractionResult:
    """Result of citation extraction from a PDF."""
    success: bool
    filename: str
    total_pages: int
    citations: list[ExtractedCitation]
    dois_found: list[str]
    error: Optional[str] = None
    
    def to_dict(self) -> dict:
        result = {
            "success": self.success,
            "filename": self.filename,
            "total_pages": self.total_pages,
            "total_citations": len(self.citations),
            "dois_found": len(self.dois_found),
            "citations": [c.to_dict() for c in self.citations],
            "all_dois": self.dois_found,
        }
        if self.error:
            result["error"] = self.error
        return result


def extract_text_from_pdf(pdf_path: Union[str, Path]) -> tuple[str, int]:
    """
    Extract all text from a PDF file.
    
    Args:
        pdf_path: Path to the PDF file
        
    Returns:
        Tuple of (full_text, page_count)
        
    Raises:
        Exception if PDF cannot be read
    """
    pdf_path = Path(pdf_path)
    
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    
    full_text = []
    page_count = 0
    
    with pdfplumber.open(pdf_path) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                full_text.append(text)
    
    return "\n\n".join(full_text), page_count


def find_references_section(text: str) -> Optional[str]:
    """
    Find and extract the references/bibliography section from text.
    
    Looks for common headers and extracts everything after them.
    
    Args:
        text: Full text of the document
        
    Returns:
        Text of the references section, or None if not found
    """
    # Try to find reference section header
    for pattern in REFERENCE_HEADERS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            # Get text from header to end
            start = match.start()
            references_text = text[start:]
            
            # Try to find where references end (e.g., Appendix, Supplementary)
            end_patterns = [
                r'\n\s*(?:Appendix|Appendices|Supplementary|Acknowledgments?)\s*\n',
            ]
            for end_pattern in end_patterns:
                end_match = re.search(end_pattern, references_text, re.IGNORECASE)
                if end_match:
                    references_text = references_text[:end_match.start()]
                    break
            
            return references_text
    
    # If no header found, try to extract from last portion of document
    # (many papers have references at the end)
    lines = text.split('\n')
    if len(lines) > 50:
        # Check last 40% of document for DOIs
        last_portion = '\n'.join(lines[int(len(lines) * 0.6):])
        if DOI_PATTERN.search(last_portion):
            return last_portion
    
    return None


def clean_doi(doi: str) -> str:
    """Clean extracted DOI of trailing punctuation and artifacts."""
    # Remove common trailing punctuation
    doi = doi.rstrip(".,;:)]}'\"")
    
    # Remove HTML entities sometimes found in PDFs
    doi = re.sub(r'&[a-z]+;', '', doi)
    
    return doi


def extract_dois(text: str) -> list[str]:
    """
    Extract all unique DOIs from text.
    
    Args:
        text: Text to search for DOIs
        
    Returns:
        List of unique DOIs found
    """
    matches = DOI_PATTERN.findall(text)
    
    # Clean and deduplicate
    cleaned = []
    seen = set()
    
    for doi in matches:
        doi = clean_doi(doi)
        doi_lower = doi.lower()
        if doi_lower not in seen and len(doi) > 10:
            seen.add(doi_lower)
            cleaned.append(doi)
    
    return cleaned


def parse_citation_text(text: str) -> dict:
    """
    Parse a citation text to extract title, authors, and year.
    
    Handles common citation formats:
    - APA: Author, A. A., & Author, B. B. (Year). Title. Journal.
    - IEEE: A. Author and B. Author, "Title," Journal, Year.
    - Nature: Author, A., Author, B. Title. Journal Year.
    
    Returns:
        Dict with keys: title, authors (list), year (int or None)
    """
    result = {"title": None, "authors": [], "year": None}
    
    if not text:
        return result
    
    # Clean up the text
    text = re.sub(r'\s+', ' ', text.strip())
    
    # Extract year (look for 4-digit year)
    year_matches = YEAR_PATTERN.findall(text)
    if year_matches:
        # Take the first year found (usually publication year)
        result["year"] = int(year_matches[0])
    
    # Try to extract title - common patterns:
    # 1. Quoted title: "Title here" or "Title here"
    quoted_title = re.search(r'["""]([^"""]+)["""]', text)
    if quoted_title:
        result["title"] = quoted_title.group(1).strip()
    else:
        # 2. Title after year in parentheses: (2020). Title.
        after_year = re.search(r'\(\d{4}\)\.\s*([^.]+(?:\.[^.]+)?)', text)
        if after_year:
            result["title"] = after_year.group(1).strip()
        else:
            # 3. Title is typically the longest sentence-like segment
            # after the author portion (before journal/conference)
            # Look for capitalized phrase that's not all caps
            sentences = re.split(r'[.?!]\s+', text)
            for sent in sentences:
                # Title is usually longer and mixed case
                if len(sent) > 30 and not sent.isupper():
                    # Skip if it looks like author names (has commas and initials)
                    if not re.match(r'^[A-Z][a-z]+,\s*[A-Z]\.', sent):
                        result["title"] = sent.strip()
                        break
    
    # Extract authors - usually at the start before year or title
    # Look for patterns like: "Smith, J., Jones, A. B.," or "J. Smith, A. Jones"
    author_section = text
    if result["year"]:
        # Authors are usually before the year
        year_pos = text.find(str(result["year"]))
        if year_pos > 10:
            author_section = text[:year_pos]
    
    # Common author patterns
    # Pattern: "Last, F., Last, F. M.," (multiple authors with initials)
    author_pattern1 = re.findall(r'([A-Z][a-z]+,?\s+[A-Z]\.(?:\s*[A-Z]\.)?)', author_section)
    # Pattern: "F. Last" or "First Last"
    author_pattern2 = re.findall(r'([A-Z]\.?\s+[A-Z][a-z]+)', author_section)
    
    if author_pattern1:
        result["authors"] = author_pattern1[:10]  # Limit to 10 authors
    elif author_pattern2:
        result["authors"] = author_pattern2[:10]
    
    return result


def parse_numbered_citations(text: str) -> list[tuple[int, str]]:
    """
    Parse numbered citations from reference text.
    
    Handles formats like:
    [1] Author...
    1. Author...
    (1) Author...
    
    Returns:
        List of (citation_number, citation_text) tuples
    """
    citations = []
    
    # Try different numbered reference patterns
    patterns = [
        r'\[(\d+)\]\s*([^\[\]]+?)(?=\[\d+\]|\Z)',  # [1] style
        r'^(\d+)\.\s*([^0-9].+?)(?=^\d+\.|\Z)',    # 1. style (multiline)
        r'\((\d+)\)\s*([^\(\)]+?)(?=\(\d+\)|\Z)',  # (1) style
    ]
    
    for pattern in patterns:
        flags = re.MULTILINE | re.DOTALL
        matches = list(re.finditer(pattern, text, flags))
        if matches and len(matches) > 3:  # Need a few matches to be confident
            for m in matches:
                num = int(m.group(1))
                text_content = m.group(2).strip()
                if len(text_content) > 20:  # Skip very short matches
                    citations.append((num, text_content))
            break
    
    return citations


def extract_citations(pdf_path: Union[str, Path]) -> ExtractionResult:
    """
    Main entry point: Extract citations from a PDF.
    
    Args:
        pdf_path: Path to the PDF file
        
    Returns:
        ExtractionResult with all extracted citations and DOIs
    """
    pdf_path = Path(pdf_path)
    
    try:
        # Extract text from PDF
        full_text, page_count = extract_text_from_pdf(pdf_path)
        
        if not full_text:
            return ExtractionResult(
                success=False,
                filename=pdf_path.name,
                total_pages=page_count,
                citations=[],
                dois_found=[],
                error="No text could be extracted from PDF (may be scanned/image-based)"
            )
        
        # Find references section
        ref_text = find_references_section(full_text)
        
        if not ref_text:
            # Fall back to searching entire document for DOIs
            ref_text = full_text
        
        # Extract all DOIs from references
        all_dois = extract_dois(ref_text)
        
        # Try to parse numbered citations
        parsed_citations = parse_numbered_citations(ref_text)
        
        # Build citation objects
        citations = []
        
        if parsed_citations:
            # Match DOIs to their citations and parse metadata
            for num, text in parsed_citations:
                doi = None
                # Check if any DOI is in this citation text
                for d in all_dois:
                    if d.lower() in text.lower():
                        doi = d
                        break
                
                # Parse title, authors, year from citation text
                parsed = parse_citation_text(text)
                
                citations.append(ExtractedCitation(
                    number=num,
                    text=text[:500],  # Truncate long citations
                    doi=doi,
                    title=parsed["title"],
                    authors=parsed["authors"] if parsed["authors"] else None,
                    year=parsed["year"],
                ))
        else:
            # Couldn't parse numbered citations, just report DOIs
            for i, doi in enumerate(all_dois, 1):
                citations.append(ExtractedCitation(
                    number=i,
                    text=f"DOI: {doi}",
                    doi=doi,
                ))
        
        return ExtractionResult(
            success=True,
            filename=pdf_path.name,
            total_pages=page_count,
            citations=citations,
            dois_found=all_dois,
        )
        
    except FileNotFoundError as e:
        return ExtractionResult(
            success=False,
            filename=pdf_path.name,
            total_pages=0,
            citations=[],
            dois_found=[],
            error=str(e)
        )
    except Exception as e:
        return ExtractionResult(
            success=False,
            filename=pdf_path.name,
            total_pages=0,
            citations=[],
            dois_found=[],
            error=f"PDF extraction failed: {str(e)}"
        )


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        pdf_path = sys.argv[1]
        result = extract_citations(pdf_path)
        
        print(f"File: {result.filename}")
        print(f"Pages: {result.total_pages}")
        print(f"DOIs found: {len(result.dois_found)}")
        print()
        
        if result.dois_found:
            print("DOIs:")
            for doi in result.dois_found:
                print(f"  - {doi}")
    else:
        print("Usage: python extractor.py <path-to-pdf>")
