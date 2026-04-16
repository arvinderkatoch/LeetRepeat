# Architecture Overview

## System Design

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      App.js                             │   │
│  │  - Manages UI State                                     │   │
│  │  - Calls API Client methods                             │   │
│  │  - Displays formatted error messages                    │   │
│  └──────────────────────┬──────────────────────────────────┘   │
│                         │                                        │
│  ┌──────────────────────▼──────────────────────────────────┐   │
│  │                  api.js (API Client)                    │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ apiClient.auth.register()                        │  │   │
│  │  │ apiClient.auth.login()                           │  │   │
│  │  │ apiClient.auth.googleAuth()                      │  │   │
│  │  │ apiClient.questions.getAll()                     │  │   │
│  │  │ apiClient.questions.create()                     │  │   │
│  │  │ apiClient.questions.markReviewed()               │  │   │
│  │  │ apiClient.questions.archive()                    │  │   │
│  │  │ apiClient.questions.restore()                    │  │   │
│  │  │ apiClient.questions.delete()                     │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ Retry Logic (withRetry)                          │  │   │
│  │  │  - 3 retries with exponential backoff            │  │   │
│  │  │  - 500ms → 1s → 2s delay                         │  │   │
│  │  │  - Skips retry for auth/validation errors        │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ Timeout Handling                                 │  │   │
│  │  │  - 10-second timeout per request                 │  │   │
│  │  │  - Aborts hung requests                          │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │ Session Manager                                  │  │   │
│  │  │  - Stores/retrieves JWT token                    │  │   │
│  │  │  - Manages user profile                          │  │   │
│  │  │  - Handles logout                                │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  └───────────────────────┬────────────────────────────────┘   │
└──────────────────────────┼────────────────────────────────────┘
                           │ HTTP/JSON
                           │ Authorization: Bearer <token>
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND (Node.js/Express)                   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              MIDDLEWARE STACK                          │    │
│  │                                                        │    │
│  │  1. CORS Middleware                                   │    │
│  │  2. JSON Parser (limit: 10KB)                         │    │
│  │  3. Request Timeout (30s)                             │    │
│  │  4. Request Logger                                    │    │
│  │  5. Rate Limiter (100 req/min)                        │    │
│  └────────────────────────────────────────────────────────┘    │
│                           │                                     │
│  ┌────────────────────────▼────────────────────────────────┐   │
│  │         ROUTE HANDLERS (asyncHandler wrapper)          │   │
│  │                                                        │   │
│  │  POST   /api/auth/register    ← ValidationError       │   │
│  │  POST   /api/auth/login      ← AuthError             │   │
│  │  POST   /api/auth/google     ← ConflictError         │   │
│  │  GET    /api/questions       ← NotFoundError         │   │
│  │  POST   /api/questions       ← AppError              │   │
│  │  PATCH  /api/questions/:id/review                    │   │
│  │  PATCH  /api/questions/:id/archive                   │   │
│  │  PATCH  /api/questions/:id/restore                   │   │
│  │  DELETE /api/questions/:id                           │   │
│  │                                                        │   │
│  │  All wrapped with:                                    │   │
│  │  - Input validation                                   │   │
│  │  - Error handling                                     │   │
│  │  - Authorization checks                               │   │
│  └────────────────────────┬────────────────────────────────┘   │
│                           │                                     │
│  ┌────────────────────────▼────────────────────────────────┐   │
│  │              ERROR HANDLER MIDDLEWARE                  │   │
│  │                                                        │   │
│  │  Error Classes:                                        │   │
│  │  ├─ ValidationError (400)                             │   │
│  │  ├─ AuthError (401)                                   │   │
│  │  ├─ NotFoundError (404)                               │   │
│  │  ├─ ConflictError (409)                               │   │
│  │  └─ AppError (500)                                    │   │
│  │                                                        │   │
│  │  Response:                                             │   │
│  │  ├─ Production: { error: "User message" }             │   │
│  │  └─ Dev: { error, code, stack, context }              │   │
│  │                                                        │   │
│  │  Server Logs:                                          │   │
│  │  └─ All errors with context for debugging             │   │
│  └────────────────────────┬────────────────────────────────┘   │
└──────────────────────────┼─────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │     SUPABASE (PostgreSQL Database)   │
        │                                      │
        │  Tables:                             │
        │  ├─ users                            │
        │  │  ├─ id (primary key)              │
        │  │  ├─ email (unique index)          │
        │  │  ├─ name                          │
        │  │  ├─ password_hash                 │
        │  │  └─ created_at                    │
        │  │                                   │
        │  └─ questions                        │
        │     ├─ id (primary key)              │
        │     ├─ user_id (foreign key)         │
        │     ├─ title                         │
        │     ├─ link                          │
        │     ├─ difficulty                    │
        │     ├─ status                        │
        │     ├─ review_count                  │
        │     ├─ next_review_at (indexed)      │
        │     ├─ interval_days                 │
        │     ├─ efactor                       │
        │     ├─ created_at (indexed)          │
        │     └─ updated_at                    │
        │                                      │
        │  RLS Policies:                       │
        │  ├─ Users can CRUD own questions     │
        │  ├─ Others blocked                   │
        │  └─ Service role has admin access    │
        └──────────────────────────────────────┘
