/**
 * GhostRef v0.0.15 - Hunt Hallucinated Citations
 * Uses PDF.js for parsing, Citation.js for DOI extraction, CrossRef API for verification
 * Your PDF never leaves your browser!
 */

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// CrossRef API
const CROSSREF_API = 'https://api.crossref.org/works';
const MAILTO = 'ghostref@example.com';

// DOI regex patterns - comprehensive
const DOI_PATTERNS = [
    /\b(10\.\d{4,}\/[^\s\]\)>,;'"]+)/gi,                    // Standard DOI
    /doi[:\s]+([^\s\]\)>,;'"]+)/gi,                          // doi: prefix
    /https?:\/\/(?:dx\.)?doi\.org\/([^\s\]\)>,;'"]+)/gi,    // URL format
];

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fileName = document.querySelector('.file-name');
const clearFileBtn = document.getElementById('clear-file');
const verifyBtn = document.getElementById('verify-btn');
const uploadSection = document.getElementById('upload-section');
const progressSection = document.getElementById('progress-section');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');
const progressDetail = document.getElementById('progress-detail');
const resultsSection = document.getElementById('results-section');
const errorSection = document.getElementById('error-section');
const errorMessage = document.getElementById('error-message');
const errorRetry = document.getElementById('error-retry');
const newUploadBtn = document.getElementById('new-upload');
const citationsList = document.getElementById('citations-list');
const filterBtns = document.querySelectorAll('.filter-btn');

// State
let selectedFile = null;
let currentResults = null;
let currentFilter = 'all';

// Initialize
function init() {
    setupDragAndDrop();
    setupFileInput();
    setupButtons();
    setupFilters();
}

// Drag and Drop
function setupDragAndDrop() {
    const browseBtn = document.getElementById('browse-btn');
    
    // Browse button click
    browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    
    // Drop zone click (backup)
    dropZone.addEventListener('click', (e) => {
        if (e.target === dropZone) {
            fileInput.click();
        }
    });
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type === 'application/pdf') {
            handleFileSelect(files[0]);
        }
    });
}

// File Input
function setupFileInput() {
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });
}

function handleFileSelect(file) {
    selectedFile = file;
    fileName.textContent = file.name;
    fileInfo.classList.remove('hidden');
    dropZone.classList.add('hidden');
    verifyBtn.disabled = false;
}

// Buttons
function setupButtons() {
    clearFileBtn.addEventListener('click', resetUpload);
    verifyBtn.addEventListener('click', startVerification);
    newUploadBtn.addEventListener('click', resetAll);
    errorRetry.addEventListener('click', resetAll);
}

function resetUpload() {
    selectedFile = null;
    fileInput.value = '';
    fileInfo.classList.add('hidden');
    dropZone.classList.remove('hidden');
    verifyBtn.disabled = true;
}

function resetAll() {
    resetUpload();
    uploadSection.classList.remove('hidden');
    progressSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    errorSection.classList.add('hidden');
    currentResults = null;
    progressBar.style.width = '0%';
}

// Filters
function setupFilters() {
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderResults();
        });
    });
}

