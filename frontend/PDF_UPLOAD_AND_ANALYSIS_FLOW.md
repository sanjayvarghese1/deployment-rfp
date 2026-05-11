# PDF Upload & Analysis Flow

## 📋 Complete Flow: Vendor Submission → Company Analysis

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VENDOR SIDE - SUBMISSION                         │
└─────────────────────────────────────────────────────────────────────────┘

1. VENDOR SELECTS PDF & SUBMITS
   ├─ Location: /contracts/[id]/apply page
   ├─ Step: "choice" (Quick Upload tab)
   ├─ User selects PDF file from computer
   └─ Clicks "Upload PDF" button

2. HANDLE QUICK UPLOAD PDF (Frontend - No Extraction)
   ├─ Function: handleQuickUploadPdf()
   ├─ Location: src/app/contracts/[id]/apply/page.tsx (line ~270)
   │
   └─ Process:
      ├─ Create FormData with:
      │  ├─ file: PDF file
      │  ├─ contractId: string
      │  └─ userId: vendor user ID
      │
      ├─ POST to /api/upload-proposal
      │  └─ Returns: { success: true, url: publicUrl, fileName }
      │
      └─ IMMEDIATELY INSERT PROPOSAL RECORD (No extraction on vendor side):
         ├─ id: UUID
         ├─ contract_id: contractId
         ├─ vendor_id: user.id
         ├─ vendor_name: profile.company_name
         ├─ price: "" (empty)
         ├─ timeline: "" (empty)
         ├─ experience: "" (empty)
         ├─ proposal_data: "" (⚠️ EMPTY - NO EXTRACTION HERE)
         ├─ proposal_file: publicUrl (Supabase Storage URL)
         ├─ proposal_file_name: fileName
         ├─ proposal_type: "uploaded_pdf"
         ├─ ai_score: null
         ├─ risk_level: null
         └─ created_at: timestamp

3. PDF STORAGE (Cloud - Supabase Storage)
   ├─ Location: /api/upload-proposal endpoint
   ├─ File path: proposals/{contractId}/{userId}/{timestamp}_{fileName}
   ├─ Storage bucket: "proposals"
   ├─ Public URL format:
   │  └─ https://[SUPABASE_URL]/storage/v1/object/public/proposals/[path]
   │
   └─ Result: PDF stored in cloud (NOT in database)

4. NOTIFICATION SENT
   ├─ User: Contract posted_by (company owner)
   ├─ Type: "new_proposal"
   ├─ Message: "{vendor_name} submitted a proposal for {contract_title}"
   └─ Status: unread

5. REDIRECT TO CONTRACT PAGE
   └─ User navigated to /contracts/{id}
      └─ Shows vendor responses tab (company can see submitted proposals)

═══════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────┐
│                    COMPANY SIDE - VENDOR RESPONSES DISPLAY              │
└─────────────────────────────────────────────────────────────────────────┘

6. COMPANY VIEWS VENDOR RESPONSES
   ├─ Location: /contracts/[id] page (Vendor Responses tab)
   ├─ Query: SELECT * FROM proposals WHERE contract_id = {id}
   ├─ Rendered by: ownerTab === "responses"
   │
   └─ For uploaded PDF proposals, shows:
      ├─ ✅ Vendor name, price, timeline, experience (if filled)
      ├─ ✅ Download link to original PDF from Supabase Storage
      ├─ ✅ AI analysis scores (if "Run Analysis" was clicked)
      └─ ❌ NO extracted text displayed
         └─ Reason: proposal_data is empty until analysis runs

7. PROPOSAL DISPLAY (NO EXTRACTION TEXT)
   ├─ Condition: p.proposal_type === "uploaded_pdf"
   ├─ Displays:
   │  ├─ Vendor company name
   │  ├─ Price, timeline, experience fields
   │  └─ "Download Proposal PDF" link to Supabase Storage URL
   │
   ├─ Hidden (removed from UI):
   │  └─ Extracted text display section
   │     └─ Reason: We don't show extracted content in vendor response view
   │
   └─ AI Analysis:
      ├─ Only shown if company owner clicked "Run Analysis"
      ├─ Includes: Scores, criterion breakdown, strengths/weaknesses
      └─ Not shown before analysis is run

