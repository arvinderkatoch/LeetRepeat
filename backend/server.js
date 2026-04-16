const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { createClient } = require("@supabase/supabase-js");

const {
  AppError,
  ValidationError,
  AuthError,
  NotFoundError,
  ConflictError,
  logger,
  errorHandler,
  asyncHandler,
} = require("./errorHandler");
const {
  requestLogger,
  requestTimeout,
  createRateLimiter,
  validators,
} = require("./middleware");

const app = express();
const PORT = process.env.PORT || 8000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const NODE_ENV = process.env.NODE_ENV || "development";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

// Validate required environment variables
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// ============ MIDDLEWARE SETUP ============
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = [FRONTEND_URL, "http://localhost:3001", "http://localhost:3000"];
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);

app.use(express.json({ limit: "10kb" })); // Limit payload size
app.use(requestTimeout(30000)); // 30 second timeout
app.use(requestLogger); // Log requests
app.use(createRateLimiter(100, 60000)); // 100 requests per minute

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateInput, days) {
  const date = new Date(dateInput);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysUntil(dateString) {
  const now = new Date();
  const due = new Date(`${dateString}T00:00:00`);
  const diffMs = due.getTime() - new Date(now.toDateString()).getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function getSm2Quality(questionDifficulty, qualityInput) {
  const fallback = {
    Easy: 5,
    Medium: 4,
    Hard: 3,
  };

  const parsed = Number(qualityInput);
  if (Number.isFinite(parsed)) {
    return Math.max(0, Math.min(5, Math.round(parsed)));
  }
  return fallback[questionDifficulty] ?? 4;
}

function computeNextSM2(question, qualityInput) {
  const quality = getSm2Quality(question.difficulty, qualityInput);

  let efactor = Number(question.efactor || 2.5);
  let intervalDays = Number(question.interval_days || 0);
  let repetition = Number(question.repetition || 0);

  efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (efactor < 1.3) efactor = 1.3;

  if (quality < 3) {
    repetition = 0;
    intervalDays = 1;
  } else {
    repetition += 1;
    if (repetition === 1) intervalDays = 1;
    else if (repetition === 2) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(intervalDays * efactor));
  }

  return {
    quality,
    efactor,
    repetition,
    intervalDays,
    nextReviewAt: addDays(new Date(), intervalDays),
  };
}

function toClientQuestion(row) {
  const dueIn = daysUntil(row.next_review_at);
  return {
    ...row,
    days_until_due: dueIn,
    is_due: dueIn <= 0,
  };
}

function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function getNameFromGooglePayload(payload) {
  if (payload.name && String(payload.name).trim()) return String(payload.name).trim();
  if (payload.given_name && String(payload.given_name).trim()) return String(payload.given_name).trim();

  const email = String(payload.email || "").trim().toLowerCase();
  if (email.includes("@")) return email.split("@")[0];

  return "Google User";
}

function isGoogleOnlyAccount(user) {
  const hash = String(user?.password_hash || "");
  return hash.startsWith("GOOGLE_OAUTH:");
}

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "No authentication token provided" });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ============ ROUTES ============

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// ---- AUTHENTICATION ROUTES ----

app.post(
  "/api/auth/register",
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      throw new ValidationError("name, email and password are required", [
        "name",
        "email",
        "password",
      ]);
    }

    if (String(password).length < 6) {
      throw new ValidationError("Password must be at least 6 characters", ["password"]);
    }

    if (!validators.isEmail(email)) {
      throw new ValidationError("Invalid email format", ["email"]);
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(String(password), 10);

    const { data, error } = await supabase
      .from("users")
      .insert({
        name: String(name).trim(),
        email: normalizedEmail,
        password_hash: hashedPassword,
      })
      .select("id, name, email")
      .single();

    if (error) {
      logger.error("Registration error", error, { email: normalizedEmail });

      if (error.code === "23505") {
        throw new ConflictError("Email already exists");
      }
      throw new AppError("Failed to register user", 500);
    }

    const token = generateToken(data);
    return res.status(201).json({ token, user: data });
  })
);

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ValidationError("email and password are required", ["email", "password"]);
    }

    if (!validators.isEmail(email)) {
      throw new ValidationError("Invalid email format", ["email"]);
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, password_hash")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      logger.error("Login database error", error, { email: normalizedEmail });
      throw new AppError("Login failed", 500);
    }

    if (!user) {
      throw new AuthError("Invalid credentials");
    }

    if (!user.password_hash || isGoogleOnlyAccount(user)) {
      throw new AuthError("This account uses Google sign-in. Please continue with Google.");
    }

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) {
      throw new AuthError("Invalid credentials");
    }

    const token = generateToken(user);
    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  })
);