// Main Verification Flow
async function startVerification() {
    if (!selectedFile) return;
    
    showProgress();
    
    try {
        // Step 1: Extract text from PDF
        updateProgress('Extracting text from PDF...', 10);
        const text = await extractTextFromPDF(selectedFile);
        
        if (!text.trim()) {
            throw new Error('Could not extract text from PDF. It may be a scanned image.');
        }
        
        let allResults = [];
        
        // Step 2: Extract ALL DOIs from entire document
        updateProgress('Scanning for DOIs...', 20);
        const dois = extractAllDOIs(text);
        console.log('Found DOIs:', dois.length);
        
        if (dois.length > 0) {
            updateProgress(`Verifying ${dois.length} DOIs...`, 30);
            const doiResults = await verifyDOIs(dois);
            allResults = allResults.concat(doiResults);
        }
        
        // Step 3: Also parse citations (for refs without DOIs)
        updateProgress('Parsing citations...', 50);
        const refsSection = findReferencesSection(text);
        const citations = parseCitations(refsSection);
        console.log('Found citations:', citations.length);
        
        if (citations.length > 0) {
            // Filter out citations that we already verified via DOI
            const verifiedDOIs = new Set(allResults.filter(r => r.valid).map(r => r.doi?.toLowerCase()));
            const unverifiedCitations = citations.filter(c => {
                const citDOI = extractDOI(c.raw);
                return !citDOI || !verifiedDOIs.has(citDOI.toLowerCase());
            });
            
            if (unverifiedCitations.length > 0) {
                updateProgress(`Verifying ${unverifiedCitations.length} citations by title...`, 60);
                const citResults = await verifyCitations(unverifiedCitations);
                // Renumber to continue from DOI results
                citResults.forEach((r, i) => r.index = allResults.length + i + 1);
                allResults = allResults.concat(citResults);
            }
        }
        
        if (allResults.length === 0) {
            throw new Error('Could not find any DOIs or parseable citations in this PDF.');
        }
        
        // Step 4: Show results
        currentResults = allResults;
        showResults();
        
    } catch (error) {
        console.error('Error:', error);
        showError(error.message);
    }
}

// PDF Text Extraction
async function extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    const numPages = pdf.numPages;
    
    for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
        
        const extractProgress = 10 + (10 * (i / numPages));
        updateProgress(`Extracting page ${i}/${numPages}...`, extractProgress);
    }
    
    return fullText;
}

// Find References Section
function findReferencesSection(text) {
    const startPatterns = [
        /\n\s*References?\s*\n/i,
        /\n\s*Bibliography\s*\n/i,
        /\n\s*REFERENCES?\s*\n/i,
        /\n\s*Works?\s+Cited\s*\n/i,
        /\n\s*Literature\s+Cited\s*\n/i,
        /\n\s*Cited\s+References?\s*\n/i,
    ];
    
    // Patterns that indicate END of references section
    const endPatterns = [
        /\n\s*Appendix/i,
        /\n\s*APPENDIX/i,
        /\n\s*Further\s+reading/i,
        /\n\s*Supplementary/i,
        /\n\s*Acknowledgment/i,
        /\n\s*Author\s+contributions/i,
        /\n\s*Data\s+availability/i,
        /\n\s*Conflict\s+of\s+interest/i,
        /\n\s*Extended\s+Data/i,
    ];
    
    let refsStart = -1;
    for (const pattern of startPatterns) {
        const match = text.search(pattern);
        if (match !== -1) {
            refsStart = match;
            console.log('Found references section at position:', match);
            break;
        }
    }
    
    // If no header found, look for numbered refs pattern starting somewhere
    if (refsStart === -1) {
        // Look for first occurrence of "1. Author" pattern (start of numbered refs)
        const numberedStart = text.search(/\n\s*1\.\s+[A-Z][a-z]+/);
        if (numberedStart !== -1 && numberedStart > text.length * 0.5) {
            // Only use if it's in the back half of the document
            refsStart = numberedStart;
            console.log('Found numbered refs starting at:', numberedStart);
        }
    }
    
    if (refsStart === -1) {
        console.log('No references header found, using last 40%');
        return text.substring(Math.floor(text.length * 0.6));
    }
    
    // Get text from references start
    let refsText = text.substring(refsStart);
    
    // Try to find where references END
    for (const pattern of endPatterns) {
        const endMatch = refsText.substring(100).search(pattern);
        if (endMatch !== -1) {
            console.log('Found end of references at:', endMatch + 100);
            refsText = refsText.substring(0, endMatch + 100);
            break;
        }
    }
    
    return refsText;
}

