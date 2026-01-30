"""
CitationLint API

FastAPI backend for the citation verification service.
Accepts PDF uploads and returns verification reports.
"""

import os
import tempfile
import asyncio
from pathlib import Path
from typing import Optional
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .extractor import extract_citations, ExtractionResult
from .verifier import verify_doi, verify_dois_batch, VerificationResult


# Create FastAPI app
app = FastAPI(
    title="CitationLint",
    description="Verify academic paper citations by checking DOIs against CrossRef",
    version="1.0.0",
)

# Add CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Thread pool for blocking IO operations
executor = ThreadPoolExecutor(max_workers=4)


class VerificationReport(BaseModel):
    """Full verification report for a paper."""
    filename: str
    total_pages: int
    total_citations: int
    dois_found: int
    verified_valid: int
    verified_invalid: int
    verification_errors: int
    results: list[dict]
    extraction_error: Optional[str] = None


class SingleDOIResult(BaseModel):
    """Result for single DOI verification."""
    doi: str
    valid: bool
    title: Optional[str] = None
    authors: Optional[list[str]] = None
    year: Optional[int] = None
    journal: Optional[str] = None
    error: Optional[str] = None


@app.get("/")
async def root():
    """Health check and API info."""
    return {
        "service": "CitationLint",
        "version": "1.0.0",
        "endpoints": {
            "/verify": "POST - Upload PDF for citation verification",
            "/verify-doi/{doi}": "GET - Verify a single DOI",
            "/health": "GET - Health check",
        }
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.post("/verify", response_model=VerificationReport)
async def verify_paper(
    file: UploadFile = File(...),
    skip_verification: bool = Query(False, description="Skip DOI verification (extraction only)"),
):
    """
    Upload a PDF and verify all citations.
    
    Returns a detailed report of:
    - All DOIs found in the paper
    - Verification status for each DOI
    - Metadata for valid DOIs (title, authors, year)
    """
    # Validate file type
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are accepted"
        )
    
    # Save uploaded file to temp location
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save uploaded file: {str(e)}"
        )
    
    try:
        # Extract citations from PDF (blocking - run in thread pool)
        loop = asyncio.get_event_loop()
        extraction_result: ExtractionResult = await loop.run_in_executor(
            executor,
            extract_citations,
            tmp_path
        )
        
        if not extraction_result.success:
            return VerificationReport(
                filename=file.filename,
                total_pages=extraction_result.total_pages,
                total_citations=0,
                dois_found=0,
                verified_valid=0,
                verified_invalid=0,
                verification_errors=0,
                results=[],
                extraction_error=extraction_result.error
            )
        
        # Build results list
        results = []
        verified_valid = 0
        verified_invalid = 0
        verification_errors = 0
        
        if skip_verification:
            # Just return extracted DOIs without verification
            for citation in extraction_result.citations:
                results.append({
                    "citation_number": citation.number,
                    "citation_text": citation.text[:200] if citation.text else None,
                    "doi": citation.doi,
                    "verified": False,
                    "skipped": True,
                })
        else:
            # Verify each DOI
            for citation in extraction_result.citations:
                result_entry = {
                    "citation_number": citation.number,
                    "citation_text": citation.text[:200] if citation.text else None,
                    "doi": citation.doi,
                }
                
                if citation.doi:
                    # Verify DOI (blocking - run in executor)
                    verification: VerificationResult = await loop.run_in_executor(
                        executor,
                        verify_doi,
                        citation.doi
                    )
                    
                    result_entry["valid"] = verification.valid
                    
                    if verification.valid:
                        verified_valid += 1
                        result_entry["title"] = verification.title
                        result_entry["authors"] = verification.authors
                        result_entry["year"] = verification.year
                        result_entry["journal"] = verification.journal
                    else:
                        if verification.error and "not found" in verification.error.lower():
                            verified_invalid += 1
                        else:
                            verification_errors += 1
                        result_entry["error"] = verification.error
                else:
                    result_entry["valid"] = None
                    result_entry["note"] = "No DOI found for this citation"
                
                results.append(result_entry)
        
        return VerificationReport(
            filename=file.filename,
            total_pages=extraction_result.total_pages,
            total_citations=len(extraction_result.citations),
            dois_found=len(extraction_result.dois_found),
            verified_valid=verified_valid,
            verified_invalid=verified_invalid,
            verification_errors=verification_errors,
            results=results,
        )
        
    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except:
            pass


@app.get("/verify-doi/{doi:path}", response_model=SingleDOIResult)
async def verify_single_doi(doi: str):
    """
    Verify a single DOI against CrossRef.
    
    The DOI can be provided with or without the '10.' prefix.
    Examples:
    - /verify-doi/10.1038/nature12373
    - /verify-doi/10.1145/3292500.3330701
    """
    loop = asyncio.get_event_loop()
    result: VerificationResult = await loop.run_in_executor(
        executor,
        verify_doi,
        doi
    )
    
    return SingleDOIResult(
        doi=result.doi,
        valid=result.valid,
        title=result.title,
        authors=result.authors,
        year=result.year,
        journal=result.journal,
        error=result.error,
    )


# For running directly with python -m src.api
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
