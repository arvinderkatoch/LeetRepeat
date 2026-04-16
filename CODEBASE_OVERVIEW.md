# LeetCode Revision App - Comprehensive Codebase Overview

## Executive Summary

This is a full-stack **LeetCode Spaced Repetition Tracker** built with:
- **Backend**: Node.js + Express.js
- **Frontend**: React 18
- **Database**: Supabase (PostgreSQL)
- **Authentication**: JWT + Google OAuth 2.0
- **Deployment**: Free tier (Render.com for backend, Vercel for frontend)

---

## 1. Backend Structure

### 1.1 Server Setup (`server.js`)

**Framework**: Express.js on Node.js
- **Port**: 8000 (default) or process.env.PORT
- **Entry Point**: `server.js`

**Key Initialization**:
```javascript
// Environment Setup
- dotenv for configuration management
- PORT defaults to 8000
- FRONTEND_URL defaults to http://localhost:3000

// Database Client
- Supabase client with SERVICE_ROLE_KEY (admin access)
- Google OAuth2 client initialized if GOOGLE_CLIENT_ID provided

// Middleware Stack
1. CORS with whitelist: [FRONTEND_URL, localhost:3001, localhost:3000]
2. Express JSON parser
3. JWT authentication middleware (authMiddleware)
```

### 1.2 Backend Dependencies (`package.json`)

```json
{
  "@supabase/supabase-js": "^2.49.4" - Database client
  "bcryptjs": "^2.4.3" - Password hashing
  "cors": "^2.8.5" - Cross-origin resource sharing
  "dotenv": "^16.4.5" - Environment configuration
  "express": "^4.19.2" - Web framework
  "google-auth-library": "^9.15.1" - Google OAuth verification
  "jsonwebtoken": "^9.0.2" - JWT creation/verification
}
```

### 1.3 Middleware & Authentication

#### Authentication Middleware
```javascript
function authMiddleware(req, res, next)
- Extracts Bearer token from Authorization header
- Verifies JWT with JWT_SECRET
- Sets req.user = { userId, email, name }
- Returns 401 if token missing or invalid
- Applied to all protected endpoints
```

#### CORS Configuration
```javascript
Allowed origins:
1. FRONTEND_URL (from env)
2. http://localhost:3001
3. http://localhost:3000

Rejects requests from other origins with 403 error
```

### 1.4 Error Handling Patterns

**Pattern**: Try-catch wrapper + explicit error responses

**Error Response Format**:
```json
{ "error": "Error message as string" }
```