// Parse individual citations from references section
function parseCitations(text) {
    const citations = [];
    
    // Try different citation patterns
    
    // Pattern 1: Numbered citations [1], [2], etc.
    const bracketMatches = text.match(/\[\d+\][^\[]+/g);
    if (bracketMatches && bracketMatches.length > 2) {
        console.log('Using bracketed number pattern, found:', bracketMatches.length);
        for (let i = 0; i < bracketMatches.length; i++) {
            const raw = bracketMatches[i];
            const numMatch = raw.match(/\[(\d+)\]/);
            const index = numMatch ? parseInt(numMatch[1]) : i + 1;
            const citationText = raw.replace(/\[\d+\]\s*/, '').trim();
            const citation = cleanCitation(citationText);
            if (citation && looksLikeCitation(citation)) {
                citations.push({ raw: citation, index: index });
            }
        }
        if (citations.length > 0) return citations;
    }
    
    // Pattern 2: Numbered with dot: 1. 2. 3. or 123. (handles multi-digit)
    // Match: newline/start, optional space, 1-3 digit number, dot, space, capital letter, then text
    const dotMatches = text.match(/(?:^|\n)\s*(\d{1,3})\.\s+[A-Z][^\n]+(?:\n(?!\s*\d{1,3}\.)[^\n]+)*/gm);
    if (dotMatches && dotMatches.length > 2) {
        console.log('Using dot number pattern, found:', dotMatches.length);
        for (let i = 0; i < dotMatches.length; i++) {
            const raw = dotMatches[i];
            const numMatch = raw.match(/(\d{1,3})\./);
            const index = numMatch ? parseInt(numMatch[1]) : i + 1;
            const citationText = raw.replace(/^\s*\d{1,3}\.\s*/, '').trim();
            const citation = cleanCitation(citationText);
            if (citation && looksLikeCitation(citation)) {
                citations.push({ raw: citation, index: index });
            }
        }
        if (citations.length > 0) return citations;
    }
    
    // Pattern 3: Nature/Science style - "Author et al. Title. Journal Volume, Pages (Year)."
    // Look for "et al." or author initials followed by text and year in parens
    const etAlMatches = text.match(/[A-Z][a-z]+(?:,?\s+[A-Z]\.?(?:\s*[A-Z]\.?)*|\s+et\s+al\.)[^(]{10,200}\(\d{4}\)/g);
    if (etAlMatches && etAlMatches.length > 2) {
        console.log('Using et al. pattern, found:', etAlMatches.length);
        for (let i = 0; i < etAlMatches.length; i++) {
            const citation = cleanCitation(etAlMatches[i]);
            if (citation && looksLikeCitation(citation)) {
                citations.push({ raw: citation, index: i + 1 });
            }
        }
        if (citations.length > 0) return citations;
    }
    
    // Pattern 4: Author-year style - look for author names followed by year
    const authorYearMatches = text.match(/[A-Z][a-z]+,?\s+[A-Z]\.?[^.]*\(\d{4}\)[^.]*\./g);
    if (authorYearMatches && authorYearMatches.length > 2) {
        console.log('Using author-year pattern, found:', authorYearMatches.length);
        for (let i = 0; i < authorYearMatches.length; i++) {
            const citation = cleanCitation(authorYearMatches[i]);
            if (citation && looksLikeCitation(citation)) {
                citations.push({ raw: citation, index: i + 1 });
            }
        }
        if (citations.length > 0) return citations;
    }
    
    console.log('No citation pattern matched well');
    return citations;
}

// Check if text looks like a real citation (has author-like names and year)
function looksLikeCitation(text) {
    // Must have something that looks like a year
    if (!/\b(19|20)\d{2}\b/.test(text)) return false;
    
    // Must have something that looks like author names (Initial. or Name,)
    if (!/[A-Z]\.|[A-Z][a-z]+,/.test(text)) return false;
    
    // Must be reasonable length
    if (text.length < 30 || text.length > 1000) return false;
    
    // Should not be just a header or equation
    if (/^(Theorem|Lemma|Proof|Definition|Appendix|Figure|Table)\b/i.test(text)) return false;
    
    return true;
}

function cleanCitation(text) {
    if (!text) return null;
    // Clean up whitespace, limit length
    let cleaned = text.replace(/\s+/g, ' ').trim();
    // Take first ~500 chars (one citation shouldn't be longer)
    if (cleaned.length > 500) {
        cleaned = cleaned.substring(0, 500);
    }
    return cleaned.length > 10 ? cleaned : null;
}

// Extract likely title from citation text
function extractTitle(citationText) {
    // Clean up the text first
    let text = citationText.replace(/\s+/g, ' ').trim();
    
    // Pattern 1: Text in quotes "Title here" or ''Title here''
    let match = text.match(/["'']([^"'']{10,200})["'']/);
    if (match) return match[1].trim();
    
    // Pattern 2: After "et al." - this is very common: "Author et al. Title here. Journal"
    match = text.match(/et\s+al\.\s+([A-Z][^.]{10,150})\./);
    if (match) return match[1].trim();
    
    // Pattern 3: After author initials "A. B. Title here."
    match = text.match(/[A-Z]\.\s+([A-Z][A-Za-z][^.]{10,150})\./);
    if (match) return match[1].trim();
    
    // Pattern 4: After (Year). Title here. (APA style)
    match = text.match(/\(\d{4}\)\.\s*([^.]{10,200})\./);
    if (match) return match[1].trim();
    
    // Pattern 5: Title before journal abbreviations
    match = text.match(/\.\s+([A-Z][^.]{10,120})\.\s*(?:Nature|Science|Cell|Nat\.|Phys\.|J\.|Proc\.|In\s)/);
    if (match) return match[1].trim();
    
    // Pattern 6: After "in:" or "In" for conference papers
    match = text.match(/[,\.]\s*[Ii]n[:\s]+([^,]{10,100})/);
    if (match) return match[1].trim();
    
    // Fallback: Find the longest capitalized phrase that looks like a title
    const sentences = text.split(/\.\s+/);
    for (const sent of sentences) {
        // Skip if it looks like author names (has "," and single letters)
        if (/^[A-Z][a-z]+,\s*[A-Z]\./.test(sent)) continue;
        // Skip if too short or looks like journal
        if (sent.length < 15 || sent.length > 200) continue;
        if (/^\d+,\s*\d+/.test(sent)) continue; // Volume, page
        if (/^[A-Z][a-z]+\.\s*[A-Z][a-z]+\./.test(sent)) continue; // J. Chem. Phys.
        
        // This might be a title
        if (/^[A-Z]/.test(sent) && sent.includes(' ')) {
            return sent.trim();
        }
    }
    
    return null;
}

// Extract DOI from citation text
function extractDOI(text) {
    for (const pattern of DOI_PATTERNS) {
        pattern.lastIndex = 0; // Reset regex state
        const match = pattern.exec(text);
        if (match) {
            let doi = match[1];
            // Clean trailing punctuation
            doi = doi.replace(/[.,;:\)\]}>'"]+$/, '');
            // Validate basic DOI format
            if (doi.startsWith('10.') && doi.length > 7) {
                return doi;
            }
        }
    }
    return null;
}

// Extract ALL DOIs from entire document (format-agnostic)
function extractAllDOIs(text) {
    const doiSet = new Set();
    
    // Comprehensive DOI pattern - find all 10.xxxx/yyyy patterns
    const masterPattern = /\b(10\.\d{4,9}\/[^\s\]\)>,;'"]{3,})/gi;
    
    let match;
    while ((match = masterPattern.exec(text)) !== null) {
        let doi = match[1];
        // Clean trailing punctuation
        doi = doi.replace(/[.,;:\)\]}>'"]+$/, '');
        // Validate
        if (doi.length > 10 && doi.length < 100) {
            doiSet.add(doi);
        }
    }
    
    // Also check for doi.org URLs
    const urlPattern = /doi\.org\/(10\.\d{4,9}\/[^\s\]\)>,;'"]{3,})/gi;
    while ((match = urlPattern.exec(text)) !== null) {
        let doi = match[1].replace(/[.,;:\)\]}>'"]+$/, '');
        if (doi.length > 10 && doi.length < 100) {
            doiSet.add(doi);
        }
    }
    
    return Array.from(doiSet);
}

