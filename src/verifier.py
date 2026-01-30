"""
DOI Verification Module

Verifies citations against the CrossRef API using a fallback strategy:
1. DOI lookup (if DOI present)
2. Title search
3. Author + year search

Uses the "polite pool" for better rate limits.
"""

import re
import time
import requests
from typing import Optional
from dataclasses import dataclass, asdict, field
from difflib import SequenceMatcher


# CrossRef API configuration
CROSSREF_API_BASE = "https://api.crossref.org/works/"
CROSSREF_QUERY_BASE = "https://api.crossref.org/works"
POLITE_EMAIL = "citationlint@example.com"  # Gets us in the polite pool (faster)
REQUEST_TIMEOUT = 10  # seconds
RATE_LIMIT_DELAY = 0.1  # 100ms between requests (conservative)
TITLE_MATCH_THRESHOLD = 0.85  # Similarity threshold for title matching


@dataclass
class VerificationResult:
    """Result of DOI verification."""
    doi: str
    valid: bool
    title: Optional[str] = None
    authors: Optional[list[str]] = None
    year: Optional[int] = None
    journal: Optional[str] = None
    error: Optional[str] = None
    
    def to_dict(self) -> dict:
        return asdict(self)


def clean_doi(doi: str) -> str:
    """
    Clean and normalize a DOI string.
    
    Handles common issues like:
    - Trailing punctuation
    - URL prefixes
    - Whitespace
    """
    # Remove common DOI URL prefixes
    doi = doi.strip()
    prefixes = [
        "https://doi.org/",
        "http://doi.org/",
        "https://dx.doi.org/",
        "http://dx.doi.org/",
        "doi:",
        "DOI:",
    ]
    for prefix in prefixes:
        if doi.startswith(prefix):
            doi = doi[len(prefix):]
            break
    
    # Remove trailing punctuation that's often captured by regex
    doi = doi.rstrip(".,;:)]}")
    
    # Handle URLs that might have encoding
    doi = doi.replace("%2F", "/")
    
    return doi


def extract_authors(author_list: list) -> list[str]:
    """Extract author names from CrossRef author data."""
    authors = []
    for author in author_list[:10]:  # Limit to first 10 authors
        if "family" in author:
            name = author.get("family", "")
            if "given" in author:
                name = f"{author['given']} {name}"
            authors.append(name)
        elif "name" in author:
            authors.append(author["name"])
    return authors