═══════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────┐
│                    COMPANY SIDE - AI ANALYSIS                           │
└─────────────────────────────────────────────────────────────────────────┘

8. COMPANY CLICKS "RUN AI ANALYSIS"
   ├─ Location: /contracts/[id] (Vendor Responses tab)
   ├─ Button: "Run AI Analysis"
   ├─ Action: Calls runAIAnalysis() function
   │
   └─ Function Flow:
      ├─ For each proposal with proposal_type === "uploaded_pdf":
      │  └─ proposal_data is empty → Call extraction
      │
      └─ STEP 1: EXTRACT PDF (if needed)
         ├─ Location: src/app/contracts/[id]/page.tsx (runAIAnalysis function)
         ├─ Call: extractPdfText(proposal.proposal_file)
         │
         └─ extractPdfText() function:
            ├─ POST to /api/extract-pdf
            ├─ Body: { pdfUrl: proposal.proposal_file }
            ├─ Endpoint: src/app/api/extract-pdf/route.ts
            │
            └─ Extraction Process:
               ├─ Fetch PDF from Supabase Storage URL
               ├─ Parse PDF content
               ├─ Return extracted text as string
               └─ Result: Plain text extracted from PDF

9. UPDATE PROPOSAL WITH EXTRACTED TEXT
   ├─ Store extracted content in database:
   │  └─ UPDATE proposals SET proposal_data = extractedText
   │     WHERE id = proposal_id
   │
   └─ Note: proposal_data now contains extracted text (for AI analysis only)

10. STEP 2: RUN 3-AGENT AI ANALYSIS PIPELINE
    ├─ Input: All proposals with extracted text (proposal_data)
    ├─ Output: AI scores and analysis for each proposal
    │
    └─ Agent 1: EXTRACTOR
       ├─ Extracts structured info from proposal text
       ├─ Returns: Key capabilities, experience, pricing structure
       └─ Used by: Agent 2 for detailed scoring

    └─ Agent 2: SCORER (Detailed Analysis)
       ├─ Scores each proposal on 5 criteria:
       │  ├─ Technical Fit (40%)
       │  ├─ Cost Efficiency (20%)
       │  ├─ Relevant Experience (20%)
       │  ├─ Timeline Fit (10%)
       │  └─ Compliance Completeness (10%)
       │
       ├─ Returns: Criterion scores, strengths, weaknesses, summary
       └─ Results stored: analysis_reports table

    └─ Agent 3: JUDGE (Final Recommendation)
       ├─ Compares all vendors
       ├─ Recommends best vendor based on:
       │  ├─ Weighted scores
       │  ├─ Risk factors
       │  └─ Budget/timeline fit
       │
       ├─ Returns: Winner, runner-ups, comparative analysis
       └─ Results stored: analysis_reports table

11. ANALYSIS RESULTS SAVED TO DATABASE
    ├─ Table: analysis_reports
    ├─ Fields:
    │  ├─ contract_id
    │  ├─ created_by
    │  ├─ analyses_by_proposal_id: {proposal_id → ProposalAnalysis}
    │  ├─ judge_result: {recommended_vendor, scores, summary}
    │  └─ created_at
    │
    └─ UI Updates:
       ├─ Scores displayed under each proposal
       ├─ Judge recommendation shown at top
       ├─ Vendor comparison chart
       └─ Detailed breakdown collapsible sections

═══════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────┐
│                    DATABASE STATE DURING EACH PHASE                     │
└─────────────────────────────────────────────────────────────────────────┘