// Verify multiple DOIs against CrossRef
async function verifyDOIs(dois) {
    const results = [];
    const total = dois.length;
    
    for (let i = 0; i < dois.length; i++) {
        const doi = dois[i];
        progressDetail.textContent = `Verifying: ${doi}`;
        
        const result = await verifyDOI(doi);
        results.push({
            index: i + 1,
            raw: doi,
            doi: doi,
            ...result
        });
        
        const progress = 40 + (55 * ((i + 1) / total));
        updateProgress(`Verified ${i + 1}/${total} DOIs...`, progress);
        
        await sleep(150);
    }
    
    return results;
}

// Verify single DOI directly against CrossRef
async function verifyDOI(doi) {
    try {
        const url = `${CROSSREF_API}/${encodeURIComponent(doi)}?mailto=${MAILTO}`;
        const response = await fetch(url);
        
        if (response.status === 404) {
            return { valid: false, error: 'DOI not found in CrossRef' };
        }
        
        if (!response.ok) {
            return { valid: null, error: `HTTP ${response.status}` };
        }
        
        const data = await response.json();
        const work = data.message;
        
        const authors = work.author || [];
        const authorStr = authors.length > 0 
            ? authors.slice(0, 3).map(a => a.family || a.name || 'Unknown').join(', ') + (authors.length > 3 ? ' et al.' : '')
            : 'Unknown';
        
        return {
            valid: true,
            title: work.title?.[0] || 'Unknown',
            authors: authorStr,
            year: String(work.published?.['date-parts']?.[0]?.[0] || work.created?.['date-parts']?.[0]?.[0] || 'Unknown'),
            doi: work.DOI,
            journal: work['container-title']?.[0] || work.publisher || 'Unknown',
            method: 'doi'
        };
        
    } catch (error) {
        return { valid: null, error: error.message || 'Network error' };
    }
}

