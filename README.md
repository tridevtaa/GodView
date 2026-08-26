# GodView — School Management System

A single map page: your school is pinned. Click it, and every bus route for
that school appears — stops, and how many students board at each stop. A
separate "Upload Data" page lets you push routes/buses/drivers from Excel.

**Cost: $0.** Firebase Firestore free "Spark" plan (no credit card), Leaflet +
OpenStreetMap for maps (no API key, no billing ever), and a Python backend
deployable free on Render.com.

---

## 1. Project structure

```
godview-mvp/
  frontend/       React app (map page + upload page)
  backend/        Python Flask app (parses Excel -> Firestore)
  sample-data/    Example .xlsx templates matching the required columns
```

---

## 2. Set up Firebase (free, ~5 minutes)

1. Go to https://console.firebase.google.com and create a new project (skip
   Google Analytics, not needed).
2. In the left menu, go to **Build > Firestore Database > Create database**.
   Choose **Start in test mode** for the MVP (tighten security rules later).
3. Go to **Project settings (gear icon) > General**, scroll to "Your apps",
   click the web icon `</>`, register an app (no hosting needed). Copy the
   `firebaseConfig` object it gives you.
4. Copy `frontend/.env.example` to `frontend/.env`, then paste those Firebase
   values into the `VITE_FIREBASE_*` variables.
5. For the backend to write data, go to **Project settings > Service accounts
   > Generate new private key**. This downloads a `serviceAccountKey.json`
   file. Put it inside the `backend/` folder (never commit this file to a
   public repo).

---

## 3. Run the backend locally

```bash
cd backend
python3.12 -m venv venv
source venv/bin/activate      # Windows PowerShell: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt
export GOOGLE_APPLICATION_CREDENTIALS="serviceAccountKey.json"   # PowerShell: $env:GOOGLE_APPLICATION_CREDENTIALS="serviceAccountKey.json"
python app.py
```

Backend runs at `http://localhost:5000`.

Requirements are pinned to `pandas==3.0.3` / `openpyxl==3.1.5`, which have
prebuilt wheels for Python 3.14 as well as 3.11/3.12. If you ever see an
"openpyxl" import/version error, run
`pip install -U openpyxl` inside the venv.

## 4. Run the frontend locally

```bash
cd frontend
npm install
cp .env.example .env     # Windows PowerShell: Copy-Item .env.example .env
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

Your `frontend/.env` should contain both:
- `VITE_BACKEND_URL=http://localhost:5000`
- the `VITE_FIREBASE_*` values from your Firebase web app config

## 4.1 Start both services with one command on Windows

After backend setup, frontend setup, and Firebase config are in place, run:

```powershell
cd C:\path\to\godview-mvp
.\start-local.ps1
```

This opens two PowerShell windows:
- backend at `http://localhost:5000`
- frontend at `http://localhost:5173`

---

## 5. Add your first data (via the Upload Data page)

Use the templates in `sample-data/` as a starting point — open them in Excel,
replace with your real schools/drivers/buses/routes, keep the same column
names, then upload each one on the **Upload Data** page in this order:
schools → drivers → buses → routes.

**Routes sheet** is one row *per stop* — rows sharing the same `route_id`
become one route with an ordered list of stops:

| route_id | school_id | bus_id | stop_order | stop_name | lat | lng | students_count |
|---|---|---|---|---|---|---|---|
| RT001 | SCH001 | BUS001 | 1 | Saha Chowk | 29.96 | 76.83 | 8 |
| RT001 | SCH001 | BUS001 | 2 | Kalpi Village | 29.95 | 76.87 | 5 |

---

## 6. Add your logo

Replace `frontend/public/logo.png` with your own GodView logo (already
pre-filled with the logo you shared).

---

## 7. Deploy for free

**Frontend** — Vercel or Netlify free tier:
- Push this repo to GitHub, import it in Vercel, set the root directory to
  `frontend`, and add an env var `VITE_BACKEND_URL` pointing at your deployed
  backend URL (step below).

**Backend** — Render.com free web service:
- New Web Service → connect the repo → root directory `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app`
- Add an environment variable `FIREBASE_SERVICE_ACCOUNT_JSON` and paste the
  **entire contents** of your `serviceAccountKey.json` file as the value
  (this avoids uploading the file itself).
- Free Render services sleep after ~15 minutes of no traffic and take a few
  seconds to wake up on the next request — fine for an admin upload page that
  isn't used constantly.

---

## Data model (Firestore collections)

- `schools/{school_id}` → `{ name, lat, lng }`
- `drivers/{driver_id}` → `{ name, phone }`
- `buses/{bus_id}` → `{ busNumber, driverId, capacity }`
- `routes/{route_id}` → `{ schoolId, busId, stops: [{ order, name, lat, lng, studentsCount }] }`

## Notes / next steps (not built in this MVP, add later if needed)

- Firestore security rules are in "test mode" (open) — lock this down before
  going live, e.g. require login for the Upload page.
- No authentication yet — anyone with the URL can currently upload data.
- No live GPS bus tracking — this MVP shows planned routes/stops, not
  real-time bus position.