PHASE 1: Right after vendor submits PDF
┌─────────────────────────────────────────────────┐
│ proposals table (vendor-submitted PDF)          │
├─────────────────────────────────────────────────┤
│ id              │ uuid                          │
│ contract_id     │ "contract-123"                │
│ vendor_id       │ "vendor-user-123"             │
│ vendor_name     │ "Vendor Company LLC"          │
│ proposal_type   │ "uploaded_pdf"                │
│ proposal_file   │ "https://supabase.../pdf"    │
│ proposal_file_name │ "proposal_2026-05-07.pdf"  │
│ proposal_data   │ "" (EMPTY - no extraction)    │
│ ai_score        │ null                          │
│ risk_level      │ null                          │
│ created_at      │ "2026-05-07T10:30:00Z"        │
└─────────────────────────────────────────────────┘

PHASE 2: After company clicks "Run Analysis"
┌─────────────────────────────────────────────────┐
│ proposals table (with extracted text)           │
├─────────────────────────────────────────────────┤
│ proposal_data   │ "[PDF File: proposal.pdf]\n\n │
│                 │  EXTRACTED TEXT FROM PDF\n\n  │
│                 │  Company Overview:\n          │
│                 │  ... (full extracted content) │
│ ai_score        │ null (updated after analysis) │
│ risk_level      │ null                          │
└─────────────────────────────────────────────────┘

PHASE 3: After AI analysis completes
┌─────────────────────────────────────────────────┐
│ proposals table (with AI scores)                │
├─────────────────────────────────────────────────┤
│ ai_score        │ 78                            │
│ risk_level      │ "low"                         │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ analysis_reports table (analysis results)       │
├─────────────────────────────────────────────────┤
│ id              │ uuid                          │
│ contract_id     │ "contract-123"                │
│ created_by      │ "company-user-123"            │
│ analyses_by_    │ {                             │
│ proposal_id     │   "proposal-1": {...},        │
│                 │   "proposal-2": {...}         │
│                 │ }                             │
│ judge_result    │ {                             │
│                 │   "recommended_vendor": "...", │
│                 │   "scores": {...},            │
│                 │   "summary": "..."            │
│                 │ }                             │
│ created_at      │ "2026-05-07T10:45:00Z"        │
└─────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════

## 🔑 Key Design Principles

### ✅ No Extraction on Vendor Side
- Vendor uploads PDF → stored in cloud
- proposal_data remains EMPTY
- No extraction happens until company initiates analysis

### ✅ No Extracted Text Shown in Vendor Response View
- Company sees downloaded proposal, not extracted text
- Extracted content is internal (for AI analysis only)
- Keeps UI clean and focused on proposal submissions

### ✅ On-Demand Extraction
- Extraction only happens when company clicks "Run Analysis"
- Reduces unnecessary processing and storage
- PDF remains single source of truth in Supabase Storage

### ✅ Separation of Concerns
- **Vendor Side**: Upload → Cloud Storage → Done
- **Company Side - View**: Display proposals, download PDFs
- **Company Side - Analyze**: Extract → Score → Recommend

### ✅ Data Flow
```
Vendor PDF 
   ↓
Supabase Storage (cloud URL)
   ↓
proposals.proposal_file (URL reference)
   ↓ (on "Run Analysis")
   ↓
/api/extract-pdf (extracts text)
   ↓
proposals.proposal_data (extracted content)
   ↓
AI Pipeline (scores & recommends)
   ↓
analysis_reports (results stored)
```

## 📊 Summary Table

| Phase | Location | Action | Storage | proposal_data | UI Display |
|-------|----------|--------|---------|---------------|-----------|
| **1. Submit** | /contracts/[id]/apply | Upload PDF | Supabase Storage | Empty | - |
| **2. Display** | /contracts/[id] | View Responses | Database URL | Empty | PDF Download Link |
| **3. Analyze** | /contracts/[id] | Run Analysis | Updated | Extracted Text | AI Scores |

