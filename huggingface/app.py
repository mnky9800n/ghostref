"""
CitationLint - Verify Academic Citations
Hosted free on Hugging Face Spaces
"""

import gradio as gr
import requests
import pdfplumber
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

# CrossRef API
CROSSREF_API = "https://api.crossref.org/works/"
MAILTO = "citationlint@example.com"

# DOI patterns - multiple to catch different formats
DOI_PATTERNS = [
    r'(?:doi[:\s]*)?(?:https?://(?:dx\.)?doi\.org/)?({DOI_CORE})',
    r'DOI[:\s]+({DOI_CORE})',
    r'\b({DOI_CORE})\b',
]
DOI_CORE = r'10\.\d{4,9}/[^\s\]\)>,;\'"]+[^\s\]\)>,;\'\"\.]'

def compile_patterns():
    """Compile all DOI patterns."""
    compiled = []
    for pattern in DOI_PATTERNS:
        full_pattern = pattern.replace('{DOI_CORE}', DOI_CORE)
        compiled.append(re.compile(full_pattern, re.IGNORECASE))
    return compiled

COMPILED_PATTERNS = compile_patterns()

def extract_text_from_pdf(pdf_path):
    """Extract text from PDF using pdfplumber."""
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            text += page_text + "\n"
    return text

def find_references_section(text):
    """Try to find the References/Bibliography section."""
    # Common section headers
    patterns = [
        r'\n\s*References?\s*\n',
        r'\n\s*Bibliography\s*\n',
        r'\n\s*REFERENCES?\s*\n',
        r'\n\s*Works Cited\s*\n',
        r'\n\s*Literature Cited\s*\n',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return text[match.start():]
    
    # Fallback: return last 40% of text (refs usually at end)
    cutoff = int(len(text) * 0.6)
    return text[cutoff:]

def extract_dois(text):
    """Extract DOIs from text using multiple patterns."""
    dois = set()
    
    # Focus on references section
    ref_text = find_references_section(text)
    
    for pattern in COMPILED_PATTERNS:
        matches = pattern.findall(ref_text)
        for match in matches:
            # Clean the DOI
            doi = match.strip()
            # Remove trailing punctuation
            doi = re.sub(r'[.,;:\)\]>]+$', '', doi)
            # Remove trailing periods that aren't part of DOI
            while doi.endswith('.') and not re.search(r'\.\d+$', doi):
                doi = doi[:-1]
            if doi:
                dois.add(doi)
    
    # Also search full text (some papers have inline DOIs)
    for pattern in COMPILED_PATTERNS:
        matches = pattern.findall(text)
        for match in matches:
            doi = re.sub(r'[.,;:\)\]>]+$', '', match.strip())
            while doi.endswith('.') and not re.search(r'\.\d+$', doi):
                doi = doi[:-1]
            if doi:
                dois.add(doi)
    
    return list(dois)

def verify_doi(doi):
    """Verify a single DOI against CrossRef."""
    try:
        url = f"{CROSSREF_API}{requests.utils.quote(doi, safe='')}"
        headers = {"User-Agent": f"CitationLint/1.0 (mailto:{MAILTO})"}
        
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 404:
            return {
                "doi": doi,
                "valid": False,
                "error": "DOI not found in CrossRef"
            }
        
        if response.status_code != 200:
            return {
                "doi": doi,
                "valid": None,
                "error": f"HTTP {response.status_code}"
            }
        
        data = response.json()
        work = data.get("message", {})
        
        # Extract metadata
        title = work.get("title", ["Unknown"])[0] if work.get("title") else "Unknown"
        
        authors = work.get("author", [])
        if authors:
            author_str = ", ".join([
                f"{a.get('family', '')}, {a.get('given', '')[0]}." 
                if a.get('given') else a.get('family', a.get('name', 'Unknown'))
                for a in authors[:3]
            ])
            if len(authors) > 3:
                author_str += " et al."
        else:
            author_str = "Unknown"
        
        year = (work.get("published", {}).get("date-parts", [[None]])[0][0] or
                work.get("created", {}).get("date-parts", [[None]])[0][0] or
                "Unknown")
        
        journal = work.get("container-title", [""])[0] or work.get("publisher", "Unknown")
        
        return {
            "doi": doi,
            "valid": True,
            "title": title,
            "authors": author_str,
            "year": str(year),
            "journal": journal
        }
        
    except requests.Timeout:
        return {"doi": doi, "valid": None, "error": "Timeout"}
    except Exception as e:
        return {"doi": doi, "valid": None, "error": str(e)}

def verify_dois_parallel(dois, progress=None):
    """Verify DOIs in parallel with rate limiting."""
    results = []
    
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(verify_doi, doi): doi for doi in dois}
        
        for i, future in enumerate(as_completed(futures)):
            result = future.result()
            results.append(result)
            
            if progress:
                progress((i + 1) / len(dois), f"Verified {i + 1}/{len(dois)} DOIs")
            
            # Small delay for rate limiting
            time.sleep(0.1)
    
    return results