```

---

## Error Handling Flow

```
Request
   │
   ▼
┌─────────────────────┐
│ Input Validation    │ ← validators.isEmail(), isUrl(), etc.
└─────────────────────┘
   │
   ├─ Invalid? ──→ ValidationError (400)
   │
   ▼
┌─────────────────────┐
│ Authentication      │ ← JWT verification
└─────────────────────┘
   │
   ├─ No token? ──→ AuthError (401)
   ├─ Expired? ──→ AuthError (401)
   └─ Invalid? ──→ AuthError (401)
   │
   ▼
┌─────────────────────┐
│ Authorization       │ ← Check req.user.userId
└─────────────────────┘
   │
   ├─ Not owner? ──→ AppError (403)
   │
   ▼
┌─────────────────────┐
│ Database Operation  │ ← Supabase query
└─────────────────────┘
   │
   ├─ Duplicate key? ──→ ConflictError (409)
   ├─ Not found? ──→ NotFoundError (404)
   ├─ Query error? ──→ AppError (500)
   │
   ▼
┌─────────────────────┐
│ Success Response    │ ← Return data
└─────────────────────┘
   │
   ├─ All errors caught by asyncHandler
   │
   ▼
┌─────────────────────────────────┐
│ Global Error Handler            │
│                                 │
│ Logs:                           │
│ ├─ Error details (dev mode)     │
│ ├─ User ID                      │
│ ├─ Request path                 │
│ └─ Timestamp                    │
│                                 │
│ Returns:                        │
│ ├─ Production: { error: msg }   │
│ └─ Dev: { error, code, stack }  │
└─────────────────────────────────┘
   │
   ▼
┌─────────────────────┐
│ HTTP Response       │
└─────────────────────┘
```

---

## Request Retry Flow (Frontend)

```
User Action (e.g., fetch)
   │
   ▼
┌──────────────────────────┐
│ withRetry (attempt 1)    │
└──────────────────────────┘
   │
   ├─ Success? ──→ Return data ✓
   │
   ├─ Auth/Validation error? ──→ Throw immediately ✗
   │
   ├─ Network/Timeout error?
   │  └─ Set timeout: 500ms
   │     │
   │     ▼
   │  ┌──────────────────────────┐
   │  │ withRetry (attempt 2)    │
   │  └──────────────────────────┘
   │     │
   │     ├─ Success? ──→ Return data ✓
   │     │
   │     ├─ Auth/Validation error? ──→ Throw ✗
   │     │
   │     ├─ Network/Timeout error?
   │     │  └─ Set timeout: 1000ms
   │     │     │
   │     │     ▼
   │     │  ┌──────────────────────────┐
   │     │  │ withRetry (attempt 3)    │
   │     │  └──────────────────────────┘
   │     │     │
   │     │     ├─ Success? ──→ Return data ✓
   │     │     │
   │     │     └─ Any error? ──→ Throw ✗
   │
   ▼
┌──────────────────────────┐
│ Catch in App Component   │
└──────────────────────────┘
   │
   ▼
┌──────────────────────────┐
│ formatErrorMessage()     │
│ Convert to user-friendly │
└──────────────────────────┘
   │
   ▼
┌──────────────────────────┐
│ Display Error in UI      │
└──────────────────────────┘
```

---

## Request Flow with Pagination

```
GET /api/questions?status=active&difficulty=Medium&page=2&limit=25
   │
   ▼
┌────────────────────────────────────┐
│ Parse Query Parameters             │
│ - status: "active"                 │
│ - difficulty: "Medium"             │
│ - page: 2                          │
│ - limit: 25 (capped at 50)         │
└────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────┐
│ Calculate Offset                   │
│ offset = (page - 1) * limit        │
│ offset = 1 * 25 = 25               │
│                                    │
│ Query: .range(25, 49)              │
│ Returns items 26-50                │
└────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────┐
│ Build Dynamic Query                │
│ - .eq("status", "active")          │
│ - .eq("difficulty", "Medium")      │
│ - .order("next_review_at", asc)    │
│ - .select("*", {count: "exact"})   │
└────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────┐
│ Fetch from Database                │
│ Total count: 152 questions         │
│ Returned: 25 items (indices 25-49) │
└────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────┐
│ Response to Frontend               │
│ {                                  │
│   data: [...25 items...],          │
│   pagination: {                    │
│     page: 2,                       │
│     limit: 25,                     │
│     total: 152,                    │
│     hasMore: true                  │
│   }                                │
│ }                                  │
└────────────────────────────────────┘
   │
   ▼
┌────────────────────────────────────┐
│ Frontend Pagination UI             │
│ - Show page 2 of 7                 │
│ - "Next" button enabled            │
│ - "Previous" button enabled        │
│ - Load 25 items at a time          │
└────────────────────────────────────┘
```

---

## Rate Limiting Logic

```
Request arrives
   │
   ▼
