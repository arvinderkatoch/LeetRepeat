# LeetCode Revision Planner - Free Deployment Guide

Deploy your full-stack app completely free using Vercel, Render.com, and Supabase.

---

## **Prerequisites**

- GitHub account (for repository hosting)
- Supabase account (already configured at https://sfthvakriqyjvfojwydn.supabase.co)
- Frontend and backend code committed to GitHub

---

## **Step 1: Prepare GitHub Repository**

### 1.1 Initialize Git (if not done)
```bash
cd /Users/arvinderkatoch/Desktop/leetcode-revision-app
git init
git add .
git commit -m "Initial commit: LeetCode revision planner"
```

### 1.2 Create GitHub Repository
1. Go to [github.com/new](https://github.com/new)
2. Repository name: `leetcode-revision-app`
3. Click "Create repository"
4. Follow instructions to push code:
```bash
git remote add origin https://github.com/YOUR_USERNAME/leetcode-revision-app.git
git branch -M main
git push -u origin main
```

---

## **Step 2: Deploy Backend to Render.com** (Free)

### 2.1 Create Render Account
1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Authorize Render to access your repositories

### 2.2 Deploy Backend Service
1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub repository
3. Select the repository: `leetcode-revision-app`
4. Fill in settings:
   - **Name**: `leetcode-revision-api`
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Branch**: `main`

5. Click **"Create Web Service"**

### 2.3 Add Environment Variables
1. Go to your service dashboard
2. Click **"Environment"**
3. Add the following variables (from your `.env` file):
   ```
   PORT=3000
   FRONTEND_URL=https://your-vercel-url.vercel.app
   SUPABASE_URL=https://sfthvakriqyjvfojwydn.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=sb_publishable_yg0MFeVdWR-IH2_EUyqcyg_G1aeUO1C
   JWT_SECRET=your-random-secret-key-here
   ```
   
   ⚠️ **Important**: Generate a secure JWT_SECRET:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Click **"Save"** and wait for deployment (2-3 minutes)

### 2.4 Get Your Backend URL
Once deployed, you'll see:
```
https://leetcode-revision-api.onrender.com
```
Copy this URL - you'll need it for the frontend.

---

## **Step 3: Deploy Frontend to Vercel** (Free)

### 3.1 Create Vercel Account
1. Go to [vercel.com](https://vercel.com)
2. Sign up with GitHub
3. Authorize Vercel to access your repositories

### 3.2 Stage Frontend Changes
Before deploying, update the API URL in frontend:

```bash
# Edit frontend/src/App.js
# Change line 3 from:
# const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000/api";
# To keep it but add environment variable
```

### 3.3 Deploy Frontend
1. In Vercel, click **"Import Project"**
2. Select your GitHub repository: `leetcode-revision-app`
3. Click **"Import"**
4. Configure:
   - **Root Directory**: `frontend`
   - **Framework**: `Create React App`
5. Add **Environment Variables**:
   ```
   REACT_APP_API_BASE=https://leetcode-revision-api.onrender.com/api
   ```
   (Replace with your actual Render URL from Step 2.4)

6. Click **"Deploy"**
7. Wait for deployment (1-2 minutes)

### 3.4 Get Your Frontend URL
Once deployed, you'll see:
```
https://leetcode-revision-app.vercel.app
```

---

## **Step 4: Configure Database (Supabase SQL Setup)**

Your database tables need to be created. Run the following:

1. Go to [app.supabase.co](https://app.supabase.co)
2. Select project: `sfthvakriqyjvfojwydn`
3. Navigate to **"SQL Editor"**
4. Click **"New Query"**
5. Copy and paste the entire content of `backend/supabase-schema.sql`
6. Click **"Run"**

**Output should show:**
```
Execute successful
```

---

## **Step 5: Update Backend Environment Variables**

Now that frontend is deployed, update backend's `FRONTEND_URL`:

1. Go back to [render.com](https://render.com)
2. Select your service: `leetcode-revision-api`
3. Go to **"Environment"**
4. Edit `FRONTEND_URL` to:
   ```
   https://leetcode-revision-app.vercel.app
   ```
5. Click **"Save"** - backend will automatically redeploy

---

## **Step 6: Test Your App**

1. Open your frontend URL in browser:
   ```
   https://leetcode-revision-app.vercel.app
   ```

2. Register a new account
3. Add a LeetCode question
4. Mark it as revised
5. Archive and delete it

---

## **Important Notes**

### Free Tier Limitations

| Service | Limit | Impact |
|---------|-------|--------|
| **Render.com** | Spins down after 15 min inactivity | First request takes ~30s to wake up |
| **Vercel** | 100 deployments/month | More than enough for hobby projects |
| **Supabase** | 500 MB database, unlimited auth users | Sufficient for this app |

### Monitoring & Logs

```bash
# View Render backend logs
# Go to Render dashboard → Select service → Logs tab

# View Vercel frontend logs  
# Go to Vercel dashboard → Select project → Deployments tab

# View Supabase logs
# Go to app.supabase.co → SQL Editor or Logs tab
```

### Enable Auto-Deploy

Both Render and Vercel automatically redeploy when you push to GitHub:

```bash
# Make changes locally
git add .
git commit -m "Feature: add new button"
git push origin main

# Vercel redeploys frontend automatically (1-2 min)
# Render needs to be configured (optional):
# - Go to Render service settings
# - Enable "Auto-deploy" for the branch
```

---

## **Cost Estimate**

| Service | Cost |
|---------|------|
| Render.com (free tier) | **$0/month** (includes 512MB RAM) |
| Vercel (free tier) | **$0/month** (includes 100GB bandwidth) |
| Supabase (free tier) | **$0/month** (includes 500MB database) |
| **Total** | **$0/month** ✅ |

---

## **Troubleshooting**

### App won't load
- Check frontend URL in browser (should show deployed Vercel URL)
- Check browser console for errors (F12 → Console tab)
- Verify `REACT_APP_API_BASE` is set correctly in Vercel

### Login/Signup fails with 500 error
- Check Render Logs tab for error messages
- Verify `SUPABASE_SERVICE_ROLE_KEY` is copied correctly (no spaces)
- Verify Supabase schema was created (Step 4)

### Backend takes 30+ seconds on first request
- This is normal on free Render tier (spins down after 15 min)
- Upgrade to paid tier for instant responses

### Questions not loading
- Check browser Network tab (F12 → Network)
- Verify API URL is correct in Vercel environment
- Check Render logs for database connection errors

---

## **Next Steps**

1. **Custom Domain** (optional):
   - Vercel: In project settings → Domains
   - Render: In service settings → Custom Domains

2. **Upgrade to Paid** (when ready):
   - Render: $7/month for always-on service
   - Vercel: Pay-as-you-go (usually $0 for hobby projects)
   - Supabase: $25/month for more database storage

3. **CI/CD Pipeline** (optional):
   - GitHub Actions to run tests before deploy
   - Pre-deployment validation

---

## **Documentation References**

- [Render.com Docs](https://render.com/docs)
- [Vercel Docs](https://vercel.com/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript)
