# CASS Smart Mapping Assistant

CASS Smart Mapping Assistant is a CASS/CAD pre-processing tool for survey point files. It helps users upload point data, preview points on a web canvas, create candidate map features, manually accept the useful ones, and export DAT, DXF, or project JSON for later editing in CASS/CAD software.

This is not a replacement for South CASS, not a full automatic mapping system, and not a DWG editor. It is a lightweight front step between raw survey points and CAD drafting.

## Screenshots

Screenshots are stored in `screenshots/` and captured with sample data only. No real survey file is included.

## Features

- Parse CSV, XLSX, and DAT survey point files.
- Confirm field mapping before creating standard point data.
- Preview points on an SVG canvas with pan/zoom support.
- Select points manually or by point number ranges.
- Create lines, closed polygons, trees, manholes, and other feature types.
- Generate candidate features from continuous point numbers and note/code keywords.
- Require manual acceptance before candidates enter exported project data.
- Save and reload project JSON.
- Export DAT and DXF through the FastAPI backend.
- Attach sketch images for manual comparison without writing sketches into DAT/DXF.

## Tech Stack

- Frontend: React 19, TypeScript, Vite
- Backend: Python, FastAPI
- File parsing: CSV, XLSX, DAT
- CAD export: ezdxf
- Tests: pytest, httpx
- Optional AI helpers: DeepSeek text recommendation and Qwen VL sketch analysis through environment variables

## Repository Layout

```text
backend/   FastAPI backend
frontend/  React + TypeScript + Vite frontend
samples/   public sample point files and sample project JSON
docs/      architecture notes
```

## Run Locally

Backend:

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Sample Data

Use the files in `samples/` for public testing:

- `sample_points.csv`
- `sample_points.dat`
- `sample_points.xlsx`
- `sample_project.json`
- `note_code_points.csv`
- error samples for duplicate points, missing height, missing coordinate, messy DAT rows, and invalid project references

Real survey files used during local acceptance are not included in this public repository.

## Optional AI Configuration

AI recommendation and sketch analysis are optional. The core parser, editor, validation, JSON export, DAT export, and DXF export work without API keys.

```bash
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
QWEN_VL_API_KEY=your_key_here
QWEN_VL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_VL_MODEL=qwen3-vl-flash
```

Copy `backend/.env.example` to `backend/.env` for local AI testing. Never commit real keys.

## Tests

Backend:

```bash
cd backend
python -m pytest -p no:cacheprovider
```

Frontend:

```bash
cd frontend
npm run build
```

## Privacy Boundary

This public copy excludes real survey files, temporary acceptance outputs, DXF/DWG files, local logs, Python virtual environments, frontend build output, `node_modules`, and real environment files.

## License

MIT