app.post(
  "/api/auth/google",
  asyncHandler(async (req, res) => {
    if (!googleClient || !GOOGLE_CLIENT_ID) {
      throw new AppError("Google sign-in is not configured on server", 500);
    }

    const idToken = String(req.body?.idToken || "").trim();
    if (!idToken) {
      throw new ValidationError("idToken is required", ["idToken"]);
    }

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });
    } catch (err) {
      logger.warn("Google token verification failed", { error: err.message });
      throw new AuthError("Invalid Google token");
    }

    const payload = ticket.getPayload();
    const googleSub = String(payload?.sub || "").trim();
    const normalizedEmail = String(payload?.email || "").trim().toLowerCase();
    const emailVerified = Boolean(payload?.email_verified);

    if (!googleSub || !normalizedEmail || !emailVerified) {
      throw new AuthError("Invalid Google account");
    }

    if (!validators.isEmail(normalizedEmail)) {
      throw new AuthError("Invalid email from Google account");
    }

    const displayName = getNameFromGooglePayload(payload);

    const { data: existingByEmail, error: existingByEmailError } = await supabase
      .from("users")
      .select("id, name, email, password_hash")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingByEmailError) {
      logger.error("Google auth database error", existingByEmailError);
      throw new AppError("Failed to authenticate with Google", 500);
    }

    if (existingByEmail) {
      if (existingByEmail.name && String(existingByEmail.name).trim()) {
        const token = generateToken(existingByEmail);
        return res.json({
          token,
          user: {
            id: existingByEmail.id,
            name: existingByEmail.name,
            email: existingByEmail.email,
          },
        });
      }

      const { data: updatedUser, error: updateError } = await supabase
        .from("users")
        .update({ name: displayName })
        .eq("id", existingByEmail.id)
        .select("id, name, email")
        .single();

      if (updateError) {
        logger.error("Google auth update error", updateError);
        throw new AppError("Failed to update user profile", 500);
      }

      const token = generateToken(updatedUser);
      return res.json({ token, user: updatedUser });
    }

    const { data: createdUser, error: createError } = await supabase
      .from("users")
      .insert({
        name: displayName,
        email: normalizedEmail,
        password_hash: `GOOGLE_OAUTH:${googleSub}`,
      })
      .select("id, name, email")
      .single();

    if (createError) {
      logger.error("Google auth create error", createError);

      if (createError.code === "23505") {
        throw new ConflictError("Google account already linked to another user");
      }
      throw new AppError("Failed to create user from Google account", 500);
    }

    const token = generateToken(createdUser);
    return res.status(201).json({ token, user: createdUser });
  })
);

// ---- QUESTION ROUTES (with pagination) ----