// Extract bibliographic info for fallback search
function extractBiblio(text) {
    const biblio = {};
    
    // Extract author (first author surname)
    const authorMatch = text.match(/^([A-Z][a-z]+)/);
    if (authorMatch) biblio.author = authorMatch[1];
    
    // Extract year
    const yearMatch = text.match(/\((\d{4})\)/);
    if (yearMatch) biblio.year = yearMatch[1];
    
    // Extract journal abbreviation patterns
    const journalPatterns = [
        /\b(Nature|Science|Cell|PNAS|PLoS|Phys\.?\s*Rev|J\.?\s*Chem|Nat\.?\s*\w+)\b/i,
        /\b([A-Z][a-z]+\.?\s+[A-Z][a-z]+\.?)\s+\d+/,  // "J. Chem. Phys. 123"
    ];
    for (const pattern of journalPatterns) {
        const match = text.match(pattern);
        if (match) {
            biblio.journal = match[1];
            break;
        }
    }
    
    // Extract volume/pages
    const volMatch = text.match(/\b(\d{1,4}),\s*(\d+)/);
    if (volMatch) {
        biblio.volume = volMatch[1];
        biblio.page = volMatch[2];
    }
    
    return Object.keys(biblio).length >= 2 ? biblio : null;
}

// Search CrossRef by bibliographic query (fallback)
async function searchCrossRefBiblio(biblio, rawCitation, index) {
    try {
        // Build query string
        let query = '';
        if (biblio.author) query += biblio.author + ' ';
        if (biblio.journal) query += biblio.journal + ' ';
        if (biblio.year) query += biblio.year + ' ';
        if (biblio.volume) query += biblio.volume;
        
        const url = `${CROSSREF_API}?query.bibliographic=${encodeURIComponent(query.trim())}&rows=1&mailto=${MAILTO}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            return { index, raw: rawCitation, valid: null, error: `HTTP ${response.status}` };
        }
        
        const data = await response.json();
        const items = data.message?.items || [];
        
        if (items.length === 0) {
            return { index, raw: rawCitation, searchedBiblio: query, valid: false, error: 'No match found' };
        }
        
        const work = items[0];
        
        // Trust CrossRef - they know what they're doing
        const foundYear = work.published?.['date-parts']?.[0]?.[0] || work.created?.['date-parts']?.[0]?.[0];
        
        const authors = work.author || [];
        const authorStr = authors.length > 0 
            ? authors.slice(0, 3).map(a => a.family || a.name || 'Unknown').join(', ') + (authors.length > 3 ? ' et al.' : '')
            : 'Unknown';
        
        return {
            index,
            raw: rawCitation,
            valid: true,
            title: work.title?.[0] || 'Unknown',
            authors: authorStr,
            year: String(foundYear || 'Unknown'),
            doi: work.DOI,
            journal: work['container-title']?.[0] || work.publisher || 'Unknown',
            method: 'biblio'
        };
        
    } catch (error) {
        return { index, raw: rawCitation, valid: null, error: error.message };
    }
}

// Verify citations against CrossRef - DOI → Title → Bibliographic
async function verifyCitations(citations) {
    const results = [];
    const total = citations.length;
    
    for (let i = 0; i < citations.length; i++) {
        const citation = citations[i];
        let result;
        
        // Method 1: Try DOI first (most reliable)
        const doi = extractDOI(citation.raw);
        if (doi) {
            progressDetail.textContent = `Verifying DOI: ${doi}`;
            const doiResult = await verifyDOI(doi);
            result = {
                index: citation.index,
                raw: citation.raw,
                doi: doi,
                ...doiResult
            };
        } else {
            // Method 2: Try title search
            const title = extractTitle(citation.raw);
            if (title && title.length > 15) {
                progressDetail.textContent = `Searching title: "${title.substring(0, 40)}..."`;
                result = await searchCrossRef(title, citation.raw, citation.index);
                result.method = 'title';
            }
            
            // Method 3: If title failed or wasn't found, try bibliographic search
            if (!result || result.valid === false) {
                const biblio = extractBiblio(citation.raw);
                if (biblio) {
                    progressDetail.textContent = `Searching by author/journal/year...`;
                    const biblioResult = await searchCrossRefBiblio(biblio, citation.raw, citation.index);
                    // Use biblio result if it's better than title result
                    if (!result || (biblioResult.valid === true && result.valid !== true)) {
                        result = biblioResult;
                    }
                }
            }
            
            // If still no result
            if (!result) {
                result = {
                    index: citation.index,
                    raw: citation.raw,
                    valid: null,
                    error: 'Could not extract DOI, title, or bibliographic info'
                };
            }
        }
        
        results.push(result);
        
        // Update progress
        const progress = 40 + (55 * ((i + 1) / total));
        updateProgress(`Verified ${i + 1}/${total} citations...`, progress);
        
        // Rate limiting
        await sleep(200);
    }
    
    return results;
}

// Search CrossRef by title
async function searchCrossRef(title, rawCitation, index) {
    try {
        const query = encodeURIComponent(title);
        const url = `${CROSSREF_API}?query.title=${query}&rows=1&mailto=${MAILTO}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            return {
                index,
                raw: rawCitation,
                searchedTitle: title,
                valid: null,
                error: `HTTP ${response.status}`
            };
        }
        
        const data = await response.json();
        const items = data.message?.items || [];
        
        if (items.length === 0) {
            return {
                index,
                raw: rawCitation,
                searchedTitle: title,
                valid: false,
                error: 'No matching publication found in CrossRef'
            };
        }
        
        const work = items[0];
        const foundTitle = work.title?.[0] || '';
        
        // Trust CrossRef - if they returned a result for our query, it's likely correct
        // Their search is already doing fuzzy matching
        const similarity = calculateSimilarity(title.toLowerCase(), foundTitle.toLowerCase());
        
        // Found a match!
        const authors = work.author || [];
        const authorStr = authors.length > 0 
            ? authors.slice(0, 3).map(a => a.family || a.name || 'Unknown').join(', ') + (authors.length > 3 ? ' et al.' : '')
            : 'Unknown';
        
        const year = work.published?.['date-parts']?.[0]?.[0] || 
                     work.created?.['date-parts']?.[0]?.[0] || 
                     'Unknown';
        
        return {
            index,
            raw: rawCitation,
            searchedTitle: title,
            valid: true,
            title: foundTitle,
            authors: authorStr,
            year: String(year),
            doi: work.DOI,
            journal: work['container-title']?.[0] || work.publisher || 'Unknown',
            similarity: Math.round(similarity * 100)
        };
        
    } catch (error) {
        return {
            index,
            raw: rawCitation,
            searchedTitle: title,
            valid: null,
            error: error.message || 'Network error'
        };
    }
}

