# Architecture

- **WebSocket (/ws/stream)**: Receives base64-encoded JPEG frames, returns prediction/commit/refined events.
- **Inference Pipeline**: Sliding window frames -> model -> word + confidence.
- **Stability Filter**: Commits a word after K repeats or confidence over threshold.
- **LLM Refiner**: Async step; turns committed text into a natural sentence without blocking video.
- **Frontend**: Next.js with webcam capture, WebSocket streaming, and live subtitles.

## Message Formats
- Client -> Server:
  - Frame: `{ "type": "frame", "data": "<base64-jpeg>" }`
- Server -> Client:
  - Status: `{ "type": "status", "message": "ready|error|..." }`
  - Prediction: `{ "type": "prediction", "tentative_word": "hello", "confidence": 0.82 }`
  - Commit: `{ "type": "commit", "committed_word": "hello", "raw_committed_text": "hello thanks" }`
  - Refined: `{ "type": "refined", "refined_sentence": "Hello, thanks.", "raw_committed_text": "hello thanks" }`