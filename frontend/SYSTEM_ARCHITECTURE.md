# ProcureLink — System Architecture (UML)

> **Tech Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Auth + PostgreSQL + Storage) · OpenRouter (MiniMax m2.7 + m2.5 fallback) · Nodemailer · jsPDF

---

## 1. High-Level System Architecture

```mermaid
graph TB
    subgraph CLIENT["🖥️ Client — Next.js App (React 19 + TypeScript)"]
        direction TB
        NAVBAR["Navbar"]
        PAGES["Pages"]
        COMPONENTS["Shared Components"]
        CONTEXTS["AuthContext"]
    end

    subgraph API["⚡ API Layer — Next.js API Routes"]
        direction TB
        GEN_RFP["/api/ai/generate-rfp"]
        PARSE_RFP["/api/ai/parse-rfp"]
        ANALYZE["/api/ai/analyze-proposal"]
        CHAT["/api/ai/proposal-chat"]
        REFINE["/api/ai/refine-proposal"]
        RFP_GEN["/api/rfp/generate (SSE)"]
        ACCEPT["/api/proposals/accept"]
    end

    subgraph AI["🤖 AI Engine — Multi-Agent System"]
        direction TB
        OPENROUTER["OpenRouter API\nMiniMax m2.7 · m2.5 fallback"]
        
    end

    subgraph DB["🗄️ Supabase"]
        direction TB
        AUTH["Supabase Auth\n(Email/Password)"]
        FIRESTORE["Firestore DB\nusers · posts · contracts\nproposals · messages\nnotifications · reviews"]
        STORAGE["Supabase Storage\n(PDFs · Images)"]
    end

    EMAIL["📧 Nodemailer\n(Email Notifications)"]

    CLIENT -->|REST calls| API
    CLIENT -->|Auth + Real-time| DB
    API --> AI
    API --> EMAIL
    AI --> OPENROUTER
    
    ACCEPT --> EMAIL
```

---

## 2. Page & Component Structure

```mermaid
graph TD
    LAYOUT["layout.tsx\n(AuthProvider + Navbar)"]

    LAYOUT --> HOME["/ Home\nSocial Feed · Create Posts"]
    LAYOUT --> COMPANIES["/companies\nBrowse · Follow Companies"]
    LAYOUT --> COMPANY_ID["/companies/[id]\nCompany Profile · Reviews"]
    LAYOUT --> CONTRACTS["/contracts\nBrowse Open RFPs"]
    LAYOUT --> CONTRACT_ID["/contracts/[id]\nRFP Details · View Proposals"]
    LAYOUT --> APPLY["/contracts/[id]/apply\nSubmit Proposal (AI Chat)"]
    LAYOUT --> NEW_CONTRACT["/contracts/new\nCreate RFP"]
    LAYOUT --> MESSAGES["/messages\nDirect Messaging"]
    LAYOUT --> NOTIFICATIONS["/notifications\nActivity Alerts"]
    LAYOUT --> INSIGHTS["/insights\nVendor Evaluation Dashboard"]
    LAYOUT --> PROFILE["/profile\nEdit Company Profile"]
    LAYOUT --> LOGIN["/login"]
    LAYOUT --> SIGNUP["/signup"]

    HOME --> PostCard
    CONTRACTS --> ContractCard
    CONTRACT_ID --> ContractCard
    MESSAGES --> MessageBox
    COMPANY_ID --> ProfileHeader
    PROFILE --> ProfileHeader
    APPLY --> RfpChatbot
```

---

## 3. Authentication Flow

```mermaid
sequenceDiagram
    actor User
    participant Login as Login / Signup Page
    participant FBAuth as Supabase Auth
    participant FS as Firestore (users)
    participant Ctx as AuthContext
    participant App as App Pages

    User->>Login: Enter email + password
    Login->>FBAuth: createUser / signIn
    FBAuth-->>Login: User object (UID)

    alt Signup
        Login->>FS: addDoc("users", { profile data })
    end

    FBAuth-->>Ctx: onAuthStateChanged(user)
    Ctx->>FS: onSnapshot("users/{uid}")
    FS-->>Ctx: UserProfile
    Ctx-->>App: useAuth() → { user, profile }
```