┌────────────────────────────┐
│ Get Client ID              │
│ source = req.user.userId   │ (authenticated)
│ OR req.ip                  │ (unauthenticated)
└────────────────────────────┘
   │
   ▼
┌────────────────────────────┐
│ Get Request History        │
│ clientRequests.get(source) │
└────────────────────────────┘
   │
   ▼
┌────────────────────────────┐
│ Filter Old Requests        │
│ Keep only last 60s requests│
│ (remove > 60s old)         │
└────────────────────────────┘
   │
   ▼
┌────────────────────────────┐
│ Add Current Timestamp      │
│ requests.push(now)         │
└────────────────────────────┘
   │
   ▼
┌────────────────────────────┐
│ Check Limit                │
│ if requests.length > 100   │
└────────────────────────────┘
   │
   ├─ YES ──→ Send 429 (Too Many Requests) ✗
   │
   └─ NO ──→ Allow request ✓
             │
             ▼
          [Process Request]
```

---

## Component Dependencies

```
frontend/
├── src/
│   ├── App.js          (Uses)─→ api.js
│   ├── api.js          (Exports: apiClient, sessionManager, formatErrorMessage)
│   ├── index.js
│   └── styles.css
│
backend/
├── server.js           (Imports) → errorHandler.js
│                       (Imports) → middleware.js
│
├── errorHandler.js     (Exports: AppError, ValidationError, etc.)
│
└── middleware.js       (Exports: requestLogger, rate limiter, validators)
```

---

## Data Flow: Add Question

```
User Action: Click "Add Question"
   │
   ▼
┌──────────────────────────────────┐
│ handleAddQuestion(event)         │
│ - Prevent default                │
│ - Clear error state              │
└──────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────┐
│ apiClient.questions.create(...)  │
│ - Pass title, link, difficulty   │
└──────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────┐
│ fetchWithTimeout()               │
│ - Set 10s timeout                │
│ - Add token to headers           │
│ - Enable 1 retry (no retry)      │
└──────────────────────────────────┘
   │
   ▼
   HTTP POST /api/questions
   │
   └─→ Backend Server
       │
       ▼
       ┌──────────────────────────┐
       │ Route: POST /api/questions│
       │ Middleware: authMiddleware│
       └──────────┬───────────────┘
                  │
                  ▼
                  ┌──────────────────────┐
                  │ asyncHandler wrapper │
                  └──────────┬───────────┘
                             │
                             ▼
                             ┌──────────────────────────┐
                             │ Input Validation         │
                             │ - title exists?          │
                             │ - link is valid URL?     │
                             │ - difficulty valid?      │
                             └──────────┬───────────────┘
                                        │
                                ├─ Error → ValidationError
                                │
                                ▼
                                ┌──────────────────────┐
                                │ Insert to Database   │
                                │ - Set user_id        │
                                │ - Set timestamps     │
                                │ - Initialize fields  │
                                └──────────┬───────────┘
                                           │
                                    ├─ Error → AppError
                                    │
                                    ▼
                                    ┌──────────────────┐
                                    │ Return 201 +data │
                                    └────────┬─────────┘
       │
       └─────────────────────────────
                                    │
   ◄────────────────────────────────┘ Response
   │
   ▼
┌──────────────────────────────────┐
│ Check response.ok                │
│ Parse JSON                       │
└──────────────────────────────────┘
   │
   ├─ Error → Throw ApiError
   │
   ▼
┌──────────────────────────────────┐
│ Catch Error (or Success)         │
│ If error: formatErrorMessage()   │
│ Set error state or reload        │
└──────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────┐
│ Update UI                        │
│ - Show success message           │
│ - Add question to list           │
│ - Refresh pagination             │
└──────────────────────────────────┘
```

---

## Security Model

```
┌─────────────────────────────────────────────────────┐
│               PUBLIC (No Auth Required)              │
│                                                     │
│  - POST /api/auth/register                         │
│  - POST /api/auth/login                            │
│  - POST /api/auth/google                           │
│  - GET  /api/health                                │
│                                                     │
│  Security: Input validation, rate limiting         │
└─────────────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│           PROTECTED (JWT Auth Required)              │
│                                                     │
│  All /api/questions/* endpoints                    │
│                                                     │
│  Security:                                         │
│  ├─ JWT verification                              │
│  ├─ User ID matching in queries                   │
│  ├─ Database RLS policies                         │
│  ├─ Input validation                              │
│  └─ Rate limiting                                 │
│                                                     │
│  Data Filtering:                                   │
│  └─ .eq("user_id", req.user.userId)               │
│     (Only return own data)                         │
└─────────────────────────────────────────────────────┘
```

---

This architecture ensures:
✅ **Separation of Concerns**: Frontend, API, Error Handling, Database
✅ **Error Isolation**: Errors caught at right level
✅ **Scalability**: Pagination, rate limiting, caching-ready
✅ **Security**: Auth, validation, SQL injection prevention
✅ **Reliability**: Retries, timeouts, graceful degradation