app.get(
  "/api/questions",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const status = req.query.status || "active";
    const difficulty = req.query.difficulty;
    const search = req.query.search;
    const sortBy = req.query.sortBy || "next_review_at";
    const order = (req.query.order || "asc").toLowerCase() === "desc" ? "desc" : "asc";

    // Pagination
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(10, Number(req.query.limit) || 25)); // Min 10, Max 50
    const offset = (page - 1) * limit;

    const allowedSort = {
      next_review_at: "next_review_at",
      difficulty: "difficulty",
      review_count: "review_count",
      created_at: "created_at",
    };

    let query = supabase
      .from("questions")
      .select("*", { count: "exact" })
      .eq("user_id", req.user.userId)
      .order(allowedSort[sortBy] || "next_review_at", { ascending: order === "asc" })
      .range(offset, offset + limit - 1);

    if (status !== "all") {
      query = query.eq("status", status);
    }

    if (difficulty && validators.isValidDifficulty(difficulty)) {
      query = query.eq("difficulty", difficulty);
    }

    if (search && String(search).trim()) {
      query = query.ilike("title", `%${String(search).trim()}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error("Questions fetch error", error, { userId: req.user.userId });
      throw new AppError("Failed to fetch questions", 500);
    }

    return res.json({
      data: (data || []).map(toClientQuestion),
      pagination: {
        page,
        limit,
        total: count || 0,
        hasMore: offset + limit < (count || 0),
      },
    });
  })
);

app.post(
  "/api/questions",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { title, link, difficulty } = req.body;

    // Validation
    if (!title || !link || !difficulty) {
      throw new ValidationError("title, link and difficulty are required", [
        "title",
        "link",
        "difficulty",
      ]);
    }

    if (!validators.isValidDifficulty(difficulty)) {
      throw new ValidationError("difficulty must be Easy, Medium or Hard", ["difficulty"]);
    }

    if (!validators.isUrl(link)) {
      throw new ValidationError("link must be a valid URL", ["link"]);
    }

    if (String(title).trim().length < 3) {
      throw new ValidationError("title must be at least 3 characters", ["title"]);
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("questions")
      .insert({
        user_id: req.user.userId,
        title: String(title).trim(),
        link: String(link).trim(),
        difficulty,
        status: "active",
        review_count: 0,
        repetition: 0,
        total_review_minutes: 0,
        last_reviewed_at: null,
        next_review_at: todayDateString(),
        interval_days: 0,
        efactor: 2.5,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();

    if (error) {
      logger.error("Question creation error", error, { userId: req.user.userId });
      throw new AppError("Failed to add question", 500);
    }

    return res.status(201).json(toClientQuestion(data));
  })
);

app.patch(
  "/api/questions/:id/review",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const minutes = Math.max(0, Number(req.body.minutes || 0));
    const quality = req.body.quality;

    if (!validators.isPositiveInteger(minutes)) {
      throw new ValidationError("minutes must be a non-negative integer", ["minutes"]);
    }

    if (quality !== undefined && !validators.isBetween(quality, 0, 5)) {
      throw new ValidationError("quality must be between 0 and 5", ["quality"]);
    }

    const { data: question, error: findError } = await supabase
      .from("questions")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .maybeSingle();

    if (findError) {
      logger.error("Question fetch error", findError, { id, userId: req.user.userId });
      throw new AppError("Failed to fetch question", 500);
    }

    if (!question) {
      throw new NotFoundError("Question");
    }

    if (question.status !== "active") {
      throw new AppError("Only active questions can be reviewed", 400);
    }

    const sm2 = computeNextSM2(question, quality);
    const reviewedAt = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from("questions")
      .update({
        review_count: Number(question.review_count || 0) + 1,
        repetition: sm2.repetition,
        total_review_minutes: Number(question.total_review_minutes || 0) + minutes,
        last_reviewed_at: reviewedAt,
        next_review_at: sm2.nextReviewAt,
        interval_days: sm2.intervalDays,
        efactor: sm2.efactor,
        last_quality: sm2.quality,
        updated_at: reviewedAt,
      })
      .eq("id", id)
      .eq("user_id", req.user.userId)
      .select("*")
      .single();

    if (updateError) {
      logger.error("Question update error", updateError, { id, userId: req.user.userId });
      throw new AppError("Failed to update question", 500);
    }

    return res.json(toClientQuestion(updated));
  })
);

app.patch(
  "/api/questions/:id/archive",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const id = req.params.id;

    const { error } = await supabase
      .from("questions")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", req.user.userId);

    if (error) {
      logger.error("Archive error", error, { id, userId: req.user.userId });
      throw new AppError("Failed to archive question", 500);
    }

    return res.json({ success: true });
  })
);

app.patch(
  "/api/questions/:id/restore",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const id = req.params.id;

    const { error } = await supabase
      .from("questions")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", req.user.userId);

    if (error) {
      logger.error("Restore error", error, { id, userId: req.user.userId });
      throw new AppError("Failed to restore question", 500);
    }

    return res.json({ success: true });
  })
);

app.delete(
  "/api/questions/:id",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const id = req.params.id;

    const { error } = await supabase
      .from("questions")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user.userId);

    if (error) {
      logger.error("Delete error", error, { id, userId: req.user.userId });
      throw new AppError("Failed to delete question", 500);
    }

    return res.json({ success: true });
  })
);

// ============ 404 AND ERROR HANDLERS ============

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Global error handler (must be last)
app.use(errorHandler);

// ============ START SERVER ============

const server = app.listen(PORT, () => {
  logger.info(`Backend running on http://localhost:${PORT} (NODE_ENV=${NODE_ENV})`);
});

// Handle graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, closing server");
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});