// Simple string similarity (Jaccard on words)
function calculateSimilarity(str1, str2) {
    const words1 = new Set(str1.split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(str2.split(/\s+/).filter(w => w.length > 2));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
}

// UI Updates
function showProgress() {
    uploadSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    errorSection.classList.add('hidden');
}

function updateProgress(text, percent) {
    progressText.textContent = text;
    progressBar.style.width = `${percent}%`;
}

function showResults() {
    progressSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
    
    const valid = currentResults.filter(r => r.valid === true).length;
    const invalid = currentResults.filter(r => r.valid === false).length;
    const errors = currentResults.filter(r => r.valid === null).length;
    
    document.getElementById('stat-total').textContent = currentResults.length;
    document.getElementById('stat-valid').textContent = valid;
    document.getElementById('stat-invalid').textContent = invalid;
    document.getElementById('stat-errors').textContent = errors;
    
    // Default to showing invalid citations (the ones that need attention)
    // But if none are invalid, show all
    if (invalid > 0) {
        currentFilter = 'invalid';
    } else if (errors > 0) {
        currentFilter = 'error';
    } else {
        currentFilter = 'all';
    }
    
    // Update filter button UI
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === currentFilter) {
            btn.classList.add('active');
        }
    });
    
    renderResults();
}

function renderResults() {
    let filtered = currentResults;
    
    if (currentFilter === 'valid') {
        filtered = currentResults.filter(r => r.valid === true);
    } else if (currentFilter === 'invalid') {
        filtered = currentResults.filter(r => r.valid === false);
    } else if (currentFilter === 'error') {
        filtered = currentResults.filter(r => r.valid === null);
    }
    
    citationsList.innerHTML = filtered.map(r => renderCitation(r)).join('');
}