---

## 4. Data Model (Entity Relationships)

```mermaid
erDiagram
    USER ||--o{ POST : creates
    USER ||--o{ CONTRACT : posts
    USER ||--o{ PROPOSAL : submits
    USER ||--o{ MESSAGE : sends
    USER ||--o{ NOTIFICATION : receives
    USER ||--o{ REVIEW : writes
    CONTRACT ||--o{ PROPOSAL : has
    USER }o--o{ USER : follows

    USER {
        string id PK
        string company_name
        string email
        string industry
        string location
        string website
        string description
        number rating
        string[] followers
        boolean verified
        string profile_image
        string banner_image
        string founded_year
        string company_size
        string[] specialties
        string phone
        string registration_number
    }

    CONTRACT {
        string contract_id PK
        string title
        string description
        string budget
        string deadline
        string status
        string posted_by FK
        string rfp_document
        string industry
    }

    PROPOSAL {
        string proposal_id PK
        string contract_id FK
        string vendor_id FK
        string vendor_name
        string price
        string timeline
        string experience
        string proposal_data
        string status
    }

    POST {
        string post_id PK
        string user_id FK
        string text
        timestamp created_at
        map reactions
        string[] mentions
    }

    MESSAGE {
        string message_id PK
        string sender_id FK
        string receiver_id FK
        string text
        timestamp timestamp
    }

    NOTIFICATION {
        string notification_id PK
        string user_id FK
        string type
        string message
        boolean read
    }

    REVIEW {
        string review_id PK
        string company_id FK
        string reviewer_id FK
        number rating
        string comment
    }
```

---

## 5. RFP Creation Flow

```mermaid
sequenceDiagram
    actor Owner as Contract Owner
    participant Form as /contracts/new
    participant AI as aiService.generateRFP()
    participant API as /api/ai/generate-rfp
    participant LLM as OpenRouter (MiniMax m2.7)
    participant DB as Firestore (contracts)

    Owner->>Form: Fill project details
    Form->>AI: generateRFP({ title, budget, ... })
    AI->>API: POST request
    API->>LLM: Prompt: Write RFP document
    LLM-->>API: RFP markdown
    API-->>AI: { rfp: string }
    AI-->>Form: Display generated RFP
    Owner->>Form: Review & click "Publish"
    Form->>DB: addDoc("contracts", { ..., rfp_document, status: "open" })
    DB-->>Form: Contract live ✅
```

---

## 6. Vendor Proposal Submission Flow

```mermaid
sequenceDiagram
    actor Vendor
    participant Apply as /contracts/[id]/apply
    participant Parse as aiService.parseRFP()
    participant Chat as RfpChatbot Component
    participant ChatAPI as /api/ai/proposal-chat
    participant LLM as OpenRouter (MiniMax m2.7)
    participant PDF as pdfGenerator
    participant DB as Firestore (proposals)

    Vendor->>Apply: Click "Submit Proposal"
    Apply->>Parse: parseRFP({ rfp_text })
    Parse-->>Apply: RFPAnalysis (structured requirements)
    Apply->>Chat: Start interactive interview

    loop 15 Proposal Sections
        Chat->>ChatAPI: proposalChat({ messages, section })
        ChatAPI->>LLM: Guide vendor through section
        LLM-->>ChatAPI: Question / feedback
        ChatAPI-->>Chat: { reply, section_index }
        Vendor->>Chat: Answer questions
    end

    Chat->>Chat: proposal_ready = true
    Chat->>PDF: generateProposalPDF(proposal_data)
    PDF-->>Vendor: Download PDF
    Chat->>DB: addDoc("proposals", { ... })
```

---

## 7. AI Multi-Agent Evaluation Pipeline