**HTTP Status Codes Used**:
- `201`: Resource created (register, create question)
- `400`: Bad request (validation failed, missing fields)
- `401`: Unauthorized (invalid credentials, invalid token)
- `404`: Not found (question doesn't exist)
- `409`: Conflict (email already exists, duplicate resource)
- `500`: Server error (unhandled exceptions)

**Error Handling Patterns**:
1. **Validation errors** → 400 with descriptive message
2. **Authentication errors** → 401 with "Unauthorized" or "Invalid token"
3. **Database errors** → 500 with generic message (never exposing DB details)
4. **Supabase-specific errors** → Check error.code for conflict (23505 = duplicate key)
5. **Catch-all try-catch** → 500 generic error (prevents crash dumps)

---

## 2. API Endpoints & Error Handling

### 2.1 Authentication Endpoints

#### POST `/api/auth/register`
**Purpose**: User registration with email/password
```javascript
Request Body:
{
  name: string (required),
  email: string (required),
  password: string (min 6 chars, required)
}

Errors:
- 400: Missing fields or password < 6 chars
- 409: Email already exists (Supabase code 23505)
- 500: Registration failed

Success Response (201):
{
  token: "jwt_token",
  user: { id, name, email }
}
```

#### POST `/api/auth/login`
**Purpose**: Traditional email/password login
```javascript
Request Body:
{
  email: string (required),
  password: string (required)
}

Errors:
- 400: Missing email or password
- 401: Invalid credentials OR account is Google-only
- 500: Login failed

Success Response (200):
{
  token: "jwt_token",
  user: { id, name, email }
}
```

#### POST `/api/auth/google`
**Purpose**: Google OAuth 2.0 sign-in/up
```javascript
Request Body:
{
  idToken: string (From Google's response.credential)
}

Flow:
1. Verifies idToken with Google API
2. Extracts email, name, google_sub
3. Looks up user by email
4. If exists: logs in user (updates name if needed)
5. If not exists: creates new user with google_sub marker

Errors:
- 400: Missing idToken
- 401: Invalid Google payload OR failed verification
- 409: Google account already linked to different user
- 500: Google sign-in not configured OR database error

Success Response (200 or 201):
{
  token: "jwt_token",
  user: { id, name, email }
}

Security Detail:
- Google accounts marked with password_hash = "GOOGLE_OAUTH:{google_sub}"
- Prevents login attempt with wrong auth method
```

### 2.2 Questions Endpoints (All require authMiddleware)

#### GET `/api/questions`
**Purpose**: Fetch questions with filtering and sorting
```javascript
Query Parameters:
- status: "active" (default) | "archived" | "all"
- difficulty: "Easy" | "Medium" | "Hard" (optional)
- search: string - searches title via ilike (optional)
- sortBy: "next_review_at" (default) | "difficulty" | "review_count" | "created_at"
- order: "asc" (default) | "desc"

Errors:
- 401: Unauthorized (no valid token)
- 500: Failed to fetch questions

Response (200): Array of questions with computed fields
[
  {
    id,
    user_id,
    title,
    link,
    difficulty,
    status,
    review_count,
    repetition,
    total_review_minutes,
    last_reviewed_at,
    next_review_at,
    interval_days,
    efactor,
    last_quality,
    created_at,
    updated_at,
    days_until_due: calculated field,
    is_due: calculated field (true if days_until_due <= 0)
  },
  ...
]

Security: Automatically filtered by user_id
```

#### POST `/api/questions`
**Purpose**: Create a new question
```javascript
Request Body:
{
  title: string (required),
  link: string (required, url format),
  difficulty: "Easy" | "Medium" | "Hard" (required)
}

Errors:
- 401: Unauthorized
- 400: Missing fields OR invalid difficulty
- 500: Failed to add question

Response (201): Single question object (with calculated fields)

Initial Values:
- status: "active"
- review_count: 0
- next_review_at: today
- interval_days: 0
- efactor: 2.5
- repetition: 0
- total_review_minutes: 0
```

#### PATCH `/api/questions/:id/review`
**Purpose**: Mark question as reviewed, update SM-2 algorithm values
```javascript
Request Body:
{
  minutes: number (optional, defaults to 0),
  quality: number (optional, 0-5)
}

Errors:
- 401: Unauthorized
- 404: Question not found
- 400: Question is not active (archived questions can't be reviewed)
- 500: Failed to update question

Response (200): Updated question object

SM-2 Algorithm Applied:
- Calculates efactor (ease factor)
- Determines next repetition interval
- Sets next_review_at based on quality and difficulty
- Updates review_count and total_review_minutes
- Only allows review if is_due = true (frontend enforces, backend allows)
```

#### PATCH `/api/questions/:id/archive`
**Purpose**: Archive a question (stop revising, keep history)
```javascript
Errors:
- 401: Unauthorized
- 404: Question not found
- 500: Failed to archive

Response (200): { success: true }

Effect: Sets status to "archived"
```

#### PATCH `/api/questions/:id/restore`
**Purpose**: Restore archived question to active
```javascript
Errors:
- 401: Unauthorized
- 404: Question not found
- 500: Failed to restore

Response (200): { success: true }

Effect: Sets status back to "active"
```

#### DELETE `/api/questions/:id`
**Purpose**: Permanently delete a question
```javascript
Errors:
- 401: Unauthorized
- 404: Question not found
- 500: Failed to delete

Response (200): { success: true }

Effect: Remove from database (irreversible)
```

### 2.3 Health Check
```javascript
GET /api/health
Response (200): { ok: true }
```

---

## 3. Frontend Structure

### 3.1 Frontend Dependencies (`package.json`)

```json
{
  "react": "^18.3.1" - UI library
  "react-dom": "^18.3.1" - DOM rendering
  "react-scripts": "5.0.1" - CRA build tooling
}
```

### 3.2 Components

#### App.js - Main Component
**Purpose**: Core application logic and UI rendering

**Key State**:
```javascript
token: string - JWT token for authentication
user: object - { id, name, email }
darkMode: boolean - Dark mode toggle
questionForm: object - { title, link, difficulty }
activeQuestions: array - Active revision questions
archivedQuestions: array - Archived questions
minutesById: object - Maps question ID → minutes entered
qualityById: object - Maps question ID → quality rating
filters: object - { difficulty, sortBy, order, search }
loading: boolean - Loading state
error: string - Current error message
```

**Key Functions**:
1. `fetchQuestions()` - GET /questions with filters
2. `handleAddQuestion()` - POST /questions
3. `markReviewed()` - PATCH /questions/:id/review
4. `archiveQuestion()` - PATCH /questions/:id/archive
5. `restoreQuestion()` - PATCH /questions/:id/restore
6. `deleteQuestion()` - DELETE /questions/:id
7. `logout()` - Clear auth state

### 3.3 Error Handling in Frontend

**Pattern**: Try-catch with error state display

**Error Response Handling**:
```javascript
// Universal error handler pattern
try {
  const response = await fetch(endpoint, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Generic error message");
  // Handle success
} catch (err) {
  setError(err.message || "Default error message");
}
```

**Error Display**:
```javascript
{error ? <p className="error">{error}</p> : null}
// Displayed at bottom of app, cleared on new operations
```

**Authentication Error Handling**:
```javascript
- Google sign-in failure: Caught in callback, sets error
- Token missing: Prevents API calls, shows error
- Invalid token (401): Caught in fetch response, displays error message
- Google Client ID missing: Sets error during initialization
```

**API Error Messages Handled**:
```javascript
- "Could not fetch questions"
- "Failed to add question"
- "Failed to review question"
- "Failed to archive question"
- "Failed to restore question"
- "Failed to delete question"
- "Could not authenticate with Google"
- Custom error from backend (data.error)
```

### 3.4 Styling
- **File**: `styles.css`
- **Features**: Responsive grid layout, dark mode support (CSS class `dark-mode`)
- **Error styling**: `.error` class for red error messages
- **Input validation**: HTML required attributes prevent empty form submission

### 3.5 API Communication

**Config**:
```javascript
const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000/api"
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID
```

**Auth Header Helper**:
```javascript
authHeaders(json = false) {
  const headers = { Authorization: `Bearer ${token}` };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}
```

**Google OAuth**:
- Loads Google Sign-In script from CDN
- Renders Google sign-in button
- Verifies idToken on click, sends to backend

---

## 4. Database Schema

### Users Table
```sql
id (UUID, primary key)
name (text, not null)
email (text, not null, unique)
password_hash (text, nullable)
google_sub (text, unique, nullable) - Google OAuth identifier
created_at (timestamptz, auto)
```

**Security**: 
- Row-Level Security (RLS) enforced by Supabase
- Google accounts: password_hash = "GOOGLE_OAUTH:{google_sub}"

### Questions Table
```sql
id (UUID, primary key)
user_id (UUID, foreign key → users.id, on delete cascade)
title (text, not null)
link (text, not null)
difficulty (text, check: 'Easy'|'Medium'|'Hard')
status (text, default: 'active', check: 'active'|'archived')
review_count (int, default: 0) - SM-2 tracking
repetition (int, default: 0) - SM-2 tracking
total_review_minutes (int, default: 0) - Study time
last_reviewed_at (timestamptz, nullable)
next_review_at (date, not null) - SM-2 scheduling
interval_days (int, default: 0) - Days between reviews
efactor (numeric, default: 2.5) - SM-2 ease factor
last_quality (int, nullable) - Last review quality (0-5)
created_at (timestamptz, auto)
updated_at (timestamptz, auto)
```

**Indexes**:
- `user_id` - For user-scoped queries
- `status` - For active/archived filtering
- `next_review_at` - For due date sorting

---

## 5. Spaced Repetition (SM-2) Algorithm

### Implementation Location
`backend/server.js` - `computeNextSM2(question, qualityInput)` function

### Algorithm Logic
```
Input: question object, quality rating (0-5)

1. Parse quality: If valid number 0-5, use it; else use difficulty default
   - Easy → default 5
   - Medium → default 4
   - Hard → default 3

2. Calculate new efactor:
   efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
   if efactor < 1.3: efactor = 1.3

3. Determine interval (days between reviews):
   if quality < 3:
     - Reset: repetition = 0, intervalDays = 1
   else:
     - repetition += 1
     - if repetition == 1: intervalDays = 1
     - else if repetition == 2: intervalDays = 6
     - else: intervalDays = round(intervalDays * efactor)

4. Output: { quality, efactor, repetition, intervalDays, nextReviewAt }
```

### Integration
- Applied on every PATCH `/api/questions/:id/review`
- Updates stored in database for persistence
- Frontend calculates `days_until_due` for display

---

## 6. Existing Error Handling Mechanisms

### Backend Error Handling

| Layer | Mechanism | Details |
|-------|-----------|---------|
| **Input Validation** | Explicit checks | Validate required fields, format, constraints |
| **Authentication** | JWT middleware | authMiddleware rejects 401 if token invalid |
| **Authorization** | User ID check | All queries filtered by user_id to prevent cross-user access |
| **Database Errors** | Try-catch + checks | Specific handling for duplicate keys (code 23505) |
| **Generic Fallback** | Catch-all try-catch | Returns 500 with generic message |
| **Environment Check** | Process.exit(1) | Crashes on missing critical env vars at startup |

### Frontend Error Handling

| Layer | Mechanism | Details |
|-------|-----------|---------|
| **Form Validation** | HTML5 + JS | Required fields, URL validation |
| **Network Errors** | Try-catch | Caught during fetch |
| **API Errors** | Response.ok check | Parses error.message from response JSON |
| **State Management** | error state | Displayed in UI, cleared on retry |
| **Google Auth** | Callback try-catch | Sets error if sign-in fails |
| **Initialization** | Retry logic | Retries Google SDK load every 250ms |

---

## 7. Security Measures

### SQL Injection Prevention
✅ **No raw SQL queries** - All queries use Supabase client with parameterized methods
- `eq()`, `ilike()`, `select()` automatically parameterize values
- User input (search strings, IDs) never concatenated into SQL

### Authentication Security
✅ **JWT tokens**: Signed with JWT_SECRET, 7-day expiration
✅ **Password hashing**: bcryptjs with 10 salt rounds
✅ **Google OAuth**: Verified with google-auth-library before trusting payload
✅ **Email verification**: Google-verified emails only accepted

### Authorization Security
✅ **Row-Level Security**: Database-level RLS on users/questions
✅ **User ID filtering**: All queries include `.eq("user_id", req.user.userId)`
✅ **CORS whitelist**: Only specified origins allowed
✅ **No private data exposure**: Custom query selects prevent leaking sensitive fields

### Data Protection
✅ **HTTPS recommended**: Deploy with TLS
✅ **Environment variables**: Secrets not in code (dotenv)
✅ **Token storage**: Frontend localStorage (vulnerable to XSS, but standard)

---

## 8. Configuration & Environment Variables

### Backend (.env)
```
PORT=8000
FRONTEND_URL=http://localhost:3000
SUPABASE_URL=https://sfthvakriqyjvfojwydn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_publishable_...
JWT_SECRET=your-secret-key-here
GOOGLE_CLIENT_ID=228585152625-7t2ehq3ajjabgr92q7509pdtn9dutahj.apps.googleusercontent.com
```

### Frontend (.env.example)
```
REACT_APP_API_BASE=http://localhost:4000/api
REACT_APP_GOOGLE_CLIENT_ID=228585152625-7t2ehq3ajjabgr92q7509pdtn9dutahj.apps.googleusercontent.com
GOOGLE_CLIENT_ID=228585152625-7t2ehq3ajjabgr92q7509pdtn9dutahj.apps.googleusercontent.com
```

---

## 9. Deployment Information

### Current Setup
- Backend: Render.com (free tier) - Node.js with npm
- Frontend: Vercel (free tier) - React build
- Database: Supabase - PostgreSQL (free tier with row limits)

### Build Commands
```
Backend: npm install && npm start
Frontend: npm run build && npx serve build
```

### Important URLs
- Supabase URL: `https://sfthvakriqyjvfojwydn.supabase.co`
- Google OAuth Client ID: `228585152625-7t2ehq3ajjabgr92q7509pdtn9dutahj.apps.googleusercontent.com`

---

## 10. Key Architecture Decisions

| Decision | Rationale | Trade-offs |
|----------|-----------|-----------|
| **Supabase** | Managed DB + auth support | Vendor lock-in, free tier limits |
| **JWT tokens** | Stateless auth, easy scaling | Token cannot be revoked server-side |
| **SM-2 algorithm** | Proven spaced repetition formula | Requires reviewing questions on schedule |
| **localStorage** | Simple persistence | Vulnerable to XSS, deleted on clear cache |
| **Parameterized queries** | Built-in SQL injection protection | Less flexibility for complex queries |
| **Status-based filtering** | Simple soft-delete alternative | Requires cleanup of old archived records |
| **Monorepo structure** | Easier to manage as single project | Requires separate deploy for changes |

---

## 11. Testing & Development

### Local Development
```bash
# Terminal 1: Backend
cd backend
npm install
npm start  # Runs on :8000

# Terminal 2: Frontend
cd frontend
npm install
npm start  # Runs on :3000 with CRA-dev server
```

### API Testing
- Health check: `curl http://localhost:8000/api/health`
- Register: `POST /api/auth/register` with email, name, password
- Login: `POST /api/auth/login` with email, password
- Questions: All require `Authorization: Bearer {token}` header

---

## 12. Future Enhancement Opportunities

1. **Centralized error handling**: Extract error codes/messages to constants
2. **Request logging**: Add morgan or pino for debugging
3. **Input validation library**: Use joi or zod for stricter validation
4. **Error tracking**: Integrate Sentry for production monitoring
5. **API documentation**: Add Swagger/OpenAPI spec
6. **Rate limiting**: Add express-rate-limit to prevent abuse
7. **Testing**: Add Jest tests for backend + React Testing Library for frontend
8. **Caching**: Add Redis for question data caching
9. **WebSocket support**: Real-time sync across devices
10. **Email notifications**: Remind users of due questions
