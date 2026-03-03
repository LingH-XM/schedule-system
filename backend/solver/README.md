# OR-Tools CP-SAT Solver Service

## 1) Install

```bash
cd backend/solver
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 2) Run

```bash
cd backend/solver
source .venv/bin/activate
uvicorn solver_api:app --host 127.0.0.1 --port 8790
```

API:
- `POST /solve-cpsat`

## 3) Connect with Nest backend

```bash
export SCHEDULER_ENGINE=ortools-cpsat
export ORTOOLS_SOLVER_URL=http://127.0.0.1:8790/solve-cpsat
# optional: fail-fast instead of fallback to greedy
export SCHEDULER_STRICT_ORTOOLS=true
```

Then run Nest backend as usual.
