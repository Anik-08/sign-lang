# Sign Language Translator (Prototype)

## Overview
- FastAPI backend with WebSocket streaming for frames and real-time predictions.
- Sliding-window inference with stability/commit filter.
- Asynchronous LLM refinement of committed text.
- Next.js frontend that captures webcam frames, streams them over WebSocket, and displays tentative/committed/refined text.

## Quickstart

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
./run.sh
# Backend runs at http://localhost:8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Frontend runs at http://localhost:3000
```

### WebSocket Endpoint
- URL: `ws://localhost:8000/ws/stream`
- Send messages: `{ "type": "frame", "data": "<base64-jpeg>" }`
- Receive messages:
  - `prediction`: `{ type, tentative_word, confidence }`
  - `commit`: `{ type, committed_word, raw_committed_text }`
  - `refined`: `{ type, refined_sentence, raw_committed_text }`
  - `status`: `{ type, message }`

### Where to plug in a real model
- Replace dummy model in `backend/models/sign_model.py`.
- Adjust preprocessing in `backend/utils/preprocess.py`.
- Tune stability params in `backend/services/stability.py`.
- Point `backend/services/llm_refiner.py` to your real LLM API.