```mermaid
graph TB
    START["📄 Contract RFP + Vendor Proposals"]

    subgraph AGENT1["Agent 1 — EXTRACTOR (MiniMax m2.7)"]
        E1["Parse messy RFP text"]
        E2["Extract clean requirements"]
        E3["Parse each vendor proposal"]
    end

    subgraph AGENT2["Agent 2 — SCORER (Llama 3)"]
        S1["Technical Fit — 30%"]
        S2["Cost Efficiency — 20%"]
        S3["Relevant Experience — 20%"]
        S4["Timeline Fit — 15%"]
        S5["Compliance — 15%"]
        S6["Overall Score (0-100)"]
    end

    subgraph AGENT3["Agent 3 — JUDGE (Llama 3)"]
        J1["Compare all vendor scores"]
        J2["Identify trade-offs"]
        J3["Rank vendors"]
        J4["Select best vendor"]
    end

    RESULT["🏆 Final Result\n• Rankings\n• Recommendations\n• Trade-off Analysis"]

    START --> AGENT1
    AGENT1 -->|Clean extracts| AGENT2
    AGENT2 -->|ProposalAnalysis per vendor| AGENT3
    AGENT3 --> RESULT

    style AGENT1 fill:#e3f2fd,stroke:#1976d2
    style AGENT2 fill:#fff3e0,stroke:#f57c00
    style AGENT3 fill:#e8f5e9,stroke:#388e3c
```

---

## 8. Real-Time Data Flow

```mermaid
graph LR
    subgraph WRITES["Write Operations"]
        W1["Create Post"]
        W2["Send Message"]
        W3["Submit Proposal"]
        W4["Follow Company"]
        W5["React to Post"]
    end

    subgraph FIRESTORE["Firestore (Real-time)"]
        C1[("posts")]
        C2[("messages")]
        C3[("proposals")]
        C4[("users")]
        C5[("notifications")]
    end

    subgraph LISTENERS["onSnapshot Listeners"]
        L1["Home Feed"]
        L2["Message Chat"]
        L3["Notification Bell"]
        L4["Profile Updates"]
    end

    W1 --> C1
    W2 --> C2
    W3 --> C3
    W4 --> C4
    W5 --> C1

    C1 -.->|real-time| L1
    C2 -.->|real-time| L2
    C5 -.->|real-time| L3
    C4 -.->|real-time| L4
```

---

## 9. Services Layer

```mermaid
classDiagram
    class supabase {
        +auth : SupabaseAuth
        +db : Firestore
        +storage : SupabaseStorage
    }

    class aiService {
        +generateRFP(input) string
        +parseRFP(input) RFPAnalysis
        +proposalChat(msgs, ctx) ChatResponse
        +analyzeProposal(input) ProposalAnalysis
        +judgeVendors(rfp, scores) JudgeResult
        +runFullPipeline(contract, vendors) FullPipelineResult
    }

    class pdfGenerator {
        +generateProposalPDF(data, template) Blob
        +downloadProposalPDF(data, template) void
        +TEMPLATE_OPTIONS TemplateOption[]
    }

    class ollama {
        +ollamaChat(model, messages) string
        +ollamaChatJSON(model, messages) object
    }

    class gemini {
        +geminiChat(messages, system) string
        +geminiChatJSON(messages, system) object
    }

    aiService --> ollama : uses
    aiService --> gemini : fallback
    pdfGenerator --> jsPDF : uses
```

---

## 10. Deployment Architecture

```mermaid
graph TB
    BROWSER["🌐 Browser"]
    
    subgraph NEXTJS["Next.js 16 (Turbopack)"]
        SSR["Server Components"]
        CSR["Client Components"]
        APIR["API Routes"]
    end

    subgraph SUPABASE_CLOUD["☁️ Supabase Cloud"]
        FA["Auth Service"]
        FD["Firestore Database"]
        FS["Cloud Storage"]
    end

    subgraph LOCAL["💻 Local AI Server"]
        OLL["Ollama\nLlama 3 · Mistral · Phi"]
    end

    subgraph GOOGLE["☁️ Google Cloud"]
        GEM["Gemini 2.0 Flash"]
    end

    SMTP["📧 SMTP Server\n(Nodemailer)"]

    BROWSER --> NEXTJS
    CSR --> SUPABASE_CLOUD
    APIR --> LOCAL
    APIR --> GOOGLE
    APIR --> SMTP
```


