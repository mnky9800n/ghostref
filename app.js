/**
 * CitationLint - 100% Client-Side Citation Verification
 * Uses PDF.js for parsing, CrossRef API for verification
 * Your PDF never leaves your browser!
 */

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// CrossRef API (CORS-enabled, no key needed)
const CROSSREF_API = 'https://api.crossref.org/works/';
const MAILTO = 'citationlint@example.com'; // Polite pool

// DOI regex pattern
const DOI_PATTERN = /\b(10\.\d{4,}\/[^\s\]>)"']+)/gi;

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
    dropZone.addEventListener('click', () => fileInput.click());
    
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
        
        // Step 2: Find DOIs
        updateProgress('Finding DOIs...', 30);
        const dois = extractDOIs(text);
        
        if (dois.length === 0) {
            throw new Error('No DOIs found in this PDF. The paper may not include DOI references, or it might be a scanned image.');
        }
        
        // Step 3: Verify each DOI against CrossRef
        updateProgress(`Verifying ${dois.length} DOIs against CrossRef...`, 40);
        const results = await verifyDOIs(dois);
        
        // Step 4: Show results
        currentResults = results;
        showResults();
        
    } catch (error) {
        showError(error.message);
    }
}

// PDF Text Extraction using PDF.js
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
        
        // Update progress for large PDFs
        const extractProgress = 10 + (20 * (i / numPages));
        updateProgress(`Extracting page ${i}/${numPages}...`, extractProgress);
    }
    
    return fullText;
}

// DOI Extraction
function extractDOIs(text) {
    const matches = text.match(DOI_PATTERN) || [];
    
    // Clean and deduplicate
    const cleaned = matches.map(doi => {
        // Remove trailing punctuation
        return doi.replace(/[.,;:)\]}>'"]+$/, '');
    });
    
    // Unique DOIs only
    const unique = [...new Set(cleaned)];
    
    return unique;
}

// Verify DOIs against CrossRef
async function verifyDOIs(dois) {
    const results = [];
    const total = dois.length;
    
    // Process in batches to avoid rate limiting
    const batchSize = 5;
    const delay = 200; // ms between batches
    
    for (let i = 0; i < dois.length; i += batchSize) {
        const batch = dois.slice(i, i + batchSize);
        
        const batchResults = await Promise.all(
            batch.map(doi => verifyDOI(doi))
        );
        
        results.push(...batchResults);
        
        // Update progress
        const progress = 40 + (55 * (results.length / total));
        updateProgress(`Verified ${results.length}/${total} DOIs...`, progress);
        progressDetail.textContent = `Checking: ${batch[0]}...`;
        
        // Rate limit delay
        if (i + batchSize < dois.length) {
            await sleep(delay);
        }
    }
    
    return results;
}

// Verify single DOI
async function verifyDOI(doi) {
    try {
        const url = `${CROSSREF_API}${encodeURIComponent(doi)}?mailto=${MAILTO}`;
        const response = await fetch(url);
        
        if (response.status === 404) {
            return {
                doi,
                valid: false,
                error: 'DOI not found in CrossRef'
            };
        }
        
        if (!response.ok) {
            return {
                doi,
                valid: null,
                error: `HTTP ${response.status}`
            };
        }
        
        const data = await response.json();
        const work = data.message;
        
        return {
            doi,
            valid: true,
            title: work.title?.[0] || 'Unknown title',
            authors: formatAuthors(work.author),
            year: work.published?.['date-parts']?.[0]?.[0] || 
                  work.created?.['date-parts']?.[0]?.[0] || 
                  'Unknown',
            journal: work['container-title']?.[0] || work.publisher || 'Unknown',
            type: work.type || 'Unknown'
        };
        
    } catch (error) {
        return {
            doi,
            valid: null,
            error: error.message || 'Network error'
        };
    }
}

function formatAuthors(authors) {
    if (!authors || authors.length === 0) return 'Unknown authors';
    
    const names = authors.slice(0, 3).map(a => {
        if (a.family && a.given) return `${a.family}, ${a.given.charAt(0)}.`;
        if (a.family) return a.family;
        if (a.name) return a.name;
        return 'Unknown';
    });
    
    if (authors.length > 3) names.push('et al.');
    return names.join(', ');
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
    
    // Calculate stats
    const valid = currentResults.filter(r => r.valid === true).length;
    const invalid = currentResults.filter(r => r.valid === false).length;
    const errors = currentResults.filter(r => r.valid === null).length;
    
    document.getElementById('stat-total').textContent = currentResults.length;
    document.getElementById('stat-valid').textContent = valid;
    document.getElementById('stat-invalid').textContent = invalid;
    document.getElementById('stat-errors').textContent = errors;
    
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
    const statusText = result.valid === true ? 'Valid' : 
                      result.valid === false ? 'Invalid' : 'Error';
    
    let details = '';
    if (result.valid === true) {
        details = `
            <div class="citation-details">
                <div class="citation-title">${escapeHtml(result.title)}</div>
                <div class="citation-meta">
                    ${escapeHtml(result.authors)} (${result.year}) · ${escapeHtml(result.journal)}
                </div>
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
            <div class="citation-status">
                <span class="status-icon">${statusIcon}</span>
                <span class="status-text">${statusText}</span>
            </div>
            <div class="citation-doi">
                <a href="https://doi.org/${encodeURIComponent(result.doi)}" target="_blank" rel="noopener">
                    ${escapeHtml(result.doi)}
                </a>
            </div>
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