function renderCitation(result) {
    const statusClass = result.valid === true ? 'valid' : 
                       result.valid === false ? 'invalid' : 'error';
    const statusIcon = result.valid === true ? '✓' : 
                      result.valid === false ? '✗' : '?';
    const statusText = result.valid === true ? 'Verified' : 
                      result.valid === false ? 'Not Found' : 'Error';
    
    let details = '';
    if (result.valid === true) {
        const methodBadge = result.method === 'doi' 
            ? '<span class="method-badge doi">DOI ✓</span>' 
            : `<span class="method-badge title">${result.similarity}% match</span>`;
        details = `
            <div class="citation-details">
                <div class="citation-title">${escapeHtml(result.title)}</div>
                <div class="citation-meta">
                    ${escapeHtml(result.authors)} (${result.year}) · ${escapeHtml(result.journal)}
                </div>
                <div class="citation-doi">
                    DOI: <a href="https://doi.org/${encodeURIComponent(result.doi)}" target="_blank">${escapeHtml(result.doi)}</a>
                    ${methodBadge}
                </div>
            </div>
        `;
    } else if (result.valid === false) {
        details = `
            <div class="citation-details">
                <div class="citation-error">${escapeHtml(result.error)}</div>
                <div class="citation-searched">Searched for: "${escapeHtml(result.searchedTitle || result.doi || 'N/A')}"</div>
            </div>
        `;
    } else {
        details = `
            <div class="citation-details">
                <div class="citation-error">${escapeHtml(result.error)}</div>
            </div>
        `;
    }
    
    return `
        <div class="citation-item ${statusClass}">
            <div class="citation-header">
                <div class="citation-status">
                    <span class="status-icon">${statusIcon}</span>
                    <span class="status-text">${statusText}</span>
                </div>
                <span class="citation-index">#${result.index}</span>
            </div>
            <div class="citation-raw">${escapeHtml(result.raw.substring(0, 200))}${result.raw.length > 200 ? '...' : ''}</div>
            ${details}
        </div>
    `;
}

function showError(message) {
    progressSection.classList.add('hidden');
    errorSection.classList.remove('hidden');
    errorMessage.textContent = message;
}

// Utilities
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Start
init();