def format_results(results):
    """Format results as markdown."""
    valid = [r for r in results if r.get("valid") is True]
    invalid = [r for r in results if r.get("valid") is False]
    errors = [r for r in results if r.get("valid") is None]
    
    output = f"""## Summary

| Metric | Count |
|--------|-------|
| **DOIs Found** | {len(results)} |
| ✅ **Valid** | {len(valid)} |
| ❌ **Invalid** | {len(invalid)} |
| ⚠️ **Errors** | {len(errors)} |

"""
    
    if invalid:
        output += "## ❌ Invalid Citations (Not Found in CrossRef)\n\n"
        for r in invalid:
            output += f"- `{r['doi']}` - {r.get('error', 'Not found')}\n"
        output += "\n"
    
    if errors:
        output += "## ⚠️ Verification Errors\n\n"
        for r in errors:
            output += f"- `{r['doi']}` - {r.get('error', 'Unknown error')}\n"
        output += "\n"
    
    if valid:
        output += "## ✅ Valid Citations\n\n"
        for r in valid:
            output += f"**{r.get('title', 'Unknown')}**\n"
            output += f"- DOI: [`{r['doi']}`](https://doi.org/{r['doi']})\n"
            output += f"- {r.get('authors', 'Unknown')} ({r.get('year', '?')})\n"
            output += f"- {r.get('journal', 'Unknown')}\n\n"
    
    return output

def process_pdf(pdf_file, progress=gr.Progress()):
    """Main processing function."""
    if pdf_file is None:
        return "Please upload a PDF file."
    
    try:
        # Extract text
        progress(0.1, "Extracting text from PDF...")
        text = extract_text_from_pdf(pdf_file.name)
        
        if not text.strip():
            return "❌ Could not extract text from PDF. It may be a scanned image."
        
        # Find DOIs
        progress(0.2, "Finding DOIs...")
        dois = extract_dois(text)
        
        if not dois:
            return "❌ No DOIs found in this PDF. The paper may not include DOI references."
        
        # Verify DOIs
        progress(0.3, f"Verifying {len(dois)} DOIs against CrossRef...")
        results = verify_dois_parallel(dois, progress)
        
        # Format output
        progress(1.0, "Done!")
        return format_results(results)
        
    except Exception as e:
        return f"❌ Error processing PDF: {str(e)}"

# Gradio UI
with gr.Blocks(title="CitationLint", theme=gr.themes.Soft()) as app:
    gr.Markdown("""
    # 📚 CitationLint
    
    **Verify academic paper citations against CrossRef**
    
    Upload a PDF and we'll check if the DOIs actually exist. Useful for catching hallucinated citations from LLM-assisted writing.
    
    🔒 Your PDF is processed on our server and not stored.
    """)
    
    with gr.Row():
        with gr.Column(scale=1):
            pdf_input = gr.File(
                label="Upload PDF",
                file_types=[".pdf"],
                type="filepath"
            )
            verify_btn = gr.Button("🔍 Verify Citations", variant="primary", size="lg")
        
        with gr.Column(scale=2):
            output = gr.Markdown(label="Results")
    
    verify_btn.click(
        fn=process_pdf,
        inputs=[pdf_input],
        outputs=[output],
        show_progress=True
    )
    
    gr.Markdown("""
    ---
    
    **How it works:**
    1. Extract text from your PDF
    2. Find DOIs using pattern matching
    3. Verify each DOI against CrossRef's database
    4. Report which citations are valid, invalid, or couldn't be checked
    
    **Limitations:**
    - Scanned/image PDFs won't work (no OCR)
    - Some older papers don't have DOIs
    - CrossRef may not have all publications
    
    ---
    
    🙏 **If this saved you from embarrassment, consider supporting the project:**
    
    [![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/mnky9800n)
    
    ---
    
    Built to catch hallucinated citations 💀🔥 | [GitHub](https://github.com/mnky9800n/citationlint) | Powered by [CrossRef](https://www.crossref.org/)
    """)

if __name__ == "__main__":
    app.launch()