def verify_doi(doi: str) -> VerificationResult:
    """
    Verify a DOI against CrossRef API.
    
    Args:
        doi: The DOI string to verify (with or without prefix)
        
    Returns:
        VerificationResult with validity status and metadata if found
    """
    cleaned_doi = clean_doi(doi)
    
    if not cleaned_doi:
        return VerificationResult(
            doi=doi,
            valid=False,
            error="Empty or invalid DOI format"
        )
    
    # Validate basic DOI format
    if not re.match(r'^10\.\d{4,}/.+$', cleaned_doi):
        return VerificationResult(
            doi=doi,
            valid=False,
            error=f"Invalid DOI format: {cleaned_doi}"
        )
    
    # Build request with polite pool headers
    url = f"{CROSSREF_API_BASE}{cleaned_doi}"
    headers = {
        "User-Agent": f"CitationLint/1.0 (mailto:{POLITE_EMAIL})",
        "Accept": "application/json",
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        
        if response.status_code == 200:
            data = response.json()
            message = data.get("message", {})
            
            # Extract metadata
            title = message.get("title", [None])[0]
            authors = extract_authors(message.get("author", []))
            
            # Try to get year from various date fields
            year = None
            for date_field in ["published-print", "published-online", "created"]:
                if date_field in message:
                    date_parts = message[date_field].get("date-parts", [[None]])
                    if date_parts and date_parts[0]:
                        year = date_parts[0][0]
                        break
            
            # Get journal/container title
            journal = None
            container = message.get("container-title", [])
            if container:
                journal = container[0]
            
            return VerificationResult(
                doi=cleaned_doi,
                valid=True,
                title=title,
                authors=authors if authors else None,
                year=year,
                journal=journal,
            )
            
        elif response.status_code == 404:
            return VerificationResult(
                doi=cleaned_doi,
                valid=False,
                error="DOI not found in CrossRef"
            )
        else:
            return VerificationResult(
                doi=cleaned_doi,
                valid=False,
                error=f"CrossRef API error: HTTP {response.status_code}"
            )
            
    except requests.Timeout:
        return VerificationResult(
            doi=cleaned_doi,
            valid=False,
            error="CrossRef API timeout"
        )
    except requests.RequestException as e:
        return VerificationResult(
            doi=cleaned_doi,
            valid=False,
            error=f"Request failed: {str(e)}"
        )
    except Exception as e:
        return VerificationResult(
            doi=cleaned_doi,
            valid=False,
            error=f"Unexpected error: {str(e)}"
        )


def similarity(a: str, b: str) -> float:
    """Calculate similarity ratio between two strings."""
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def search_by_title(title: str, year: Optional[int] = None) -> VerificationResult:
    """
    Search CrossRef for a citation by title.
    
    Args:
        title: The paper title to search for
        year: Optional publication year to narrow results
        
    Returns:
        VerificationResult with best match if found
    """
    if not title or len(title) < 10:
        return VerificationResult(
            doi="",
            valid=False,
            error="Title too short for search"
        )
    
    headers = {
        "User-Agent": f"CitationLint/1.0 (mailto:{POLITE_EMAIL})",
        "Accept": "application/json",
    }
    
    params = {
        "query.title": title,
        "rows": 5,
        "select": "DOI,title,author,published-print,published-online,container-title",
    }
    
    if year:
        # Filter to year +/- 1 to handle publication delays
        params["filter"] = f"from-pub-date:{year-1},until-pub-date:{year+1}"
    
    try:
        response = requests.get(
            CROSSREF_QUERY_BASE,
            params=params,
            headers=headers,
            timeout=REQUEST_TIMEOUT
        )
        
        if response.status_code != 200:
            return VerificationResult(
                doi="",
                valid=False,
                error=f"CrossRef search error: HTTP {response.status_code}"
            )
        
        data = response.json()
        items = data.get("message", {}).get("items", [])
        
        if not items:
            return VerificationResult(
                doi="",
                valid=False,
                error="No matching titles found in CrossRef"
            )
        
        # Find best title match
        best_match = None
        best_score = 0.0
        
        for item in items:
            item_titles = item.get("title", [])
            if not item_titles:
                continue
            
            item_title = item_titles[0]
            score = similarity(title, item_title)
            
            if score > best_score:
                best_score = score
                best_match = item
        
        if best_match and best_score >= TITLE_MATCH_THRESHOLD:
            doi = best_match.get("DOI", "")
            matched_title = best_match.get("title", [None])[0]
            authors = extract_authors(best_match.get("author", []))
            
            # Extract year
            match_year = None
            for date_field in ["published-print", "published-online"]:
                if date_field in best_match:
                    date_parts = best_match[date_field].get("date-parts", [[None]])
                    if date_parts and date_parts[0]:
                        match_year = date_parts[0][0]
                        break
            
            journal = None
            container = best_match.get("container-title", [])
            if container:
                journal = container[0]
            
            return VerificationResult(
                doi=doi,
                valid=True,
                title=matched_title,
                authors=authors if authors else None,
                year=match_year,
                journal=journal,
            )
        else:
            return VerificationResult(
                doi="",
                valid=False,
                error=f"Best title match score {best_score:.2f} below threshold {TITLE_MATCH_THRESHOLD}"
            )
            
    except requests.Timeout:
        return VerificationResult(
            doi="",
            valid=False,
            error="CrossRef search timeout"
        )
    except Exception as e:
        return VerificationResult(
            doi="",
            valid=False,
            error=f"Search failed: {str(e)}"
        )


def search_by_author(author: str, year: Optional[int] = None, title_hint: str = "") -> VerificationResult:
    """
    Search CrossRef for a citation by author name.
    
    Args:
        author: Author name (preferably last name)
        year: Optional publication year
        title_hint: Optional partial title to help match
        
    Returns:
        VerificationResult with best match if found
    """
    if not author or len(author) < 2:
        return VerificationResult(
            doi="",
            valid=False,
            error="Author name too short for search"
        )
    
    headers = {
        "User-Agent": f"CitationLint/1.0 (mailto:{POLITE_EMAIL})",
        "Accept": "application/json",
    }
    
    params = {
        "query.author": author,
        "rows": 10,
        "select": "DOI,title,author,published-print,published-online,container-title",
    }
    
    if year:
        params["filter"] = f"from-pub-date:{year-1},until-pub-date:{year+1}"
    
    if title_hint:
        params["query.title"] = title_hint
    
    try:
        response = requests.get(
            CROSSREF_QUERY_BASE,
            params=params,
            headers=headers,
            timeout=REQUEST_TIMEOUT
        )
        
        if response.status_code != 200:
            return VerificationResult(
                doi="",
                valid=False,
                error=f"CrossRef search error: HTTP {response.status_code}"
            )
        
        data = response.json()
        items = data.get("message", {}).get("items", [])
        
        if not items:
            return VerificationResult(
                doi="",
                valid=False,
                error="No matching authors found in CrossRef"
            )
        
        # If we have a title hint, score by title similarity
        if title_hint:
            best_match = None
            best_score = 0.0
            
            for item in items:
                item_titles = item.get("title", [])
                if not item_titles:
                    continue
                score = similarity(title_hint, item_titles[0])
                if score > best_score:
                    best_score = score
                    best_match = item
            
            if best_match and best_score >= 0.5:  # Lower threshold for partial matches
                doi = best_match.get("DOI", "")
                matched_title = best_match.get("title", [None])[0]
                authors = extract_authors(best_match.get("author", []))
                
                match_year = None
                for date_field in ["published-print", "published-online"]:
                    if date_field in best_match:
                        date_parts = best_match[date_field].get("date-parts", [[None]])
                        if date_parts and date_parts[0]:
                            match_year = date_parts[0][0]
                            break
                
                journal = None
                container = best_match.get("container-title", [])
                if container:
                    journal = container[0]
                
                return VerificationResult(
                    doi=doi,
                    valid=True,
                    title=matched_title,
                    authors=authors if authors else None,
                    year=match_year,
                    journal=journal,
                )
        
        # Without title hint, just return first result as "possible match"
        # (less confident)
        return VerificationResult(
            doi="",
            valid=False,
            error="Author found but cannot confirm specific paper without title"
        )
            
    except requests.Timeout:
        return VerificationResult(
            doi="",
            valid=False,
            error="CrossRef search timeout"
        )
    except Exception as e:
        return VerificationResult(
            doi="",
            valid=False,
            error=f"Search failed: {str(e)}"
        )


@dataclass
class CitationVerificationResult:
    """Result of full citation verification with fallback strategy."""
    valid: bool
    method: str  # "doi", "title", "author", or "failed"
    doi: Optional[str] = None
    title: Optional[str] = None
    authors: Optional[list[str]] = None
    year: Optional[int] = None
    journal: Optional[str] = None
    confidence: float = 0.0  # 1.0 for DOI match, lower for fuzzy matches
    error: Optional[str] = None
    
    def to_dict(self) -> dict:
        return asdict(self)


def verify_citation(
    doi: Optional[str] = None,
    title: Optional[str] = None,
    authors: Optional[list[str]] = None,
    year: Optional[int] = None
) -> CitationVerificationResult:
    """
    Verify a citation using fallback strategy: DOI → Title → Author.
    
    Args:
        doi: DOI if available
        title: Paper title
        authors: List of author names
        year: Publication year
        
    Returns:
        CitationVerificationResult with verification details
    """
    # Strategy 1: DOI lookup (highest confidence)
    if doi:
        result = verify_doi(doi)
        if result.valid:
            return CitationVerificationResult(
                valid=True,
                method="doi",
                doi=result.doi,
                title=result.title,
                authors=result.authors,
                year=result.year,
                journal=result.journal,
                confidence=1.0,
            )
    
    # Strategy 2: Title search (high confidence if good match)
    if title:
        result = search_by_title(title, year)
        if result.valid:
            return CitationVerificationResult(
                valid=True,
                method="title",
                doi=result.doi,
                title=result.title,
                authors=result.authors,
                year=result.year,
                journal=result.journal,
                confidence=0.9,
            )
    
    # Strategy 3: Author search with title hint (medium confidence)
    if authors:
        # Try first author's last name
        first_author = authors[0] if authors else ""
        # Extract last name (assuming "First Last" or "Last, First" format)
        if "," in first_author:
            last_name = first_author.split(",")[0].strip()
        else:
            parts = first_author.split()
            last_name = parts[-1] if parts else first_author
        
        result = search_by_author(last_name, year, title or "")
        if result.valid:
            return CitationVerificationResult(
                valid=True,
                method="author",
                doi=result.doi,
                title=result.title,
                authors=result.authors,
                year=result.year,
                journal=result.journal,
                confidence=0.7,
            )
    
    # All strategies failed
    error_parts = []
    if doi:
        error_parts.append(f"DOI '{doi}' not found")
    if title:
        error_parts.append("title search failed")
    if authors:
        error_parts.append("author search failed")
    
    return CitationVerificationResult(
        valid=False,
        method="failed",
        confidence=0.0,
        error="; ".join(error_parts) if error_parts else "No searchable information provided",
    )


def verify_dois_batch(dois: list[str], delay: float = RATE_LIMIT_DELAY) -> list[VerificationResult]:
    """
    Verify multiple DOIs with rate limiting.
    
    Args:
        dois: List of DOI strings to verify
        delay: Delay between requests in seconds
        
    Returns:
        List of VerificationResult objects
    """
    results = []
    for i, doi in enumerate(dois):
        if i > 0:
            time.sleep(delay)
        results.append(verify_doi(doi))
    return results


if __name__ == "__main__":
    # Quick test
    test_dois = [
        "10.1038/nature12373",  # Valid - Nature paper
        "10.9999/fake.doi.12345",  # Invalid - made up
        "10.1145/3292500.3330701",  # Valid - ACM paper
    ]
    
    print("Testing DOI verification...")
    for doi in test_dois:
        result = verify_doi(doi)
        status = "✓" if result.valid else "✗"
        print(f"{status} {doi}")
        if result.valid:
            print(f"   Title: {result.title}")
            print(f"   Year: {result.year}")
        else:
            print(f"   Error: {result.error}")
        print()
